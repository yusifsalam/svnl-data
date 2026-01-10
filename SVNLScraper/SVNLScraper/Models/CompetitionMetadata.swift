import Foundation

public struct CompetitionMetadata: Codable, Identifiable {
    public let id: String
    public let url: String
    public let name: String?
    public let date: String?
    public let category: String? // "nationals" or "local"
    public let lastUpdated: Date?
    public let source: String?

    public init(id: String, url: String, name: String? = nil, date: String? = nil, category: String? = nil, lastUpdated: Date? = nil, source: String? = nil) {
        self.id = id
        self.url = url
        self.name = name
        self.date = date
        self.category = category
        self.lastUpdated = lastUpdated
        self.source = source
    }
}
