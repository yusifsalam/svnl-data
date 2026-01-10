import SwiftUI
import SwiftData

@main
struct SVNLScraperApp: App {
    @StateObject private var settings = AppSettings()

    let modelContainer: ModelContainer

    init() {
        do {
            modelContainer = try ModelContainer(for: ScrapeJob.self, CompetitionScrapeDetail.self)
        } catch {
            fatalError("Failed to initialize ModelContainer: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            ContentView(settings: settings)
                .frame(minWidth: 900, minHeight: 600)
                .modelContainer(modelContainer)
        }
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unified)

        Window("CSV Preview", id: "csv-preview") {
            CsvPreviewView(settings: settings)
                .modelContainer(modelContainer)
        }
        .defaultSize(width: 900, height: 520)

        Window("Competition Preview", id: "competition-preview") {
            CompetitionPreviewView(settings: settings)
                .modelContainer(modelContainer)
        }
        .defaultSize(width: 1100, height: 720)

        Window("Scrape History", id: "scrape-history") {
            HistoryView()
                .modelContainer(modelContainer)
        }
        .defaultSize(width: 1000, height: 700)
    }
}
