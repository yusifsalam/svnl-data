import Foundation

public final class CliService {
    public struct Config {
        public let outputDir: String?
        public let logDir: String?
        public let headless: Bool
        public let chromePath: String?
        public let combinedOutput: Bool
        public let force: Bool

        public init(
            outputDir: String? = nil,
            logDir: String? = nil,
            headless: Bool = true,
            chromePath: String? = nil,
            combinedOutput: Bool = false,
            force: Bool = false
        ) {
            self.outputDir = outputDir
            self.logDir = logDir
            self.headless = headless
            self.chromePath = chromePath
            self.combinedOutput = combinedOutput
            self.force = force
        }
    }

    public enum CliServiceError: Error {
        case cliNotFound
    }

    private let config: Config
    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    public init(config: Config) {
        self.config = config
    }

    public static func bundledCliPath() -> String? {
        let candidates = ["svnl-cli", "svnl", "rauta-cli"]
        for name in candidates {
            if let url = Bundle.main.url(forResource: name, withExtension: nil) {
                return url.path
            }
            let fallback = Bundle.main.bundleURL
                .appendingPathComponent("Contents/Resources/\(name)")
            if FileManager.default.fileExists(atPath: fallback.path) {
                return fallback.path
            }
        }
        return nil
    }

    private func defaultAppOutputDir() -> String {
        let base = FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first?
            .path ?? NSTemporaryDirectory()
        return (base as NSString).appendingPathComponent("SVNLScraper/output")
    }

    private func resolveOutputDir() -> String {
        if let configured = config.outputDir?.trimmingCharacters(in: .whitespacesAndNewlines),
           !configured.isEmpty {
            do {
                try FileManager.default.createDirectory(
                    atPath: configured,
                    withIntermediateDirectories: true,
                    attributes: nil
                )
                return configured
            } catch {
            // Fallback to app output on failure.
            }
        }
        let fallback = defaultAppOutputDir()
        do {
            try FileManager.default.createDirectory(
                atPath: fallback,
                withIntermediateDirectories: true,
                attributes: nil
            )
        } catch {
        }
        return fallback
    }

    private func resolveLogDir() -> String? {
        if let configured = config.logDir?.trimmingCharacters(in: .whitespacesAndNewlines),
           !configured.isEmpty {
            do {
                try FileManager.default.createDirectory(
                    atPath: configured,
                    withIntermediateDirectories: true,
                    attributes: nil
                )
            } catch {
            }
            return configured
        }
        if let output = config.outputDir?.trimmingCharacters(in: .whitespacesAndNewlines),
           !output.isEmpty {
            return output
        }
        return nil
    }

    public func terminate() {
        process?.interrupt()
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            if let process = self?.process, process.isRunning {
                process.terminate()
            }
        }
    }

    public func discoverCompetitions(
        pages: Int,
        source: String? = nil,
        onResult: @escaping ([CompetitionMetadata]) -> Void,
        onError: @escaping (String) -> Void,
        onExit: @escaping (Int32) -> Void
    ) throws {
        var args = ["discover", "--clicks", "\(pages)", "--json"]
        if let chromePath = config.chromePath, !chromePath.isEmpty {
            args.append(contentsOf: ["--browser", chromePath])
        }
        if let logDir = resolveLogDir() {
            args.append(contentsOf: ["--log-dir", logDir])
        }

        try runJSONCommand(
            args: args,
            onLine: { line in
                guard let data = line.data(using: .utf8) else { return }
                guard let json = try? JSONSerialization.jsonObject(with: data),
                      let payload = json as? [String: Any],
                      let type = payload["type"] as? String else {
                    return
                }
                if type == "complete", let rawData = payload["data"] {
                    do {
                        let jsonData = try JSONSerialization.data(withJSONObject: rawData)
                        let decoder = JSONDecoder()
                        decoder.dateDecodingStrategy = .iso8601
                        let competitions = try decoder.decode([CompetitionMetadata].self, from: jsonData)
                        onResult(competitions)
                    } catch {
                        onError("Failed to decode competitions: \(error)")
                    }
                } else if type == "error", let message = payload["message"] as? String {
                    onError(message)
                }
            },
            onError: onError,
            onExit: onExit
        )
    }

    public func listCompetitions(
        source: String? = nil,
        onResult: @escaping ([CompetitionMetadata]) -> Void,
        onError: @escaping (String) -> Void,
        onExit: @escaping (Int32) -> Void
    ) throws {
        let args = ["list", "--format", "json"]

        try runCommandCollectingOutput(
            args: args,
            onOutput: { output in
                do {
                    let decoder = JSONDecoder()
                    decoder.dateDecodingStrategy = .iso8601
                    let data = Data(output.utf8)
                    let competitions = try decoder.decode([CompetitionMetadata].self, from: data)
                    onResult(competitions)
                } catch {
                    onError("Failed to decode cached competitions: \(error)")
                }
            },
            onError: onError,
            onExit: onExit
        )
    }

    public func scrapeCompetitions(
        ids: [String],
        onEvent: @escaping (CliEvent) -> Void,
        onError: @escaping (String) -> Void,
        onExit: @escaping (Int32) -> Void
    ) throws {
        var args = ["scrape", "--json"]
        let outputDir = resolveOutputDir()
        args.append(contentsOf: ["--output", outputDir])
        if let logDir = resolveLogDir() {
            args.append(contentsOf: ["--log-dir", logDir])
        }
        if config.combinedOutput {
            args.append("--combined")
        }
        if config.force {
            args.append("--force")
        }
        args.append(contentsOf: ids)
        try runJSONCommand(
            args: args,
            onLine: { line in
                do {
                    let data = Data(line.utf8)
                    let event = try JSONDecoder().decode(CliEvent.self, from: data)
                    onEvent(event)
                } catch {
                    onError("Failed to decode progress event: \(error)")
                }
            },
            onError: onError,
            onExit: onExit
        )
    }

    private func runJSONCommand(
        args: [String],
        onLine: @escaping (String) -> Void,
        onError: @escaping (String) -> Void,
        onExit: @escaping (Int32) -> Void
    ) throws {
        let (process, stdoutPipe, stderrPipe) = try makeProcess(args: args)

        self.process = process
        self.stdoutPipe = stdoutPipe
        self.stderrPipe = stderrPipe

        var stdoutBuffer = Data()
        var stderrBuffer = Data()
        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                return
            }
            stdoutBuffer.append(data)
            while let range = stdoutBuffer.range(of: Data([0x0A])) {
                let lineData = stdoutBuffer.subdata(in: stdoutBuffer.startIndex..<range.lowerBound)
                stdoutBuffer.removeSubrange(stdoutBuffer.startIndex...range.lowerBound)
                if let line = String(data: lineData, encoding: .utf8), !line.isEmpty {
                    onLine(line)
                }
            }
        }

        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                return
            }
            // Append to buffer but limit size to avoid memory leaks
            stderrBuffer.append(data)
            if stderrBuffer.count > 4096 {
                stderrBuffer.removeSubrange(0..<(stderrBuffer.count - 4096))
            }
            
            if let text = String(data: data, encoding: .utf8), !text.isEmpty {
                onError(text.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }

        process.terminationHandler = { [weak self] process in
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            self?.process = nil
            if process.terminationStatus != 0 {
                // Only report from buffer if we haven't streamed anything recently or if it's a hard crash
                // But since we stream stderr, usually we don't need to dump the whole buffer again.
                // Just report the exit code.
                onError("Process exited with status \(process.terminationStatus)")
            }
            onExit(process.terminationStatus)
        }

        try process.run()
    }

    private func runCommandCollectingOutput(
        args: [String],
        onOutput: @escaping (String) -> Void,
        onError: @escaping (String) -> Void,
        onExit: @escaping (Int32) -> Void
    ) throws {
        let (process, stdoutPipe, stderrPipe) = try makeProcess(args: args)

        self.process = process
        self.stdoutPipe = stdoutPipe
        self.stderrPipe = stderrPipe

        var stdoutBuffer = Data()
        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                return
            }
            stdoutBuffer.append(data)
        }

        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                return
            }
            if let text = String(data: data, encoding: .utf8), !text.isEmpty {
                onError(text.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }

        process.terminationHandler = { [weak self] process in
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            self?.process = nil

            if let output = String(data: stdoutBuffer, encoding: .utf8), !output.isEmpty {
                onOutput(output)
            }

            onExit(process.terminationStatus)
        }

        try process.run()
    }

    private func makeProcess(args: [String]) throws -> (Process, Pipe, Pipe) {
        let process = Process()
        guard let bundledCli = Self.bundledCliPath() else {
            throw CliServiceError.cliNotFound
        }
        process.executableURL = URL(fileURLWithPath: bundledCli)
        process.arguments = args
        process.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser

        var environment = ProcessInfo.processInfo.environment
        if let chromePath = config.chromePath, !chromePath.isEmpty {
            environment["SVNL_BROWSER_PATH"] = chromePath
        }
        process.environment = environment

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        return (process, stdoutPipe, stderrPipe)
    }

}

extension CliService.CliServiceError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .cliNotFound:
            return "Bundled CLI not found."
        }
    }
}
