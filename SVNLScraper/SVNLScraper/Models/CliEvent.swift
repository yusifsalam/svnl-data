import Foundation

public struct CliEvent: Codable {
    public let type: String
    public let message: String?
    public let data: CliEventData?
}

public struct CliEventData: Codable {
    public let outputPath: String?
    public let outputPaths: [String]?
    public let competitions: Int?
    public let lifters: Int?
}
