# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

A powerlifting competition data scraper for Suomen Voimanostoliitto (SVNL - Finnish Powerlifting Federation), built with Bun and TypeScript.

**Key features:**
- CLI for automation and SwiftUI app integration
- TUI for interactive terminal use
- Data validation with detailed warnings
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
bun run cli scrape <ids...> --validate  # Show validation warnings
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

Simple 9-file structure:

```
src/
  cli.ts        # CLI entry point using Commander
  tui.tsx       # TUI entry point using Ink (React)
  scraper.ts    # Discovery (Puppeteer) + scraping (fetch)
  parser.ts     # SVNL HTML table parser
  validate.ts   # Data validation with warnings
  cache.ts      # HTML caching with hash comparison
  output.ts     # CSV/JSON export
  log.ts        # JSON lines logging utility
  types.ts      # TypeScript interfaces
```

### Key Design Decisions

1. **Discovery uses Puppeteer** - SVNL archive has "Load more" buttons
2. **Scraping uses fetch** - Competition pages are static HTML (no JS needed)
3. **Automatic validation** - Validates data quality on every scrape (total calculation, completeness, ranges, progression)
4. **Incremental updates** - Caches table HTML with SHA-256 hash comparison, skips parsing if unchanged
5. **Table-only caching** - Stores only relevant `<table>` elements (~90% storage savings vs full HTML)
6. **Single source** - Only SVNL, no abstraction layers
7. **Minimal dependencies** - Lightweight caching using filesystem, no config files

### Data Flow

```
SVNL Archive → Puppeteer → Competition URLs → fetch → Extract tables → Hash check
                                                            ↓             ↓
                                                      ~/.svnl-scraper/html/
                                                            ↓
                                                    Parse (if changed) or skip
                                                            ↓
                                                      Validate → Attach warnings
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

## Validation Strategy

Validation runs automatically after parsing and checks:

1. **Total calculation** - Verifies total = best squat + best bench + best deadlift (handles bench-only meets)
2. **Data completeness** - Ensures name and club fields are present
3. **Reasonable ranges** - Checks weights 20-500kg, body weight 30-200kg
4. **Attempt progression** - Validates successful attempts don't decrease

Validation is warnings-only (never fails the scrape). Results are attached to metadata
and can be displayed with `--validate` flag or in TUI completion screen.

## SwiftUI App

The `SVNLScraper/` folder contains a native macOS SwiftUI app that provides a GUI for the scraper. It communicates with the CLI via `--json` output:

```json
{"type": "progress", "message": "Loading..."}
{"type": "complete", "data": {...}}
{"type": "error", "message": "..."}
```

## Environment Variables

- `SVNL_BROWSER_PATH` - Path to Chrome/Chromium for discovery
