import SwiftUI
import SwiftData

struct HistoryView: View {
    @Environment(\.modelContext) private var modelContext
    @StateObject private var viewModel = HistoryViewModel()
    @State private var showingDeleteAllAlert = false
    @State private var showingRetentionSheet = false
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.title)
                    .foregroundStyle(.blue)
                Text("Scrape History")
                    .font(.largeTitle.bold())
                Spacer()
            }
            .padding()
            .background(.ultraThinMaterial)
            
            Divider()
            
            // Content
            HSplitView {
                jobListView
                
                if let selected = viewModel.selectedJob {
                    jobDetailView(job: selected)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        // Detail header
                        HStack {
                            Label("Details", systemImage: "info.circle")
                                .font(.headline)
                                .foregroundStyle(.secondary)
                            Spacer()
                        }
                        .padding()
                        .background(.ultraThinMaterial)
                        
                        Divider()
                        
                        ContentUnavailableView {
                            Label("No Selection", systemImage: "clock.arrow.circlepath")
                        } description: {
                            Text("Select a scrape job to view details")
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                    .frame(minWidth: 520, maxHeight: .infinity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear {
            viewModel.configure(modelContext: modelContext)
            viewModel.loadJobs()
        }
    }
    
    private var jobListView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Job list header
            HStack {
                Label("Jobs", systemImage: "list.bullet")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Spacer()
                if !viewModel.jobs.isEmpty {
                    Menu {
                        Button {
                            showingRetentionSheet = true
                        } label: {
                            Label("Delete Old Jobs...", systemImage: "calendar.badge.minus")
                        }
                        
                        Divider()
                        
                        Button(role: .destructive) {
                            showingDeleteAllAlert = true
                        } label: {
                            Label("Delete All", systemImage: "trash")
                        }
                    } label: {
                        Label("Manage", systemImage: "ellipsis.circle")
                    }
                    .menuStyle(.borderlessButton)
                }
            }
            .padding()
            .background(.ultraThinMaterial)
            
            Divider()
            
            // Job List
            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewModel.jobs.isEmpty {
                ContentUnavailableView {
                    Label("No History", systemImage: "clock")
                } description: {
                    Text("Scrape jobs will appear here")
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(selection: $viewModel.selectedJob) {
                    ForEach(viewModel.jobs) { job in
                        JobRowView(job: job)
                            .tag(job)
                            .contextMenu {
                                if job.csvFileExists, !job.outputPaths.isEmpty || job.csvFilePath != nil {
                                    Button {
                                        viewModel.openCsvFile(for: job)
                                    } label: {
                                        Label(
                                            outputActionLabel(for: job),
                                            systemImage: outputActionIcon(for: job)
                                        )
                                    }
                                    
                                    Button {
                                        viewModel.revealCsvFile(for: job)
                                    } label: {
                                        Label("Show in Finder", systemImage: "folder")
                                    }
                                    
                                    Divider()
                                }
                                
                                Button(role: .destructive) {
                                    viewModel.deleteJob(job)
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                    }
                }
                .listStyle(.sidebar)
            }
        }
        .frame(minWidth: 260, idealWidth: 320, maxWidth: 380, maxHeight: .infinity)
        .layoutPriority(1)
        .alert("Delete All Jobs?", isPresented: $showingDeleteAllAlert) {
            Button("Cancel", role: .cancel) {}
            Button("Delete All", role: .destructive) {
                viewModel.deleteAllJobs()
            }
        } message: {
            Text("This will permanently delete all scrape job history. This action cannot be undone.")
        }
        .sheet(isPresented: $showingRetentionSheet) {
            RetentionPolicySheet(viewModel: viewModel)
        }
    }
    
    private func jobDetailView(job: ScrapeJob) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            // Detail header
            HStack {
                Label("Details", systemImage: "info.circle")
                    .font(.headline)
                    .foregroundStyle(.secondary)
                Spacer()
                StatusBadge(job: job)
                Text(job.formattedDuration)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.ultraThinMaterial, in: Capsule())
            }
            .padding()
            .background(.ultraThinMaterial)
            
            Divider()
            
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Job info
                    VStack(alignment: .leading, spacing: 8) {
                        Text(job.startTime.formatted(date: .long, time: .shortened))
                            .font(.title2.bold())
                        
                        if job.csvFileExists, !job.outputPaths.isEmpty || job.csvFilePath != nil {
                            HStack(spacing: 8) {
                                Button {
                                    viewModel.openCsvFile(for: job)
                                } label: {
                                    Label(
                                        outputActionLabel(for: job),
                                        systemImage: outputActionIcon(for: job)
                                    )
                                }
                                .buttonStyle(.borderedProminent)
                                
                                Button {
                                    viewModel.revealCsvFile(for: job)
                                } label: {
                                    Label("Show in Finder", systemImage: "folder")
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                    .padding()
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    
                    // Summary Stats
                    LazyVGrid(columns: [
                        GridItem(.flexible()),
                        GridItem(.flexible()),
                        GridItem(.flexible())
                    ], spacing: 16) {
                        StatCard(
                            title: "Total Competitions",
                            value: "\(job.totalCompetitions)",
                            icon: "list.number",
                            color: .blue
                        )
                        
                        StatCard(
                            title: "Successful",
                            value: "\(job.successfulCompetitions)",
                            icon: "checkmark.circle.fill",
                            color: .green
                        )
                        
                        StatCard(
                            title: "Failed",
                            value: "\(job.failedCompetitions)",
                            icon: "xmark.circle.fill",
                            color: .red
                        )
                        
                        StatCard(
                            title: "Lifters Processed",
                            value: "\(job.totalLiftersProcessed)",
                            icon: "person.3.fill",
                            color: .purple
                        )
                    }
                    
                    // Settings Snapshot
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Settings", systemImage: "gear")
                            .font(.headline)
                        
                        VStack(alignment: .leading, spacing: 8) {
                            SettingRow(label: "Headless Mode", value: job.headlessMode ? "On" : "Off")
                            SettingRow(label: "Chrome Path", value: job.chromePath ?? "Default")
                            SettingRow(label: "Output Directory", value: job.outputDirectory)
                            if !job.outputPaths.isEmpty {
                                SettingRow(
                                    label: "Output Files",
                                    value: "\(job.outputPaths.count)",
                                    exists: job.csvFileExists
                                )
                                ForEach(job.outputPaths.sorted(), id: \.self) { path in
                                    SettingRow(
                                        label: "File",
                                        value: URL(fileURLWithPath: path).lastPathComponent,
                                        exists: FileManager.default.fileExists(atPath: path)
                                    )
                                }
                            } else if let csvPath = job.csvFilePath {
                                SettingRow(
                                    label: "Output File",
                                    value: URL(fileURLWithPath: csvPath).lastPathComponent,
                                    exists: job.csvFileExists
                                )
                            }
                        }
                    }
                    .padding()
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    
                    // Competition Details
                    if !job.competitionDetails.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Competition Details", systemImage: "list.bullet")
                                .font(.headline)
                            
                            ForEach(job.competitionDetails.sorted(by: { $0.timestamp < $1.timestamp })) { detail in
                                CompetitionDetailRow(detail: detail)
                            }
                        }
                        .padding()
                        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                .padding()
            }
            .frame(minWidth: 520, maxHeight: .infinity)
        }
    }
}

// MARK: - Supporting Views

struct JobRowView: View {
    let job: ScrapeJob

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(job.startTime.formatted(date: .abbreviated, time: .shortened))
                    .font(.system(.body, design: .rounded, weight: .medium))

                Spacer()

                StatusBadge(job: job)
            }

            HStack(spacing: 12) {
                Label("\(job.successfulCompetitions)/\(job.totalCompetitions)", systemImage: "checkmark.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(job.formattedDuration)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if job.csvFileExists {
                    Image(systemName: "doc.text.fill")
                        .font(.caption)
                        .foregroundStyle(.blue)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private func outputActionLabel(for job: ScrapeJob) -> String {
    if job.outputPaths.count > 1 {
        return "Open Output Folder"
    }
    return "Open Output File"
}

private func outputActionIcon(for job: ScrapeJob) -> String {
    if job.outputPaths.count > 1 {
        return "folder"
    }
    return "doc.text"
}

struct StatusBadge: View {
    let job: ScrapeJob

    var body: some View {
        Text(job.statusDescription)
            .font(.caption2.bold())
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(statusColor, in: Capsule())
    }

    private var statusColor: Color {
        if !job.isComplete {
            return .orange
        } else if job.wasStopped {
            return .gray
        } else if job.failedCompetitions == 0 {
            return .green
        } else if job.successfulCompetitions == 0 {
            return .red
        } else {
            return .yellow
        }
    }
}

struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(color)

            Text(value)
                .font(.title.bold())

            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct SettingRow: View {
    let label: String
    let value: String
    var exists: Bool = true

    var body: some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)

            Spacer()

            HStack(spacing: 4) {
                if !exists {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }

                Text(value)
                    .font(.caption.monospaced())
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }
}

struct CompetitionDetailRow: View {
    let detail: CompetitionScrapeDetail

    var body: some View {
        HStack(spacing: 12) {
            // Status icon
            Image(systemName: detail.status == .success ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(detail.status == .success ? .green : .red)

            VStack(alignment: .leading, spacing: 4) {
                Text(detail.competitionName ?? detail.competitionId)
                    .font(.subheadline.bold())

                if let date = detail.competitionDate {
                    Text(date)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let error = detail.errorMessage {
                    Text("Error: \(error)")
                        .font(.caption)
                        .foregroundStyle(.red)
                } else {
                    Text("\(detail.liftersProcessed) lifters")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            if detail.totalLifters > 0 {
                Text(String(format: "%.0f%%", detail.progressPercentage))
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(.background, in: RoundedRectangle(cornerRadius: 8))
    }
}

struct RetentionPolicySheet: View {
    @ObservedObject var viewModel: HistoryViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var selectedDays = 30

    let dayOptions = [7, 14, 30, 60, 90, 180, 365]

    var body: some View {
        VStack(spacing: 20) {
            Text("Delete Old Jobs")
                .font(.title2.bold())

            Text("Delete scrape jobs older than:")
                .foregroundStyle(.secondary)

            Picker("Days", selection: $selectedDays) {
                ForEach(dayOptions, id: \.self) { days in
                    Text("\(days) days").tag(days)
                }
            }
            .pickerStyle(.segmented)

            HStack {
                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)

                Button("Delete") {
                    viewModel.deleteOldJobs(olderThanDays: selectedDays)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
            }
        }
        .padding()
        .frame(width: 400)
    }
}

#Preview {
    do {
        let container = try ModelContainer(for: ScrapeJob.self, CompetitionScrapeDetail.self)
        return HistoryView()
            .modelContainer(container)
    } catch {
        return Text("Failed to create preview: \(error)")
    }
}
