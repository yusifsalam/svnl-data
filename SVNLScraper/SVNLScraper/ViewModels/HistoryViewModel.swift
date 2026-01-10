import Combine
import Foundation
import SwiftData
import SwiftUI
import AppKit

@MainActor
final class HistoryViewModel: ObservableObject {
    @Published var jobs: [ScrapeJob] = []
    @Published var selectedJob: ScrapeJob?
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var modelContext: ModelContext?

    func configure(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    func loadJobs() {
        guard let context = modelContext else {
            errorMessage = "Model context not configured"
            return
        }

        isLoading = true
        errorMessage = nil

        let descriptor = FetchDescriptor<ScrapeJob>(
            sortBy: [SortDescriptor(\.startTime, order: .reverse)]
        )

        do {
            jobs = try context.fetch(descriptor)

            // Refresh CSV file existence
            for job in jobs {
                checkCsvFileExists(for: job)
            }

            isLoading = false
        } catch {
            errorMessage = "Failed to load jobs: \(error.localizedDescription)"
            isLoading = false
        }
    }

    func deleteJob(_ job: ScrapeJob) {
        guard let context = modelContext else { return }

        context.delete(job)

        do {
            try context.save()
            loadJobs()
        } catch {
            errorMessage = "Failed to delete job: \(error.localizedDescription)"
        }
    }

    func deleteAllJobs() {
        guard let context = modelContext else { return }

        do {
            try context.delete(model: ScrapeJob.self)
            try context.save()
            loadJobs()
        } catch {
            errorMessage = "Failed to delete all jobs: \(error.localizedDescription)"
        }
    }

    func openCsvFile(for job: ScrapeJob) {
        let paths = outputPaths(for: job)
        guard let first = paths.first else { return }
        if paths.count > 1 {
            NSWorkspace.shared.open(URL(fileURLWithPath: job.outputDirectory))
            return
        }

        let url = URL(fileURLWithPath: first)
        if FileManager.default.fileExists(atPath: first) {
            NSWorkspace.shared.open(url)
        } else {
            errorMessage = "Output file no longer exists at: \(first)"
            job.csvFileExists = false
            try? modelContext?.save()
        }
    }

    func revealCsvFile(for job: ScrapeJob) {
        let paths = outputPaths(for: job)
        guard let first = paths.first else { return }
        let url = URL(fileURLWithPath: first)

        if paths.count > 1 {
            NSWorkspace.shared.open(URL(fileURLWithPath: job.outputDirectory))
            return
        }

        if FileManager.default.fileExists(atPath: first) {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } else {
            errorMessage = "Output file no longer exists at: \(first)"
            job.csvFileExists = false
            try? modelContext?.save()
        }
    }

    func deleteOldJobs(olderThanDays days: Int) {
        guard let context = modelContext else { return }

        let cutoffDate = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()

        let descriptor = FetchDescriptor<ScrapeJob>(
            predicate: #Predicate { job in
                job.startTime < cutoffDate
            }
        )

        do {
            let oldJobs = try context.fetch(descriptor)
            for job in oldJobs {
                context.delete(job)
            }
            try context.save()
            loadJobs()
        } catch {
            errorMessage = "Failed to delete old jobs: \(error.localizedDescription)"
        }
    }

    private func checkCsvFileExists(for job: ScrapeJob) {
        let paths = outputPaths(for: job)
        guard !paths.isEmpty else {
            job.csvFileExists = false
            return
        }

        let exists = paths.contains { FileManager.default.fileExists(atPath: $0) }
        if job.csvFileExists != exists {
            job.csvFileExists = exists
            try? modelContext?.save()
        }
    }

    private func outputPaths(for job: ScrapeJob) -> [String] {
        if !job.outputPaths.isEmpty {
            return job.outputPaths
        }
        if let path = job.csvFilePath {
            return [path]
        }
        return []
    }
}
