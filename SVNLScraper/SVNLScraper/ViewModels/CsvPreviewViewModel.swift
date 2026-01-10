import Combine
import Foundation

final class CsvPreviewViewModel: ObservableObject {
    struct CsvFile: Identifiable, Hashable {
        let url: URL
        let name: String
        let modifiedAt: Date

        var id: URL { url }
    }

    @Published var files: [CsvFile] = []
    @Published var selectedFile: CsvFile?
    @Published var headers: [String] = []
    @Published var rows: [[String]] = []
    @Published var errorMessage: String?
    @Published var isLoading: Bool = false

    let maxRows = 1000
    let fixedColumnWidth: CGFloat = 160
    private let maxFieldLength = 200
    private let maxPreviewBytes = 2 * 1024 * 1024

    func loadFiles(outputDir: String) {
        errorMessage = nil
        headers = []
        rows = []
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

            let csvFiles = contents
                .filter { $0.pathExtension.lowercased() == "csv" }
                .compactMap { url -> CsvFile? in
                    let values = try? url.resourceValues(forKeys: [.contentModificationDateKey])
                    let modifiedAt = values?.contentModificationDate ?? .distantPast
                    return CsvFile(url: url, name: url.lastPathComponent, modifiedAt: modifiedAt)
                }
                .sorted { $0.modifiedAt > $1.modifiedAt }

            files = csvFiles
            if csvFiles.isEmpty {
                selectedFile = nil
                errorMessage = "No CSV files found."
                isLoading = false
                return
            }
            if let selected = selectedFile, csvFiles.contains(selected) {
                loadPreview(for: selected)
                return
            }
            if let first = csvFiles.first {
                selectedFile = first
                loadPreview(for: first)
            }
        } catch {
            files = []
            errorMessage = "Failed to read output directory: \(error.localizedDescription)"
            isLoading = false
        }
    }

    func loadLatestFile(outputDir: String) {
        errorMessage = nil
        headers = []
        rows = []
        isLoading = true

        let path = outputDir.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            files = []
            selectedFile = nil
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

            let csvFiles = contents
                .filter { $0.pathExtension.lowercased() == "csv" }
                .compactMap { url -> CsvFile? in
                    let values = try? url.resourceValues(forKeys: [.contentModificationDateKey])
                    let modifiedAt = values?.contentModificationDate ?? .distantPast
                    return CsvFile(url: url, name: url.lastPathComponent, modifiedAt: modifiedAt)
                }
                .sorted { $0.modifiedAt > $1.modifiedAt }

            if let latest = csvFiles.first {
                files = [latest]
                selectedFile = latest
                loadPreview(for: latest)
            } else {
                files = []
                selectedFile = nil
                errorMessage = "No CSV files found."
                isLoading = false
            }
        } catch {
            files = []
            selectedFile = nil
            errorMessage = "Failed to read output directory: \(error.localizedDescription)"
            isLoading = false
        }
    }

    func loadPreview(for file: CsvFile) {
        errorMessage = nil
        headers = []
        rows = []
        isLoading = true

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                let lines = try self.readLines(
                    from: file.url,
                    maxLines: self.maxRows + 1,
                    maxBytes: self.maxPreviewBytes
                )
                let parsed = self.parseCSVLines(lines, maxRows: self.maxRows)
                DispatchQueue.main.async {
                    self.headers = parsed.headers
                    self.rows = parsed.rows
                    self.isLoading = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = "Failed to read CSV: \(error.localizedDescription)"
                    self.isLoading = false
                }
            }
        }
    }

    private func parseCSVLines(
        _ lines: [String],
        maxRows: Int
    ) -> (headers: [String], rows: [[String]]) {
        var rows: [[String]] = []
        rows.reserveCapacity(min(lines.count, maxRows + 1))

        for line in lines {
            if rows.count >= maxRows + 1 {
                break
            }
            rows.append(parseCSVLine(line))
        }

        guard let headerRow = rows.first else {
            return ([], [])
        }
        let truncatedHeaders = headerRow.map { truncateField($0) }

        let dataRows = Array(rows.dropFirst()).prefix(maxRows)
        let normalizedRows = dataRows.map { row -> [String] in
            let trimmed = row.map { truncateField($0) }
            if trimmed.count < truncatedHeaders.count {
                return trimmed + Array(repeating: "", count: truncatedHeaders.count - trimmed.count)
            }
            return trimmed
        }

        return (truncatedHeaders, Array(normalizedRows))
    }

    private func readLines(from url: URL, maxLines: Int, maxBytes: Int) throws -> [String] {
        // Read file data up to maxBytes limit
        let data = try Data(contentsOf: url, options: [.uncached]).prefix(maxBytes)

        guard !data.isEmpty else {
            return []
        }

        // Convert to string and split by newlines (much faster than byte scanning)
        guard let content = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "CsvPreviewViewModel", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid UTF-8 encoding"])
        }

        // Split by newlines - handle both \n and \r\n
        var lines: [String] = []
        lines.reserveCapacity(maxLines)

        content.enumerateLines { line, stop in
            lines.append(line)
            if lines.count >= maxLines {
                stop = true
            }
        }

        return lines
    }

    private func parseCSVLine(_ line: String) -> [String] {
        var fields: [String] = []
        fields.reserveCapacity(50)
        var current = ""
        var inQuotes = false

        // Convert to array for O(1) indexing instead of O(n) String indexing
        let chars = Array(line)
        var i = 0

        while i < chars.count {
            let char = chars[i]
            if inQuotes {
                if char == "\"" {
                    if i + 1 < chars.count && chars[i + 1] == "\"" {
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

    private func truncateField(_ value: String) -> String {
        if value.count > maxFieldLength {
            return String(value.prefix(maxFieldLength)) + "..."
        }
        return value
    }
}
