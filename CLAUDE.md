# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

A powerlifting competition data scraper for Suomen Voimanostoliitto (SVNL - Finnish Powerlifting Federation), built with Bun and TypeScript.

**Key features:**
- CLI for automation and SwiftUI app integration
- TUI for interactive terminal use
- Scrapes competition results (lifters, attempts, totals)
- Exports to CSV and JSON

## Commands

```bash
# Run CLI
bun run cli discover           # Discover competitions from SVNL archive
bun run cli list               # List cached competitions
bun run cli scrape <ids...>    # Scrape specific competitions
bun run cli scrape-all         # Scrape all cached competitions

# Run TUI
bun run tui

# Run tests
bun test
```

## Architecture

Simple 6-file structure:

```
src/
  cli.ts        # CLI entry point using Commander
  tui.tsx       # TUI entry point using Ink (React)
  scraper.ts    # Discovery (Puppeteer) + scraping (fetch)
  parser.ts     # SVNL HTML table parser
  output.ts     # CSV/JSON export
  types.ts      # TypeScript interfaces
```

### Key Design Decisions

1. **Discovery uses Puppeteer** - SVNL archive has "Load more" buttons
2. **Scraping uses fetch** - Competition pages are static HTML (no JS needed)
3. **Single source** - Only SVNL, no abstraction layers
4. **Minimal dependencies** - No caching system, no config files

### Data Flow

```
SVNL Archive → Puppeteer → Competition URLs → fetch → HTML → parser → Lifter Data → CSV/JSON
```

## Parser Strategy

The parser handles SVNL table format variations:

1. Find header row containing "Nimi", "Seura", etc.
2. Map columns dynamically based on header text
3. Detect attempt columns ("1.", "2.", "3." sequences)
4. Parse lifter rows, skip division headers
5. Throw clear error if table format unrecognized

## SwiftUI Integration

CLI supports `--json` flag for machine-readable output:

```json
{"type": "progress", "message": "Loading..."}
{"type": "complete", "data": {...}}
{"type": "error", "message": "..."}
```

## Legacy Code

The `_legacy/` folder contains the old Deno-based implementation for reference.

## Environment Variables

- `SVNL_BROWSER_PATH` - Path to Chrome/Chromium for discovery
