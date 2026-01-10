import Combine
import Foundation
import SwiftData

final class ScraperViewModel: ObservableObject {
    @Published var isRunning = false
    @Published var currentCompetitionId: String?
    @Published var currentCompetitionName: String?
    @Published var currentCompetitionDate: String?
    @Published var processed: Int = 0
    @Published var total: Int = 0
    @Published var completedCount: Int = 0
    @Published var errorCount: Int = 0
    @Published var statusMessage: String?
    @Published var logLines: [String] = []
    @Published var showPreview: Bool = false
    @Published var previewToken = UUID()
    @Published var currentJob: ScrapeJob?

    private var service: CliService?
    private var modelContext: ModelContext?
    private var currentCompetitionDetail: CompetitionScrapeDetail?
    private var totalCompetitions: Int = 0

    func configure(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    func startScrape(ids: [String], settings: AppSettings) {
        guard !ids.isEmpty else {
            statusMessage = "Select at least one competition to scrape."
            return
        }

        resetState()
        isRunning = true
        statusMessage = "Starting scrape..."
        showPreview = false

        if let context = modelContext {
            let job = ScrapeJob(
                startTime: Date(),
                headlessMode: settings.headlessMode,
                chromePath: settings.chromePath.isEmpty ? nil : settings.chromePath,
                outputDirectory: settings.outputDir,
                totalCompetitions: ids.count
            )

            context.insert(job)
            currentJob = job

            do {
                try context.save()
            } catch {
                statusMessage = "Failed to save job: \(error.localizedDescription)"
            }
        }

        let service = CliService(config: settings.cliConfig)
        self.service = service

        do {
            try service.scrapeCompetitions(
                ids: ids,
                onEvent: { [weak self] event in
                    DispatchQueue.main.async {
                        self?.handleEvent(event)
                    }
                },
                onError: { [weak self] message in
                    DispatchQueue.main.async {
                        self?.statusMessage = message
                        self?.appendLog(message)
                    }
                },
                onExit: { [weak self] status in
                    DispatchQueue.main.async {
                        self?.isRunning = false
                        if status != 0 {
                            if self?.statusMessage == nil || self?.statusMessage?.isEmpty == true {
                                self?.statusMessage = "Scrape exited with status \(status)"
                            }
                        }
                    }
                }
            )
        } catch {
            isRunning = false
            statusMessage = "Failed to start scrape: \(error)"
        }
    }

    func stopScrape() {
        service?.terminate()
        statusMessage = "Stopping..."

        if let job = currentJob, let context = modelContext {
            job.endTime = Date()
            job.isComplete = true
            job.wasStopped = true

            if let detail = currentCompetitionDetail {
                detail.status = .failed
                detail.errorMessage = "Scrape stopped by user"
                job.failedCompetitions += 1
            }

            do {
                try context.save()
            } catch {
                print("Failed to save stopped job: \(error)")
            }
        }

        currentJob = nil
        currentCompetitionDetail = nil
    }

    func clearOutput() {
        resetState()
    }

    private func handleEvent(_ event: CliEvent) {
        switch event.type {
        case "progress":
            handleProgressMessage(event.message)
        case "error":
            if let message = event.message {
                statusMessage = message
                appendLog(message)
                errorCount += 1
            }
        case "complete":
            statusMessage = "Scraping complete"
            showPreview = true
            previewToken = UUID()
            let successful = event.data?.competitions
            let lifters = event.data?.lifters
            let failed = errorCount
            if let successful = successful {
                completedCount = successful
            } else if totalCompetitions > 0 {
                completedCount = totalCompetitions
            }
            let outputPaths = normalizedOutputPaths(from: event.data)
            finalizeJob(
                successful: successful,
                failed: failed,
                lifters: lifters,
                outputPaths: outputPaths
            )
        default:
            break
        }
    }

    private func handleProgressMessage(_ message: String?) {
        guard let message = message else { return }
        statusMessage = message
        appendLog(message)

        if let progress = parseScrapeProgress(message) {
            totalCompetitions = progress.total
            completedCount = max(0, progress.index - 1)
            currentCompetitionName = progress.name
        } else if message.hasPrefix("Fetching ") {
            currentCompetitionName = String(message.dropFirst("Fetching ".count))
        } else if message.hasPrefix("Found ") && message.contains("lifters") {
            // No lifter progress details available; keep total at zero.
        } else if message.hasPrefix("Error:") {
            errorCount += 1
        }
    }

    private func parseScrapeProgress(_ message: String) -> (index: Int, total: Int, name: String)? {
        let pattern = #"^\[(\d+)/(\d+)\] Scraping (.+)$"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(message.startIndex..<message.endIndex, in: message)
        guard let match = regex.firstMatch(in: message, range: range),
              let indexRange = Range(match.range(at: 1), in: message),
              let totalRange = Range(match.range(at: 2), in: message),
              let nameRange = Range(match.range(at: 3), in: message) else {
            return nil
        }

        let index = Int(message[indexRange]) ?? 0
        let total = Int(message[totalRange]) ?? 0
        let name = String(message[nameRange])
        return (index, total, name)
    }

    private func appendLog(_ message: String) {
        logLines.append(message)
        if logLines.count > 200 {
            logLines.removeFirst(logLines.count - 200)
        }
    }

    private func resetState() {
        currentCompetitionId = nil
        currentCompetitionName = nil
        currentCompetitionDate = nil
        processed = 0
        total = 0
        completedCount = 0
        errorCount = 0
        logLines = []
        showPreview = false
        previewToken = UUID()
        totalCompetitions = 0
    }

    private func finalizeJob(
        successful: Int?,
        failed: Int?,
        lifters: Int?,
        outputPaths: [String]
    ) {
        guard let job = currentJob, let context = modelContext else { return }
        job.endTime = Date()
        job.isComplete = true
        if let successful = successful {
            job.successfulCompetitions = successful
        }
        if let failed = failed {
            job.failedCompetitions = failed
        }
        if let lifters = lifters {
            job.totalLiftersProcessed = lifters
        }
        job.outputPaths = outputPaths
        if let first = outputPaths.first {
            job.csvFilePath = first
        } else {
            job.csvFilePath = inferCsvPath(outputDir: job.outputDirectory)
        }
        job.csvFileExists = outputFileExists(job: job)

        do {
            try context.save()
        } catch {
            print("Failed to finalize job: \(error)")
        }
    }

    private func normalizedOutputPaths(from data: CliEventData?) -> [String] {
        if let paths = data?.outputPaths, !paths.isEmpty {
            return paths
        }
        if let path = data?.outputPath, !path.isEmpty {
            return [path]
        }
        return []
    }

    private func outputFileExists(job: ScrapeJob) -> Bool {
        let paths = job.outputPaths.isEmpty
            ? (job.csvFilePath != nil ? [job.csvFilePath!] : [])
            : job.outputPaths
        return paths.contains(where: { FileManager.default.fileExists(atPath: $0) })
    }

    private func inferCsvPath(outputDir: String) -> String? {
        let url = URL(fileURLWithPath: outputDir)
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return nil }

        let csvFiles = files
            .filter { $0.pathExtension == "csv" }
            .compactMap { url -> (URL, Date)? in
                guard let attrs = try? url.resourceValues(forKeys: [.contentModificationDateKey]),
                      let date = attrs.contentModificationDate else { return nil }
                return (url, date)
            }
            .sorted { $0.1 > $1.1 }

        return csvFiles.first?.0.path
    }
}
