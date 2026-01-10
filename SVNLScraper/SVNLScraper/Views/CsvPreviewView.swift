import SwiftUI

struct CsvPreviewView: View {
    @ObservedObject var settings: AppSettings
    let inline: Bool
    @StateObject private var viewModel = CsvPreviewViewModel()
    @State private var selectedFile: CsvPreviewViewModel.CsvFile?
    @State private var showLoadingIndicator = false

    init(settings: AppSettings, inline: Bool = false) {
        self.settings = settings
        self.inline = inline
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(inline ? .title3 : .title)
                    .foregroundStyle(.blue)
                Text("CSV Preview")
                    .font(inline ? .headline : .largeTitle.bold())
                Spacer()
                Button {
                    viewModel.selectedFile = selectedFile
                    if inline {
                        viewModel.loadLatestFile(outputDir: effectiveOutputDir)
                    } else {
                        viewModel.loadFiles(outputDir: effectiveOutputDir)
                    }
                    selectedFile = viewModel.selectedFile
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
            }
            .padding()
            .background(.ultraThinMaterial)

            Divider()

            // Content
            HSplitView {
                if !inline {
                    VStack(alignment: .leading, spacing: 0) {
                        // File list header
                        HStack {
                            Label("Files", systemImage: "folder")
                                .font(.headline)
                                .foregroundStyle(.secondary)
                            Spacer()
                        }
                        .padding()
                        .background(.ultraThinMaterial)

                        Divider()

                        // File list
                        List(selection: $selectedFile) {
                            ForEach(viewModel.files) { file in
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(file.name)
                                        .font(.system(.body, design: .rounded, weight: .medium))
                                        .lineLimit(2)
                                    Label(
                                        file.modifiedAt.formatted(date: .abbreviated, time: .shortened),
                                        systemImage: "clock"
                                    )
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                }
                                .padding(.vertical, 4)
                                .tag(file)
                            }
                        }
                        .listStyle(.sidebar)
                        .onChange(of: selectedFile) { _, newValue in
                            if let file = newValue {
                                DispatchQueue.main.async {
                                    viewModel.selectedFile = file
                                    viewModel.loadPreview(for: file)
                                }
                            }
                        }
                    }
                    .frame(minWidth: 260, idealWidth: 320, maxWidth: 380)
                    .layoutPriority(1)
                }

                VStack(alignment: .leading, spacing: 0) {
                    if !inline {
                        HStack {
                            Label("Preview", systemImage: "tablecells")
                                .font(.headline)
                                .foregroundStyle(.secondary)
                            Spacer()
                            if !viewModel.headers.isEmpty {
                                Text("\(viewModel.rows.count) rows • \(viewModel.headers.count) columns")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(.ultraThinMaterial, in: Capsule())
                            }
                        }
                        .padding()
                        .background(.ultraThinMaterial)

                        Divider()
                    }

                    if let error = viewModel.errorMessage {
                        VStack(spacing: 12) {
                            Image(systemName: "exclamationmark.triangle")
                                .font(.system(size: 48))
                                .foregroundStyle(.red)
                            Text(error)
                                .foregroundStyle(.red)
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding()
                    } else if viewModel.isLoading || (showLoadingIndicator && viewModel.headers.isEmpty) {
                        if showLoadingIndicator {
                            VStack(spacing: 16) {
                                ProgressView()
                                    .scaleEffect(inline ? 1.0 : 1.5)
                                    .controlSize(inline ? .regular : .large)
                                Text("Loading CSV...")
                                    .font(inline ? .subheadline : .headline)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            // Placeholder during debounce period
                            Color.clear
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    } else if viewModel.headers.isEmpty {
                        if inline {
                            VStack(spacing: 12) {
                                Image(systemName: "doc")
                                    .font(.system(size: 36))
                                    .foregroundStyle(.tertiary)
                                Text("No preview data")
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            ContentUnavailableView {
                                Label("No CSV Preview", systemImage: "doc.text.magnifyingglass")
                            } description: {
                                Text("Run a scrape to generate CSV output, then refresh.")
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    } else {
                        Table(csvRows) {
                            TableColumnForEach(viewModel.headers.indices, id: \.self) { index in
                                TableColumn(viewModel.headers[index]) { row in
                                    Text(row.values[safe: index] ?? "")
                                        .font(.system(.caption, design: .monospaced))
                                        .lineLimit(1)
                                }
                                .width(
                                    min: viewModel.fixedColumnWidth,
                                    ideal: viewModel.fixedColumnWidth,
                                    max: viewModel.fixedColumnWidth
                                )
                            }
                        }
                        .id(viewModel.headers)
                        .tableStyle(.inset(alternatesRowBackgrounds: true))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }

                    if inline && !viewModel.headers.isEmpty {
                        Divider()
                        HStack {
                            Label("\(viewModel.rows.count) rows • \(viewModel.headers.count) columns", systemImage: "tablecells")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                        }
                        .padding(8)
                        .background(.ultraThinMaterial)
                    }
                }
                .frame(minWidth: inline ? 320 : 520, maxHeight: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .applyInlineFrame(inline: inline)
        .onChange(of: viewModel.isLoading) { _, isLoading in
            if isLoading {
                // Debounce loading indicator - only show after 50ms
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                    if viewModel.isLoading {
                        showLoadingIndicator = true
                    }
                }
            } else {
                showLoadingIndicator = false
            }
        }
        .onAppear {
            DispatchQueue.main.async {
                if inline {
                    viewModel.loadLatestFile(outputDir: effectiveOutputDir)
                } else {
                    viewModel.loadFiles(outputDir: effectiveOutputDir)
                }
                selectedFile = viewModel.selectedFile
            }
        }
    }

    private var effectiveOutputDir: String {
        if settings.outputDir.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let home = FileManager.default.homeDirectoryForCurrentUser.path
            return "\(home)/Documents/SVNLScraper"
        }
        return settings.outputDir
    }

    private var csvRows: [CsvTableRow] {
        viewModel.rows.enumerated().map { CsvTableRow(id: $0.offset, values: $0.element) }
    }
}

private extension View {
    @ViewBuilder
    func applyInlineFrame(inline: Bool) -> some View {
        if inline {
            self
        } else {
            frame(minWidth: 900, minHeight: 520)
        }
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        guard index >= 0, index < count else {
            return nil
        }
        return self[index]
    }
}

private struct CsvTableRow: Identifiable {
    let id: Int
    let values: [String]
}

#Preview {
    CsvPreviewView(settings: AppSettings())
        .frame(width: 900, height: 520)
}
