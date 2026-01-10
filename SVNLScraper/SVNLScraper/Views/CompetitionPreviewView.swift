import SwiftUI

struct CompetitionPreviewView: View {
    @ObservedObject var settings: AppSettings
    @StateObject private var viewModel = CompetitionPreviewViewModel()
    @State private var selectedFile: CompetitionPreviewViewModel.PreviewFile?

    init(settings: AppSettings) {
        self.settings = settings
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "list.bullet.rectangle")
                    .font(.title2)
                    .foregroundStyle(.blue)
                Text("Competition Preview")
                    .font(.largeTitle.bold())
                Spacer()
                Button {
                    viewModel.selectedFile = selectedFile
                    viewModel.loadFiles(outputDir: settings.outputDir)
                    selectedFile = viewModel.selectedFile
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
            }
            .padding()
            .background(.ultraThinMaterial)

            Divider()

            HSplitView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Label("Files", systemImage: "folder")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                        Spacer()
                    }
                    .padding()
                    .background(.ultraThinMaterial)

                    Divider()

                    List(selection: $selectedFile) {
                        ForEach(viewModel.files) { file in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(file.name)
                                    .font(.system(.body, design: .rounded, weight: .medium))
                                    .lineLimit(2)
                                HStack(spacing: 8) {
                                    Label(file.modifiedAt.formatted(date: .abbreviated, time: .shortened), systemImage: "clock")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    Text(file.format.rawValue.uppercased())
                                        .font(.caption2.bold())
                                        .foregroundStyle(.white)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(.blue, in: Capsule())
                                }
                            }
                            .padding(.vertical, 4)
                            .tag(file)
                        }
                    }
                    .listStyle(.sidebar)
                    .onChange(of: selectedFile) { _, newValue in
                        if let file = newValue {
                            viewModel.loadFile(file)
                        }
                    }
                }
                .frame(minWidth: 260, idealWidth: 320, maxWidth: 380)
                .layoutPriority(1)

                VStack(alignment: .leading, spacing: 0) {
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
                    } else if viewModel.isLoading {
                        VStack(spacing: 16) {
                            ProgressView()
                                .controlSize(.large)
                            Text("Loading preview...")
                                .font(.headline)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if viewModel.competitions.isEmpty {
                        ContentUnavailableView {
                            Label("No Preview Data", systemImage: "list.bullet.rectangle")
                        } description: {
                            Text("Run a scrape to generate CSV/JSON output, then refresh.")
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        competitionDetailView
                    }
                }
                .frame(minWidth: 620, maxHeight: .infinity)
            }
        }
        .onAppear {
            viewModel.loadFiles(outputDir: settings.outputDir)
            selectedFile = viewModel.selectedFile
        }
    }

    private var competitionDetailView: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label("Competition", systemImage: "flag.checkered")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Spacer()
                if viewModel.competitions.count > 1 {
                    Picker("Competition", selection: $viewModel.selectedCompetitionId) {
                        ForEach(viewModel.competitions) { competition in
                            Text(competition.name).tag(Optional(competition.id))
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
            .padding()
            .background(.ultraThinMaterial)

            Divider()

            if let competition = selectedCompetition {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(competition.name)
                                .font(.title2.bold())
                            if !competition.dateLabel.isEmpty || !competition.location.isEmpty {
                                Text([competition.dateLabel, competition.location].filter { !$0.isEmpty }.joined(separator: " • "))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            if !competition.eventType.isEmpty {
                                Text(competition.eventType.uppercased())
                                    .font(.caption.bold())
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(.blue.opacity(0.1), in: Capsule())
                            }
                        }

                        let benchOnly = isBenchOnly(
                            competition.eventType,
                            lifters: competition.lifters
                        )
                        Table(competition.lifters) {
                            TableColumn("#") { lifter in
                                Text(lifter.position)
                            }
                            .width(40)

                            TableColumn("Name") { lifter in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(lifter.name)
                                        .font(.callout.bold())
                                    Text([lifter.gender, lifter.ageClass, lifter.equipment]
                                        .filter { !$0.isEmpty }
                                        .joined(separator: " • "))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .width(min: 180, ideal: 220)

                            TableColumn("Club") { lifter in
                                Text(lifter.club)
                            }
                            .width(min: 140, ideal: 180)

                            TableColumn("BW") { lifter in
                                Text(lifter.bodyWeight)
                            }
                            .width(60)

                            TableColumn("Class") { lifter in
                                Text(lifter.weightClass)
                            }
                            .width(60)

                            if !benchOnly {
                                TableColumn("Squat") { lifter in
                                    attemptsStack(lifter.squat)
                                }
                                .width(min: 120, ideal: 150)

                                TableColumn("Bench") { lifter in
                                    attemptsStack(lifter.bench)
                                }
                                .width(min: 120, ideal: 150)

                                TableColumn("Deadlift") { lifter in
                                    attemptsStack(lifter.deadlift)
                                }
                                .width(min: 120, ideal: 150)
                            } else {
                                TableColumn("Bench") { lifter in
                                    attemptsStack(lifter.bench)
                                }
                                .width(min: 120, ideal: 150)
                            }

                            TableColumn("Total") { lifter in
                                Text(lifter.total)
                            }
                            .width(70)

                            TableColumn("Points") { lifter in
                                Text(lifter.points)
                            }
                            .width(70)
                        }
                        .tableStyle(.inset(alternatesRowBackgrounds: true))
                        .frame(minHeight: 420)
                    }
                    .padding()
                }
            }
        }
    }

    private func attemptsStack(_ attempts: [CompetitionPreviewViewModel.AttemptView]) -> some View {
        HStack(spacing: 8) {
            ForEach(attempts.indices, id: \.self) { index in
                let attempt = attempts[index]
                Text(attemptLabel(attempt))
                    .font(.caption.monospaced())
                    .strikethrough(attempt.success == false, color: .red)
                    .foregroundStyle(attempt.success == false ? .red : .primary)
            }
        }
    }

    private func attemptLabel(_ attempt: CompetitionPreviewViewModel.AttemptView) -> String {
        guard !attempt.weight.isEmpty else { return "-" }
        if attempt.success == false {
            return "\(attempt.weight)x"
        }
        return attempt.weight
    }

    private func isBenchOnly(
        _ eventType: String,
        lifters: [CompetitionPreviewViewModel.PreviewLifter]
    ) -> Bool {
        let normalized = eventType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized == "b" || normalized == "bench" {
            return true
        }
        let hasSquat = lifters.contains { lifter in
            lifter.squat.contains { !isEmptyWeight($0.weight) }
        }
        let hasDeadlift = lifters.contains { lifter in
            lifter.deadlift.contains { !isEmptyWeight($0.weight) }
        }
        return !hasSquat && !hasDeadlift
    }

    private func isEmptyWeight(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return true
        }
        let normalized = trimmed.replacingOccurrences(of: ",", with: ".")
        if let number = Double(normalized), number <= 0 {
            return true
        }
        return false
    }

    private var selectedCompetition: CompetitionPreviewViewModel.PreviewCompetition? {
        if let selectedId = viewModel.selectedCompetitionId {
            return viewModel.competitions.first { $0.id == selectedId } ?? viewModel.competitions.first
        }
        return viewModel.competitions.first
    }
}

#Preview {
    CompetitionPreviewView(settings: AppSettings())
        .frame(width: 960, height: 620)
}
