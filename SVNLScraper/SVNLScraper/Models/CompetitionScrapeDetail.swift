import Foundation
import SwiftData

@Model
final class CompetitionScrapeDetail {
    var id: UUID
    var competitionId: String
    var competitionName: String?
    var competitionDate: String?

    var liftersProcessed: Int
    var totalLifters: Int
    var timestamp: Date

    var status: Status
    var errorMessage: String?

    var scrapeJob: ScrapeJob?

    enum Status: String, Codable {
        case inProgress = "in_progress"
        case success = "success"
        case failed = "failed"
    }

    var progressPercentage: Double {
        guard totalLifters > 0 else { return 0 }
        return Double(liftersProcessed) / Double(totalLifters) * 100
    }

    init(
        competitionId: String,
        competitionName: String? = nil,
        competitionDate: String? = nil,
        liftersProcessed: Int = 0,
        totalLifters: Int = 0,
        timestamp: Date = Date(),
        status: Status = .inProgress,
        errorMessage: String? = nil
    ) {
        self.id = UUID()
        self.competitionId = competitionId
        self.competitionName = competitionName
        self.competitionDate = competitionDate
        self.liftersProcessed = liftersProcessed
        self.totalLifters = totalLifters
        self.timestamp = timestamp
        self.status = status
        self.errorMessage = errorMessage
    }
}
