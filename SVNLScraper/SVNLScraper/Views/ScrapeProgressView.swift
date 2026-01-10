import SwiftUI

struct ScrapeProgressView: View {
    @ObservedObject var viewModel: ScraperViewModel
    @ObservedObject var settings: AppSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    HStack(spacing: 8) {
                        Image(systemName: viewModel.isRunning ? "bolt.circle.fill" : "checkmark.circle.fill")
                            .font(.title2)
                            .foregroundStyle(viewModel.isRunning ? .green : .secondary)
                            .symbolEffect(.pulse, isActive: viewModel.isRunning)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(viewModel.isRunning ? "Scraping" : "Ready")
                                .font(.title2.bold())
                            if let name = viewModel.currentCompetitionName {
                                let dateLabel = viewModel.currentCompetitionDate.map { " • \($0)" } ?? ""
                                Text(name + dateLabel)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            } else if let id = viewModel.currentCompetitionId {
                                Text("Competition ID: \(id)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    Spacer()

                    HStack(spacing: 16) {
                        VStack(spacing: 4) {
                            Text("\(viewModel.completedCount)")
                                .font(.title3.bold())
                                .foregroundStyle(.green)
                            Text("Completed")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))

                        VStack(spacing: 4) {
                            Text("\(viewModel.errorCount)")
                                .font(.title3.bold())
                                .foregroundStyle(viewModel.errorCount > 0 ? .red : .secondary)
                            Text("Errors")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background((viewModel.errorCount > 0 ? Color.red : Color.gray).opacity(0.1), in: RoundedRectangle(cornerRadius: 10))

                        Button {
                            viewModel.clearOutput()
                        } label: {
                            Label("Clear", systemImage: "trash")
                        }
                        .buttonStyle(.bordered)
                        .disabled(viewModel.logLines.isEmpty)
                    }
                }

                if viewModel.total > 0 {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Progress")
                                .font(.caption.bold())
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text("\(viewModel.processed) / \(viewModel.total) lifters")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        ProgressView(value: Double(viewModel.processed), total: Double(viewModel.total))
                            .tint(.blue)
                    }
                    .padding(12)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10))
                }

                if let status = viewModel.statusMessage {
                    Label(status, systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
            .background(.ultraThinMaterial)

            Divider()

            if viewModel.logLines.isEmpty {
                VStack(spacing: 16) {
                    Spacer()
                    Image(systemName: "text.alignleft")
                        .font(.system(size: 48))
                        .foregroundStyle(.tertiary)
                    Text("No activity yet")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text("Logs will appear here during scraping")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollViewReader { proxy in
                    List {
                        ForEach(Array(viewModel.logLines.enumerated()), id: \.offset) { index, line in
                            HStack(alignment: .top, spacing: 8) {
                                Text("\(index + 1)")
                                    .font(.system(.caption2, design: .monospaced))
                                    .foregroundStyle(.tertiary)
                                    .frame(width: 40, alignment: .trailing)

                                Text(line)
                                    .font(.system(.caption, design: .monospaced))
                                    .textSelection(.enabled)
                            }
                            .padding(.vertical, 2)
                            .id(index)
                        }
                    }
                    .listStyle(.inset)
                    .onChange(of: viewModel.logLines.count) { _, _ in
                        if !viewModel.logLines.isEmpty {
                            withAnimation {
                                proxy.scrollTo(viewModel.logLines.count - 1, anchor: .bottom)
                            }
                        }
                    }
                }
            }

            if viewModel.showPreview {
                Divider()
                CsvPreviewView(settings: settings, inline: true)
                    .id(viewModel.previewToken)
                    .frame(minHeight: 260)
            }
        }
    }
}

#Preview {
    let viewModel = ScraperViewModel()
    viewModel.isRunning = true
    viewModel.currentCompetitionId = "2004"
    viewModel.currentCompetitionName = "Kansallinen klassinen voimanostokilpailu"
    viewModel.currentCompetitionDate = "20.12.2025"
    viewModel.processed = 40
    viewModel.total = 120
    viewModel.completedCount = 1
    viewModel.errorCount = 0
    viewModel.statusMessage = "Scraping..."
    viewModel.logLines = [
        "Starting competition 2004",
        "Completed: Kansallinen klassinen voimanostokilpailu"
    ]
    viewModel.showPreview = true
    return ScrapeProgressView(viewModel: viewModel, settings: AppSettings())
        .frame(width: 720, height: 520)
}
