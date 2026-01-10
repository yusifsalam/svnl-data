import SwiftUI

struct CompetitionListView: View {
    @ObservedObject var viewModel: CompetitionViewModel
    let settings: AppSettings

    private enum PaintAction {
        case add
        case erase
    }

    private let paintEnabled = true
    private let rowHeight: CGFloat = 92
    private let rowSpacing: CGFloat = 10
    private let listPadding: CGFloat = 16
    @State private var dragAction: PaintAction?
    @State private var lastPaintedId: String?
    @State private var selectedFilter: CompetitionFilter = .all

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: "list.bullet.clipboard")
                        .font(.title2)
                        .foregroundStyle(.blue)
                    Text("Competitions")
                        .font(.title2.bold())
                    Spacer()
                    if !viewModel.competitions.isEmpty {
                        Text("\(viewModel.selectedIds.count) selected")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                }

                Picker("Filter", selection: $selectedFilter) {
                    ForEach(CompetitionFilter.allCases, id: \.self) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .onAppear {
                    selectedFilter = viewModel.selectedFilter
                }
                .onChange(of: selectedFilter) { _, newValue in
                    Task { @MainActor in
                        viewModel.selectedFilter = newValue
                    }
                }
            }
            .padding()
            .background(.ultraThinMaterial)

            Divider()

            if viewModel.competitions.isEmpty {
                VStack(spacing: 16) {
                    Spacer()
                    Image(systemName: "tray")
                        .font(.system(size: 48))
                        .foregroundStyle(.tertiary)
                    Text("No cached competitions")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    Text("Click 'Discover' to fetch competitions")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: rowSpacing) {
                        ForEach(viewModel.filteredCompetitions) { competition in
                            CompetitionRow(
                                competition: competition,
                                isSelected: viewModel.selectedIds.contains(competition.id)
                            )
                            .contentShape(Rectangle())
                            .simultaneousGesture(
                                TapGesture().onEnded {
                                    toggleSelection(for: competition.id)
                                }
                            )
                            .frame(height: rowHeight)
                        }
                    }
                    .padding(listPadding)
                }
                .coordinateSpace(name: "competitionList")
                .gesture(
                    DragGesture(minimumDistance: 0, coordinateSpace: .named("competitionList"))
                        .onChanged { value in
                            guard paintEnabled else { return }
                            if dragAction == nil, let id = rowId(at: value.location) {
                                dragAction = viewModel.selectedIds.contains(id) ? .erase : .add
                            }
                            guard let action = dragAction,
                                  let id = rowId(at: value.location),
                                  id != lastPaintedId else { return }
                            switch action {
                            case .add:
                                viewModel.selectedIds.insert(id)
                            case .erase:
                                viewModel.selectedIds.remove(id)
                            }
                            lastPaintedId = id
                        }
                        .onEnded { _ in
                            lastPaintedId = nil
                            dragAction = nil
                        }
                )
            }

            // Status footer
            if viewModel.statusMessage != nil || viewModel.errorMessage != nil || !viewModel.errorLog.isEmpty {
                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    if let message = viewModel.statusMessage {
                        Label(message, systemImage: "info.circle")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let error = viewModel.errorMessage {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    if !viewModel.errorLog.isEmpty {
                        HStack {
                            Label("Errors", systemImage: "exclamationmark.circle")
                                .font(.caption.bold())
                                .foregroundStyle(.red)
                            Spacer()
                            Button("Clear") {
                                viewModel.clearErrors()
                            }
                            .buttonStyle(.plain)
                            .font(.caption)
                        }

                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(Array(viewModel.errorLog.prefix(5).enumerated()), id: \.offset) { _, line in
                                Text(line)
                                    .font(.caption2)
                                    .foregroundStyle(.red.opacity(0.8))
                                    .lineLimit(2)
                            }
                            if viewModel.errorLog.count > 5 {
                                Text("+ \(viewModel.errorLog.count - 5) more errors")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.red.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
                .padding()
                .background(.ultraThinMaterial)
            }
        }
    }

    private func rowId(at location: CGPoint) -> String? {
        let y = location.y - listPadding
        if y < 0 {
            return nil
        }
        let stride = rowHeight + rowSpacing
        let index = Int(y / stride)
        guard index >= 0, index < viewModel.filteredCompetitions.count else { return nil }
        return viewModel.filteredCompetitions[index].id
    }

    private func toggleSelection(for id: String) {
        if viewModel.selectedIds.contains(id) {
            viewModel.selectedIds.remove(id)
        } else {
            viewModel.selectedIds.insert(id)
        }
    }
}

private struct CompetitionRow: View {
    let competition: CompetitionMetadata
    let isSelected: Bool
    @State private var isHovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(competition.name ?? "Unnamed Competition")
                        .font(.system(.body, design: .rounded, weight: .semibold))
                        .lineLimit(2)

                    HStack(spacing: 12) {
                        Label(competition.id, systemImage: "number")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let date = competition.date {
                            Label(date, systemImage: "calendar")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let source = competition.source {
                            Text(source.uppercased())
                                .font(.system(size: 9, weight: .bold))
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(.blue.opacity(0.1), in: RoundedRectangle(cornerRadius: 4))
                                .foregroundStyle(.blue)
                        }
                    }
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title3)
                        .foregroundStyle(.blue)
                        .transition(.scale.combined(with: .opacity))
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            if isSelected {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.blue.opacity(0.15))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(.blue.opacity(0.3), lineWidth: 1.5)
                    }
            } else {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.regularMaterial)
                    .shadow(color: .black.opacity(isHovered ? 0.15 : 0.05), radius: isHovered ? 8 : 4, y: isHovered ? 4 : 2)
            }
        }
        .overlay {
            if !isSelected && isHovered {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(.blue.opacity(0.2), lineWidth: 1)
            }
        }
        .onHover { hovering in
            withAnimation(.easeInOut(duration: 0.2)) {
                isHovered = hovering
            }
        }
        .scaleEffect(isHovered && !isSelected ? 1.01 : 1.0)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isSelected)
        .animation(.easeInOut(duration: 0.2), value: isHovered)
    }
}

#Preview {
    let viewModel = CompetitionViewModel()
    viewModel.competitions = [
        CompetitionMetadata(
            id: "svnl-sm-2024",
            url: "https://svnl.fi/sm-2024/",
            name: "SM-kilpailu 2024",
            date: "20.12.2025",
            category: "nationals",
            lastUpdated: Date(),
            source: "svnl"
        ),
        CompetitionMetadata(
            id: "svnl-local-2024",
            url: "https://svnl.fi/local-2024/",
            name: "Paikallinen kilpailu",
            date: "21.12.2025",
            category: "local",
            lastUpdated: Date(),
            source: "svnl"
        )
    ]
    viewModel.selectedIds = ["svnl-sm-2024"]
    viewModel.statusMessage = "Loaded 3 competitions"
    return CompetitionListView(viewModel: viewModel, settings: AppSettings())
        .frame(width: 360, height: 520)
}
