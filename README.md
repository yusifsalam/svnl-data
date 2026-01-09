# SVNL Scraper

A powerlifting competition data scraper for [Suomen Voimanostoliitto](https://www.suomenvoimanostoliitto.fi/) (Finnish Powerlifting Federation). Extracts lifter results (attempts, totals, bodyweight, etc.) and exports to CSV or JSON.

## Features

- **CLI** - Command-line interface for scripting and automation
- **TUI** - Interactive terminal UI with menus
- **JSON Output** - Machine-readable output for app integration

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
```

## CLI Commands

```bash
# Discover competitions (clicks "Load more" 5 times by default)
bun run cli discover [--clicks <n>] [--browser <path>] [--json]

# List cached competitions
bun run cli list [--format table|json]

# Scrape specific competitions by ID
bun run cli scrape <ids...> [--output <dir>] [--format csv|json] [--combined] [--json]

# Scrape all cached competitions
bun run cli scrape-all [--output <dir>] [--format csv|json] [--combined] [--json]
```

The `--json` flag outputs machine-readable JSON events for integration use.
By default, `scrape`/`scrape-all` write one file per competition; pass `--combined`
to write a single CSV/JSON file.

In the TUI, per-competition output is the default; change it under Settings.

## Requirements

- **Bun** - JavaScript runtime
- **Chrome/Chromium** - Required for discovery (clicking "Load more" buttons)

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
```
