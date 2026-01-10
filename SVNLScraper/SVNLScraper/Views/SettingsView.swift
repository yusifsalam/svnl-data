import SwiftUI

struct SettingsView: View {
    @ObservedObject var settings: AppSettings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Image(systemName: "gear")
                    .font(.title)
                    .foregroundStyle(.blue)
                Text("Settings")
                    .font(.largeTitle.bold())
                Spacer()
            }
            .padding()
            .background(.ultraThinMaterial)

            Divider()


            ScrollView {
                VStack(spacing: 20) {
                    VStack(alignment: .leading, spacing: 16) {
                        Label("Paths", systemImage: "folder")
                            .font(.headline)
                            .foregroundStyle(.secondary)

                        VStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Output Directory")
                                    .font(.subheadline.bold())
                                HStack {
                                    TextField("Default location", text: $settings.outputDir)
                                        .textFieldStyle(.roundedBorder)
                                    Button {
                                        let panel = NSOpenPanel()
                                        panel.allowsMultipleSelection = false
                                        panel.canChooseDirectories = true
                                        panel.canChooseFiles = false
                                        panel.title = "Select Output Directory"
                                        panel.prompt = "Select"

                                        if panel.runModal() == .OK, let url = panel.url {
                                            settings.setOutputURL(url)
                                        }
                                    } label: {
                                        Label("Browse", systemImage: "folder.badge.plus")
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                            .padding()
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))

                            VStack(alignment: .leading, spacing: 8) {
                                Text("Log Directory")
                                    .font(.subheadline.bold())
                                HStack {
                                    TextField("Default location", text: $settings.logDir)
                                        .textFieldStyle(.roundedBorder)
                                    Button {
                                        let panel = NSOpenPanel()
                                        panel.allowsMultipleSelection = false
                                        panel.canChooseDirectories = true
                                        panel.canChooseFiles = false
                                        panel.title = "Select Log Directory"
                                        panel.prompt = "Select"

                                        if panel.runModal() == .OK, let url = panel.url {
                                            settings.setLogURL(url)
                                        }
                                    } label: {
                                        Label("Browse", systemImage: "folder.badge.plus")
                                    }
                                    .buttonStyle(.bordered)
                                }
                                Text("Logs are saved to svnl-log.jsonl in this folder")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding()
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))

                            VStack(alignment: .leading, spacing: 8) {
                                Text("Output Mode")
                                    .font(.subheadline.bold())
                                Picker("Output Mode", selection: $settings.combinedOutput) {
                                    Text("Per competition").tag(false)
                                    Text("Combined file").tag(true)
                                }
                                .pickerStyle(.segmented)
                                .labelsHidden()
                                Text("Combined output writes a single file for all competitions.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding()
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))

                            VStack(alignment: .leading, spacing: 8) {
                                Text("Chrome Path")
                                    .font(.subheadline.bold())
                                TextField("Auto-detect", text: $settings.chromePath)
                                    .textFieldStyle(.roundedBorder)
                                Text("Leave empty to auto-detect Chrome installation")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .padding()
                            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                        }
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        Label("Browser", systemImage: "safari")
                            .font(.headline)
                            .foregroundStyle(.secondary)

                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Headless Mode")
                                    .font(.subheadline.bold())
                                Text("Run browser invisibly in the background")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Toggle("", isOn: $settings.headlessMode)
                                .labelsHidden()
                                .toggleStyle(.switch)
                        }
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        Label("Discovery", systemImage: "magnifyingglass")
                            .font(.headline)
                            .foregroundStyle(.secondary)

                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Pages to Fetch")
                                        .font(.subheadline.bold())
                                    Text("Number of result pages to discover")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Stepper(value: $settings.discoverPages, in: 1 ... 20) {
                                    Text("\(settings.discoverPages)")
                                        .font(.title3.bold())
                                        .foregroundStyle(.blue)
                                        .frame(minWidth: 40)
                                }
                            }
                        }
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                .padding()
            }

            Divider()

            HStack {
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Text("Done")
                        .frame(minWidth: 80)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
            .padding()
            .background(.ultraThinMaterial)
        }
        .frame(minWidth: 600, minHeight: 500)
    }
}

#Preview {
    SettingsView(settings: AppSettings())
        .frame(width: 840, height: 480)
}
