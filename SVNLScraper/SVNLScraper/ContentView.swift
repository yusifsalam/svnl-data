import SwiftUI
import SwiftData

struct ContentView: View {
    @ObservedObject var settings: AppSettings
    @StateObject private var competitionViewModel = CompetitionViewModel()
    @StateObject private var scraperViewModel = ScraperViewModel()
    @State private var showingSettings = false
    @Environment(\.openWindow) private var openWindow
    @Environment(\.modelContext) private var modelContext

    var body: some View {
        NavigationSplitView {
            CompetitionListView(viewModel: competitionViewModel, settings: settings)
                .frame(minWidth: 320)
                .navigationSplitViewColumnWidth(min: 280, ideal: 350, max: 500)
        } detail: {
            ScrapeProgressView(viewModel: scraperViewModel, settings: settings)
        }
        .navigationSplitViewStyle(.balanced)
        .toolbar {
            ToolbarItemGroup(placement: .automatic) {
                Spacer()

                Button {
                    competitionViewModel.discover(settings: settings)
                } label: {
                    Label("Discover", systemImage: "globe")
                }
                .disabled(competitionViewModel.isLoading)
                .buttonStyle(.bordered)
                .tint(.blue)

                Button {
                    competitionViewModel.loadCache(settings: settings)
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(competitionViewModel.isLoading)
                .buttonStyle(.bordered)
                .tint(.blue)

                Toggle(isOn: $settings.forceMode) {
                    Label("Force", systemImage: settings.forceMode ? "bolt.fill" : "bolt.slash")
                }
                .toggleStyle(.button)
                .tint(settings.forceMode ? .orange : .gray)
                .help("Force re-scrape (bypass cache)")

                Button {
                    let ids = Array(competitionViewModel.selectedIds)
                    scraperViewModel.startScrape(ids: ids, settings: settings)
                } label: {
                    Label("Scrape", systemImage: "play.fill")
                }
                .disabled(scraperViewModel.isRunning || competitionViewModel.selectedIds.isEmpty)
                .buttonStyle(.borderedProminent)
                .tint(.green)

                Button {
                    scraperViewModel.stopScrape()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                }
                .disabled(!scraperViewModel.isRunning)
                .buttonStyle(.bordered)
                .tint(.red)


                Button {
                    openWindow(id: "csv-preview")
                } label: {
                    Label("Preview", systemImage: "doc.text.magnifyingglass")
                }
                .buttonStyle(.bordered)

                Button {
                    openWindow(id: "competition-preview")
                } label: {
                    Label("Competition Preview", systemImage: "list.bullet.rectangle")
                }
                .buttonStyle(.bordered)

                Button {
                    openWindow(id: "scrape-history")
                } label: {
                    Label("History", systemImage: "clock.arrow.circlepath")
                }
                .buttonStyle(.bordered)

                Button {
                    showingSettings = true
                } label: {
                    Label("Settings", systemImage: "gear")
                }
                .buttonStyle(.bordered)
            }
        }
        .onAppear {
            competitionViewModel.loadCache(settings: settings)
            scraperViewModel.configure(modelContext: modelContext)
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView(settings: settings)
        }
    }
}

#Preview {
    ContentView(settings: AppSettings())
}
