import Foundation
import SwiftData

@Model
final class ScrapeJob {
    // Identity
    var id: UUID
    var startTime: Date
    var endTime: Date?

    // Status
    var isComplete: Bool
    var wasStopped: Bool

    // Metrics
    var totalCompetitions: Int
    var successfulCompetitions: Int
    var failedCompetitions: Int
    var totalLiftersProcessed: Int

    // CSV Output
    var csvFilePath: String?
    var csvFileExists: Bool
    var outputPathsData: Data?

    // Settings Snapshot
    var headlessMode: Bool
    var chromePath: String?
    var outputDirectory: String

    // Relationships
    @Relationship(deleteRule: .cascade, inverse: \CompetitionScrapeDetail.scrapeJob)
    var competitionDetails: [CompetitionScrapeDetail]

    // Computed Properties
    var duration: TimeInterval? {
        guard let end = endTime else { return nil }
        return end.timeIntervalSince(startTime)
    }

    var formattedDuration: String {
        guard let duration = duration else { return "In Progress" }
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }

    var statusDescription: String {
        if !isComplete {
            return "In Progress"
        } else if wasStopped {
            return "Stopped"
        } else if failedCompetitions == 0 {
            return "Success"
        } else if successfulCompetitions == 0 {
            return "Failed"
        } else {
            return "Partial Success"
        }
    }

    init(
        startTime: Date = Date(),
        headlessMode: Bool,
        chromePath: String?,
        outputDirectory: String,
        totalCompetitions: Int
    ) {
        self.id = UUID()
        self.startTime = startTime
        self.endTime = nil
        self.isComplete = false
        self.wasStopped = false
        self.totalCompetitions = totalCompetitions
        self.successfulCompetitions = 0
        self.failedCompetitions = 0
        self.totalLiftersProcessed = 0
        self.csvFilePath = nil
        self.csvFileExists = false
        self.outputPathsData = nil
        self.headlessMode = headlessMode
        self.chromePath = chromePath
        self.outputDirectory = outputDirectory
        self.competitionDetails = []
    }
}

extension ScrapeJob {
    var outputPaths: [String] {
        get {
            guard let data = outputPathsData, !data.isEmpty else { return [] }
            return (try? JSONDecoder().decode([String].self, from: data)) ?? []
        }
        set {
            outputPathsData = (try? JSONEncoder().encode(newValue)) ?? Data()
        }
    }
}
