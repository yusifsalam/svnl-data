# SVNL Scraper

A powerlifting competition data scraper for [Suomen Voimanostoliitto](https://www.suomenvoimanostoliitto.fi/) (Finnish Powerlifting Federation). Extracts lifter results (attempts, totals, bodyweight, etc.) and exports to CSV or JSON.

## Features

- **CLI** - Command-line interface for scripting and automation
- **TUI** - Interactive terminal UI with menus
- **Native macOS App** - GUI built with SwiftUI 
- **JSON Output** - Machine-readable output for app integration
- **Per-competition output** - One file per competition by default (combined optional)

## Quick Start

```bash
# Install Bun: https://bun.sh
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install

# Discover competitions from SVNL archive
bun run cli discover

# List cached competitions
bun run cli list

# Scrape specific competitions
bun run cli scrape svnl-pv-81 svnl-sm-2024

# Launch interactive TUI
bun run tui

# Build standalone CLI binary
bun run build:cli
```

## SwiftUI App

The macOS SwiftUI app lives in `SVNLScraper/`. It bundles the compiled CLI
binary (`svnl-cli`) and runs it for discover/scrape operations.

Open `SVNLScraper/SVNLScraper.xcodeproj` in Xcode and build the **Release**
configuration to bundle the CLI automatically. The build phase runs:

```
bun run build:cli
```

The app stores CSV/JSON output under `~/Documents/SVNLScraper` by default, and
logs under `~/Documents/SVNLScraper/logs/svnl-log.jsonl`. Both can be changed
in the app Settings. Output format (CSV/JSON) and per-competition vs combined mode are also configurable there.

## CLI Commands

```bash
# Discover competitions (clicks "Load more" 0 times by default)
bun run cli discover [--clicks <n>] [--browser <path>] [--log-dir <dir>] [--json]

# List cached competitions
bun run cli list [--format table|json]

# Scrape specific competitions by ID
bun run cli scrape <ids...> [--output <dir>] [--format csv|json] [--combined] [--log-dir <dir>] [--json]

# Scrape all cached competitions
bun run cli scrape-all [--output <dir>] [--format csv|json] [--combined] [--log-dir <dir>] [--json]
```

The `--json` flag outputs machine-readable JSON events for integration use.
By default, `scrape`/`scrape-all` write one file per competition into `./output`;
pass `--combined` to write a single CSV/JSON file.

In the TUI, output defaults to `./output`; you can change it under Settings.
Per-competition output is the default; change it under Settings. You can also
choose CSV or JSON output in Settings.

## Requirements

- **Bun** - JavaScript runtime
- **Chrome/Chromium** - Required for discovery (clicking "Load more" buttons)

## Build a Standalone CLI

Compile the CLI into a single executable for embedding or distribution:

```bash
bun run build:cli
```

The output binary is written to `dist/svnl-cli`.

You can run the binary directly:

```bash
./dist/svnl-cli discover
./dist/svnl-cli scrape svnl-pv-81
```

## How It Works

1. **Discovery** uses Puppeteer to load the SVNL archive page and click "Load more" buttons
2. **Scraping** uses simple HTTP fetch (SVNL pages don't need JavaScript)
3. **Parsing** extracts lifter data from HTML tables
4. **Export** outputs results to CSV or JSON

## CSV Fields (selected)

- `event_type` is `sbd` or `b`
- `equipment` is `raw` or `equipped`
- `weight_class` is stored as a string (e.g. `-57`, `84+`)
- attempt success columns use `*_success` suffix

## Logs

Each operation appends a JSONL entry to `svnl-log.jsonl` with the operation
name and duration in milliseconds. Scrape operations include the competition
IDs in the log details.

- Logs default to `./logs` unless `--log-dir` is set
- In the TUI, log output defaults to `./logs` and is configurable under Settings

## Configuration

Set via environment variables:

- `SVNL_BROWSER_PATH` - Path to Chrome/Chromium executable

## Project Structure

```
src/
  cli.ts        # CLI entry point (Commander)
  tui.tsx       # TUI entry point (Ink)
  scraper.ts    # Discovery + scraping logic
  parser.ts     # SVNL HTML table parser
  output.ts     # CSV/JSON export
  types.ts      # TypeScript interfaces
SVNLScraper/
  SVNLScraper.xcodeproj
  SVNLScraper/
    Resources/ # Bundled CLI (svnl-cli)
```
