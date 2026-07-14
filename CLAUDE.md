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
bun run cli debug-dump <id|url>         # Save page HTML as fixture candidate + print parse report

# Run TUI
bun run tui

# Build standalone CLI binary
bun run build:cli

# Run tests (golden fixtures in tests/golden/, real SVNL pages in samples/)
bun test
UPDATE_GOLDEN=1 bun test                # Regenerate goldens after an intended parser change
```

## Architecture

```
src/
  cli/
    main.ts     # CLI entry point using Commander
    types.ts    # TypeScript interfaces
    scraper.ts  # Discovery (Puppeteer) + scraping (fetch)
    parser.ts   # SVNL HTML table parser
    validate.ts # Data validation with warnings
    cache.ts    # HTML caching with hash comparison
    output.ts   # CSV/JSON export
    log.ts      # JSON lines logging utility
  tui/
    main.tsx    # TUI entry point using Ink (React)
    types.ts    # TUI-specific types (Screen, OutputMode, OutputFormat)
    components/ # TUI view components
      MainMenu.tsx
      SettingsView.tsx
      DiscoverView.tsx
      ListView.tsx
      ScrapeSelectView.tsx
      ScrapingView.tsx
      ScrapeCompleteView.tsx
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

1. Find header row via `isResultsTable` (shared with cache.ts): "Nimi" + "Seura"/"Sarja", or a row naming 2+ lifts
2. Map columns dynamically from header text, expanding colspan so header indices line up with data columns
3. Detect attempt columns ("1.", "2.", "3." sequences); sub-header indices are only trusted when the sub-header is column-aligned (newer SVNL pages have short unaligned sub-headers)
4. Parse lifter rows, skip division headers; DSQ rows (non-numeric position) are kept with position 0
5. Never guess silently: every parse produces a `ParseReport` (tables matched/skipped, column map used, fallbacks, dropped rows, cross-checks). Low confidence surfaces as an error and saves the raw page to `~/.svnl-scraper/debug/` — the scrape still emits data, loudly flagged

**Mis-parse detection** (`assessTable`): recomputed best-sum vs total agreement rate (column shift destroys it), name/club letter sanity, position monotonicity. `failed` < 50% agreement or < 80% sane names; `suspect` < 90% agreement or any fallback used.

**When a page breaks the parser**: `bun run cli debug-dump <id>` saves the HTML to `samples/`, fix the parser, then `UPDATE_GOLDEN=1 bun test` to pin the fixed behavior. `samples/` and `tests/golden/` are deliberately gitignored (real SVNL pages, kept locally); fixture tests skip gracefully where they are absent. Mutation drills in `tests/mutations.test.ts` enforce the invariant: correct parse or loud failure, never silent wrong data.

## Validation Strategy

Validation runs automatically after parsing and checks:

1. **Total calculation** - Verifies total = best squat + best bench + best deadlift (handles bench-only meets)
2. **Data completeness** - Ensures name and club fields are present
3. **Reasonable ranges** - Checks weights 20-500kg, body weight 30-200kg
4. **Attempt progression** - Validates successful attempts don't decrease

Additionally, structural rules flag likely mis-parses (severity "error"): `parse_confidence`
(from the ParseReport) and `zero_lifters`.

Validation never fails the scrape (exit 0, data still written), but parse errors are always
printed even without `--validate`. Details show with `--validate` or in the TUI completion screen.

## SwiftUI App

The `SVNLScraper/` folder contains a native macOS SwiftUI app that provides a GUI for the scraper. It communicates with the CLI via `--json` output:

```json
{"type": "progress", "message": "Loading..."}
{"type": "complete", "data": {...}}
{"type": "error", "message": "..."}
```

## Environment Variables

- `SVNL_BROWSER_PATH` - Path to Chrome/Chromium for discovery
