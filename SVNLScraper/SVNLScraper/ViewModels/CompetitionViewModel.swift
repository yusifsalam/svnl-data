import Combine
import Foundation

enum CompetitionFilter: String, CaseIterable {
    case all = "All"
    case nationals = "Nationals"
    case local = "Local"
}

final class CompetitionViewModel: ObservableObject {
    @Published var competitions: [CompetitionMetadata] = []
    @Published var selectedIds: Set<String> = []
    @Published var isLoading = false
    @Published var statusMessage: String?
    @Published var errorMessage: String?
    @Published var errorLog: [String] = []
    @Published var selectedSource: String = "svnl"
    @Published var selectedFilter: CompetitionFilter = .all

    var filteredCompetitions: [CompetitionMetadata] {
        switch selectedFilter {
        case .all:
            return competitions
        case .nationals:
            return competitions.filter { $0.category == "nationals" }
        case .local:
            return competitions.filter { $0.category == "local" }
        }
    }

    func clearErrors() {
        errorMessage = nil
        errorLog = []
    }

    func clearSelection() {
        guard !selectedIds.isEmpty else { return }
        selectedIds.removeAll()
    }

    func loadCache(settings: AppSettings) {
        isLoading = true
        errorMessage = nil
        errorLog = []
        statusMessage = "Loading cached competitions from \(selectedSource)..."

        let service = CliService(config: settings.cliConfig)
        do {
            try service.listCompetitions(
                source: selectedSource,
                onResult: { [weak self] competitions in
                    DispatchQueue.main.async {
                        self?.competitions = competitions
                        self?.statusMessage = "Loaded \(competitions.count) competitions"
                    }
                },
                onError: { [weak self] message in
                    DispatchQueue.main.async {
                        self?.errorMessage = message
                        self?.errorLog.append(message)
                    }
                },
                onExit: { [weak self] status in
                    DispatchQueue.main.async {
                        self?.isLoading = false
                        if status != 0 {
                            self?.errorMessage = "List exited with status \(status)"
                        }
                    }
                }
            )
        } catch {
            isLoading = false
            errorMessage = "Failed to run list: \(error)"
            errorLog.append("Failed to run list: \(error)")
        }
    }

    func discover(settings: AppSettings) {
        isLoading = true
        errorMessage = nil
        errorLog = []
        statusMessage = "Discovering competitions from \(selectedSource)..."

        let service = CliService(config: settings.cliConfig)
        do {
            try service.discoverCompetitions(
                pages: settings.discoverPages,
                source: selectedSource,
                onResult: { [weak self] competitions in
                    DispatchQueue.main.async {
                        self?.competitions = competitions
                        self?.statusMessage = "Discovered \(competitions.count) competitions"
                    }
                },
                onError: { [weak self] message in
                    DispatchQueue.main.async {
                        self?.errorMessage = message
                        self?.errorLog.append(message)
                    }
                },
                onExit: { [weak self] status in
                    DispatchQueue.main.async {
                        self?.isLoading = false
                        if status != 0 {
                            self?.errorMessage = "Discover exited with status \(status)"
                        }
                    }
                }
            )
        } catch {
            isLoading = false
            errorMessage = "Failed to run discover: \(error)"
            errorLog.append("Failed to run discover: \(error)")
        }
    }
}
