# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

A powerlifting competition data scraper for Suomen Voimanostoliitto (SVNL - Finnish Powerlifting Federation), built with Bun and TypeScript.

**Key features:**
- CLI for automation and SwiftUI app integration
- TUI for interactive terminal use
- Incremental updates with HTML caching (skips unchanged competitions)
- Scrapes competition results (lifters, attempts, totals)
- Exports to CSV and JSON

## Commands

```bash
# Run CLI
bun run cli discover                    # Discover competitions from SVNL archive
bun run cli list                        # List cached competitions
bun run cli scrape <ids...>             # Scrape specific competitions
bun run cli scrape <ids...> --force     # Force re-scrape (bypass cache)
bun run cli scrape-all                  # Scrape all cached competitions
bun run cli scrape-all --force          # Force re-scrape all (bypass cache)

# Run TUI
bun run tui

# Build standalone CLI binary
bun run build:cli

# Run tests
bun test
```

## Architecture

Simple 8-file structure:

```
src/
  cli.ts        # CLI entry point using Commander
  tui.tsx       # TUI entry point using Ink (React)
  scraper.ts    # Discovery (Puppeteer) + scraping (fetch)
  parser.ts     # SVNL HTML table parser
  cache.ts      # HTML caching with hash comparison
  output.ts     # CSV/JSON export
  log.ts        # JSON lines logging utility
  types.ts      # TypeScript interfaces
```

### Key Design Decisions

1. **Discovery uses Puppeteer** - SVNL archive has "Load more" buttons
2. **Scraping uses fetch** - Competition pages are static HTML (no JS needed)
3. **Incremental updates** - Caches table HTML with SHA-256 hash comparison, skips parsing if unchanged
4. **Table-only caching** - Stores only relevant `<table>` elements (~90% storage savings vs full HTML)
5. **Single source** - Only SVNL, no abstraction layers
6. **Minimal dependencies** - Lightweight caching using filesystem, no config files

### Data Flow

```
SVNL Archive → Puppeteer → Competition URLs → fetch → Extract tables → Hash check
                                                            ↓             ↓
                                                      ~/.svnl-scraper/html/
                                                            ↓
                                                    Parse (if changed) or skip
                                                            ↓
                                                      Lifter Data → CSV/JSON
```

## Code Style

### Comments

Avoid unnecessary comments. Code should be self-documenting through clear naming and structure.

**Remove:**
- Header comments that restate the filename ("SVNL Scraper CLI")
- Section markers ("// Identity", "// Progress", "// Header")
- Obvious comments that describe what code does ("// Save to cache", "// Find competitions by ID")

**Keep:**
- WHY explanations ("Discovery uses Puppeteer - SVNL archive has 'Load more' buttons")
- Performance notes ("O(1) indexing instead of O(n) String indexing")
- Non-obvious behavior ("Fallback to app output on failure")
- Important caveats ("Limit size to avoid memory leaks")

## Parser Strategy

The parser handles SVNL table format variations:

1. Find header row containing "Nimi", "Seura", etc.
2. Map columns dynamically based on header text
3. Detect attempt columns ("1.", "2.", "3." sequences)
4. Parse lifter rows, skip division headers
5. Throw clear error if table format unrecognized

## SwiftUI App

The `SVNLScraper/` folder contains a native macOS SwiftUI app that provides a GUI for the scraper. It communicates with the CLI via `--json` output:

```json
{"type": "progress", "message": "Loading..."}
{"type": "complete", "data": {...}}
{"type": "error", "message": "..."}
```

## Environment Variables

- `SVNL_BROWSER_PATH` - Path to Chrome/Chromium for discovery
