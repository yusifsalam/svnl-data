import Combine
import CoreGraphics
import Foundation

final class CompetitionPreviewViewModel: ObservableObject {
    struct PreviewFile: Identifiable, Hashable {
        let url: URL
        let name: String
        let modifiedAt: Date
        let format: Format

        var id: URL { url }
    }

    struct PreviewCompetition: Identifiable {
        let id: String
        let name: String
        let dateLabel: String
        let location: String
        let eventType: String
        let lifters: [PreviewLifter]
    }

    struct PreviewLifter: Identifiable {
        let id = UUID()
        let position: String
        let name: String
        let club: String
        let gender: String
        let ageClass: String
        let equipment: String
        let weightClass: String
        let bodyWeight: String
        let squat: [AttemptView]
        let bench: [AttemptView]
        let deadlift: [AttemptView]
        let total: String
        let points: String
    }

    struct AttemptView {
        let weight: String
        let success: Bool?
    }

    enum Format: String {
        case csv
        case json
    }

    @Published var files: [PreviewFile] = []
    @Published var selectedFile: PreviewFile?
    @Published var competitions: [PreviewCompetition] = []
    @Published var selectedCompetitionId: String?
    @Published var errorMessage: String?
    @Published var isLoading: Bool = false

    private let maxPreviewBytes = 4 * 1024 * 1024

    func loadFiles(outputDir: String) {
        errorMessage = nil
        competitions = []
        selectedCompetitionId = nil
        isLoading = true

        let path = outputDir.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            files = []
            errorMessage = "Output directory is empty."
            isLoading = false
            return
        }

        let directoryURL = URL(fileURLWithPath: path, isDirectory: true)
        do {
            let contents = try FileManager.default.contentsOfDirectory(
                at: directoryURL,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles]
            )

            let outputFiles = contents.compactMap { url -> PreviewFile? in
                let ext = url.pathExtension.lowercased()
                guard let format = Format(rawValue: ext) else { return nil }
                let values = try? url.resourceValues(forKeys: [.contentModificationDateKey])
                let modifiedAt = values?.contentModificationDate ?? .distantPast
                return PreviewFile(url: url, name: url.lastPathComponent, modifiedAt: modifiedAt, format: format)
            }
            .sorted { $0.modifiedAt > $1.modifiedAt }

            files = outputFiles
            if outputFiles.isEmpty {
                selectedFile = nil
                errorMessage = "No CSV or JSON files found."
                isLoading = false
                return
            }

            if let selected = selectedFile, outputFiles.contains(selected) {
                loadFile(selected)
                return
            }

            if let first = outputFiles.first {
                selectedFile = first
                loadFile(first)
            }
        } catch {
            files = []
            errorMessage = "Failed to read output directory: \(error.localizedDescription)"
            isLoading = false
        }
    }

    func loadFile(_ file: PreviewFile) {
        errorMessage = nil
        competitions = []
        selectedCompetitionId = nil
        isLoading = true

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let comps: [PreviewCompetition]
                switch file.format {
                case .csv:
                    let lines = try self.readLines(from: file.url, maxBytes: self.maxPreviewBytes)
                    comps = self.parseCSV(lines)
                case .json:
                    let data = try Data(contentsOf: file.url, options: [.uncached])
                    comps = try self.parseJSON(data)
                }

                DispatchQueue.main.async {
                    self.competitions = comps
                    self.selectedCompetitionId = comps.first?.id
                    self.isLoading = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = "Failed to load preview: \(error.localizedDescription)"
                    self.isLoading = false
                }
            }
        }
    }

    private func parseCSV(_ lines: [String]) -> [PreviewCompetition] {
        guard let headerLine = lines.first else { return [] }
        let headers = parseCSVLine(headerLine)
        var rows: [[String: String]] = []
        rows.reserveCapacity(max(0, lines.count - 1))

        for line in lines.dropFirst() {
            let fields = parseCSVLine(line)
            var row: [String: String] = [:]
            for (index, header) in headers.enumerated() {
                row[header] = index < fields.count ? fields[index] : ""
            }
            rows.append(row)
        }

        let grouped = Dictionary(grouping: rows) { row in
            row["competition_id"] ?? "unknown"
        }

        return grouped.values.compactMap { group in
            guard let first = group.first else { return nil }
            let id = first["competition_id"] ?? "unknown"
            let name = first["competition_name"] ?? id
            let dateLabel = dateLabel(
                primary: first["competition_date"],
                start: first["competition_start_date"],
                end: first["competition_end_date"]
            )
            let location = first["competition_location"] ?? ""
            let eventType = first["event_type"] ?? ""

            let lifters = group.map { row in
                PreviewLifter(
                    position: row["position"] ?? "",
                    name: row["name"] ?? "",
                    club: row["club"] ?? "",
                    gender: row["gender"] ?? "",
                    ageClass: row["age_class"] ?? "",
                    equipment: row["equipment"] ?? "",
                    weightClass: row["weight_class"] ?? "",
                    bodyWeight: row["body_weight"] ?? "",
                    squat: attemptViews(prefix: "squat", row: row),
                    bench: attemptViews(prefix: "bench", row: row),
                    deadlift: attemptViews(prefix: "deadlift", row: row),
                    total: row["total"] ?? "",
                    points: row["points"] ?? ""
                )
            }

            return PreviewCompetition(
                id: id,
                name: name,
                dateLabel: dateLabel,
                location: location,
                eventType: eventType,
                lifters: lifters
            )
        }
        .sorted { $0.name < $1.name }
    }

    private func parseJSON(_ data: Data) throws -> [PreviewCompetition] {
        let decoder = JSONDecoder()
        let results = try decoder.decode([JsonCompetitionResult].self, from: data)
        return results.map { result in
            let comp = result.competition
            let dateLabel = dateLabel(
                primary: comp.date,
                start: comp.startDate,
                end: comp.endDate
            )
            let lifters = result.lifters.map { lifter in
                PreviewLifter(
                    position: String(lifter.position),
                    name: lifter.name,
                    club: lifter.club,
                    gender: lifter.gender,
                    ageClass: lifter.ageClass ?? "",
                    equipment: lifter.equipment,
                    weightClass: lifter.weightClass,
                    bodyWeight: formatNumber(lifter.bodyWeight),
                    squat: lifter.squat.map { AttemptView(weight: formatNumber($0.weight), success: $0.success) },
                    bench: lifter.bench.map { AttemptView(weight: formatNumber($0.weight), success: $0.success) },
                    deadlift: lifter.deadlift.map { AttemptView(weight: formatNumber($0.weight), success: $0.success) },
                    total: formatNumber(lifter.total),
                    points: formatNumber(lifter.points)
                )
            }
            return PreviewCompetition(
                id: comp.id,
                name: comp.name ?? comp.id,
                dateLabel: dateLabel,
                location: comp.location ?? "",
                eventType: comp.eventType ?? "",
                lifters: lifters
            )
        }
    }

    private func dateLabel(primary: String?, start: String?, end: String?) -> String {
        if let primary, !primary.isEmpty {
            return primary
        }
        if let start, let end, !start.isEmpty, !end.isEmpty, start != end {
            return "\(start)–\(end)"
        }
        if let start, !start.isEmpty {
            return start
        }
        return ""
    }

    private func attemptViews(prefix: String, row: [String: String]) -> [AttemptView] {
        (1 ... 3).map { index in
            let weight = row["\(prefix)_\(index)"] ?? ""
            let successRaw = row["\(prefix)_\(index)_success"]?.lowercased()
            let success = successRaw == nil ? nil : (successRaw == "true")
            return AttemptView(weight: weight, success: success)
        }
    }

    private func readLines(from url: URL, maxBytes: Int) throws -> [String] {
        let data = try Data(contentsOf: url, options: [.uncached]).prefix(maxBytes)
        guard !data.isEmpty else { return [] }
        guard let content = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "CompetitionPreviewViewModel", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid UTF-8 encoding"])
        }
        return content.split(whereSeparator: \.isNewline).map(String.init)
    }

    private func parseCSVLine(_ line: String) -> [String] {
        var fields: [String] = []
        fields.reserveCapacity(50)
        var current = ""
        var inQuotes = false

        let chars = Array(line)
        var i = 0

        while i < chars.count {
            let char = chars[i]
            if inQuotes {
                if char == "\"" {
                    if i + 1 < chars.count, chars[i + 1] == "\"" {
                        current.append("\"")
                        i += 1
                    } else {
                        inQuotes = false
                    }
                } else {
                    current.append(char)
                }
            } else {
                switch char {
                case "\"":
                    inQuotes = true
                case ",":
                    fields.append(current)
                    current = ""
                default:
                    current.append(char)
                }
            }
            i += 1
        }

        fields.append(current)
        return fields
    }

    private func formatNumber(_ value: Double) -> String {
        if value <= 0 {
            return ""
        }
        if value == floor(value) {
            return String(Int(value))
        }
        return String(format: "%.2f", value)
    }
}

private struct JsonCompetitionResult: Codable {
    let competition: JsonCompetition
    let lifters: [JsonLifter]
}

private struct JsonCompetition: Codable {
    let id: String
    let name: String?
    let date: String?
    let startDate: String?
    let endDate: String?
    let location: String?
    let eventType: String?
}

private struct JsonLifter: Codable {
    let position: Int
    let name: String
    let birthYear: Int
    let gender: String
    let ageClass: String?
    let equipment: String
    let weightClass: String
    let bodyWeight: Double
    let club: String
    let squat: [JsonAttempt]
    let bench: [JsonAttempt]
    let deadlift: [JsonAttempt]
    let total: Double
    let points: Double
}

private struct JsonAttempt: Codable {
    let weight: Double
    let success: Bool
}
