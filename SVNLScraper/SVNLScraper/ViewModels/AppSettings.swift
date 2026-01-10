import Combine
import Foundation

final class AppSettings: ObservableObject {
    @Published var outputDir: String {
        didSet {
            guard !isLoading else { return }
            normalizeOutputDir()
        }
    }
    @Published var combinedOutput: Bool {
        didSet {
            guard !isLoading else { return }
            save()
        }
    }
    @Published var logDir: String {
        didSet {
            guard !isLoading else { return }
            normalizeLogDir()
        }
    }
    @Published var headlessMode: Bool {
        didSet {
            guard !isLoading else { return }
            save()
        }
    }
    @Published var chromePath: String {
        didSet {
            guard !isLoading else { return }
            save()
        }
    }
    @Published var discoverPages: Int {
        didSet {
            guard !isLoading else { return }
            save()
        }
    }
    @Published var forceMode: Bool {
        didSet {
            guard !isLoading else { return }
            save()
        }
    }

    private let defaults = UserDefaults.standard
    private var isNormalizingOutput = false
    private var isNormalizingLog = false
    private var isLoading = true

    private enum Keys {
        static let outputDir = "svnl.outputDir"
        static let combinedOutput = "svnl.combinedOutput"
        static let logDir = "svnl.logDir"
        static let headlessMode = "svnl.headlessMode"
        static let chromePath = "svnl.chromePath"
        static let discoverPages = "svnl.discoverPages"
        static let forceMode = "svnl.forceMode"
    }

    init() {
        let savedOutput = defaults.string(forKey: Keys.outputDir) ?? ""
        if savedOutput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            outputDir = Self.defaultOutputDir()
        } else {
            outputDir = savedOutput
        }
        let savedLogDir = defaults.string(forKey: Keys.logDir) ?? ""
        if savedLogDir.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            logDir = Self.defaultLogDir()
        } else {
            logDir = savedLogDir
        }
        if defaults.object(forKey: Keys.combinedOutput) == nil {
            combinedOutput = false
        } else {
            combinedOutput = defaults.bool(forKey: Keys.combinedOutput)
        }
        if defaults.object(forKey: Keys.headlessMode) == nil {
            headlessMode = true
        } else {
            headlessMode = defaults.bool(forKey: Keys.headlessMode)
        }
        chromePath = defaults.string(forKey: Keys.chromePath) ?? ""
        let pages = defaults.integer(forKey: Keys.discoverPages)
        discoverPages = pages > 0 ? pages : 5
        if defaults.object(forKey: Keys.forceMode) == nil {
            forceMode = false
        } else {
            forceMode = defaults.bool(forKey: Keys.forceMode)
        }
        isLoading = false
    }

    var cliConfig: CliService.Config {
        CliService.Config(
            outputDir: outputDir.isEmpty ? nil : outputDir,
            logDir: logDir.isEmpty ? nil : logDir,
            headless: headlessMode,
            chromePath: chromePath.isEmpty ? nil : chromePath,
            combinedOutput: combinedOutput,
            force: forceMode
        )
    }

    func setOutputURL(_ url: URL) {
        outputDir = url.path
    }

    func setLogURL(_ url: URL) {
        logDir = url.path
    }

    private func save() {
        defaults.set(outputDir, forKey: Keys.outputDir)
        defaults.set(combinedOutput, forKey: Keys.combinedOutput)
        defaults.set(logDir, forKey: Keys.logDir)
        defaults.set(headlessMode, forKey: Keys.headlessMode)
        defaults.set(chromePath, forKey: Keys.chromePath)
        defaults.set(discoverPages, forKey: Keys.discoverPages)
        defaults.set(forceMode, forKey: Keys.forceMode)
    }

    private func normalizeOutputDir() {
        if isNormalizingOutput {
            return
        }
        let trimmed = outputDir.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            isNormalizingOutput = true
            outputDir = Self.defaultOutputDir()
            isNormalizingOutput = false
            return
        }
        _ = Self.ensureDirectory(trimmed)
        save()
    }

    private func normalizeLogDir() {
        if isNormalizingLog {
            return
        }
        let trimmed = logDir.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            isNormalizingLog = true
            logDir = Self.defaultLogDir()
            isNormalizingLog = false
            return
        }
        _ = Self.ensureDirectory(trimmed)
        save()
    }

    private static func defaultOutputDir() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let documents = "\(home)/Documents/SVNLScraper"
        if ensureDirectory(documents) {
            return documents
        }
        let base = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .path ?? NSTemporaryDirectory()
        let fallback = "\(base)/SVNLScraper/output"
        _ = ensureDirectory(fallback)
        return fallback
    }

    private static func defaultLogDir() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let documents = "\(home)/Documents/SVNLScraper/logs"
        if ensureDirectory(documents) {
            return documents
        }
        let base = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .path ?? NSTemporaryDirectory()
        let fallback = "\(base)/SVNLScraper/logs"
        _ = ensureDirectory(fallback)
        return fallback
    }

    private static func ensureDirectory(_ path: String) -> Bool {
        do {
            try FileManager.default.createDirectory(
                atPath: path,
                withIntermediateDirectories: true,
                attributes: nil
            )
            return true
        } catch {
            return false
        }
    }

}
