#!/usr/bin/env bun

import chalk from "chalk";
import { Command } from "commander";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join, resolve } from "path";
import { appendLog } from "./log";
import { writeResults, writeResultsPerCompetition } from "./output";
import { discoverCompetitions, scrapeCompetitions } from "./scraper";
import { parseCompetitionPage } from "./parser";
import { readDebugArtifact } from "./cache";
import type { Competition, CompetitionResult, JsonEvent } from "./types";

const DATA_DIR = join(homedir(), ".svnl-scraper");
const CACHE_FILE = join(DATA_DIR, "competitions.json");

const program = new Command()
  .name("svnl")
  .version("1.0.0")
  .description("SVNL powerlifting competition scraper");

// Helper to emit JSON events for SwiftUI integration
function jsonEvent(event: JsonEvent) {
  console.log(JSON.stringify(event));
}

// Parse problems are printed even without --validate; silently wrong
// data is the failure mode this scraper must never hide
function printParseHealth(results: CompetitionResult[]) {
  const seen = new Set<string>();
  for (const result of results) {
    const report = result.metadata?.parseReport;
    const id = result.metadata?.competitionId || result.competition.id;
    if (!report || report.confidence === "ok" || seen.has(id)) continue;
    seen.add(id);

    const color = report.confidence === "failed" ? chalk.red : chalk.yellow;
    const symbol = report.confidence === "failed" ? "✗" : "⚠";
    console.log(
      color(
        `${symbol} ${id}: parse confidence ${report.confidence} — raw HTML in ~/.svnl-scraper/debug/`,
      ),
    );
    for (const issue of report.issues.slice(0, 5)) {
      if (issue.severity === "info") continue;
      console.log(color(`    ${issue.message}`));
    }
  }
}

function printValidationDetails(results: CompetitionResult[]) {
  let totalValidatedLifters = 0;
  let totalLiftersWithWarnings = 0;
  let totalWarnings = 0;
  let totalErrors = 0;

  for (const result of results) {
    const validation = result.metadata?.validation;
    if (validation) {
      totalValidatedLifters += validation.totalLifters;
      totalLiftersWithWarnings += validation.liftersWithWarnings;
      totalWarnings += validation.allWarnings.length;
      totalErrors += validation.allWarnings.filter(
        (w) => w.severity === "error",
      ).length;
    }
  }

  if (totalWarnings === 0) {
    console.log(
      chalk.green(
        `\n✓ Validation: ${totalValidatedLifters} lifters passed all checks`,
      ),
    );
    return;
  }

  const summary = `\n⚠ Validation: ${totalLiftersWithWarnings}/${totalValidatedLifters} lifters have warnings (${totalWarnings} total${totalErrors > 0 ? `, ${totalErrors} errors` : ""})`;
  console.log(totalErrors > 0 ? chalk.red(summary) : chalk.yellow(summary));

  for (const result of results) {
    const validation = result.metadata?.validation;
    if (validation && validation.allWarnings.length > 0) {
      console.log(chalk.yellow(`\n  ${result.competition.name}:`));
      const sorted = [...validation.allWarnings].sort(
        (a, b) =>
          (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1),
      );
      for (const warning of sorted.slice(0, 10)) {
        const line = `    ${warning.message}`;
        console.log(
          warning.severity === "error" ? chalk.red(line) : chalk.gray(line),
        );
      }
      if (sorted.length > 10) {
        console.log(chalk.gray(`    ... and ${sorted.length - 10} more`));
      }
    }
  }
}

program
  .command("discover")
  .description("Discover competitions from SVNL archive")
  .option("-c, --clicks <number>", "Number of 'Load more' clicks per section", "0")
  .option("-b, --browser <path>", "Path to Chrome/Chromium")
  .option("--log-dir <dir>", "Log directory", "./logs")
  .option("--json", "Output JSON events (for SwiftUI)")
  .action(async (opts) => {
    const isJson = opts.json;
    const startedAt = Date.now();
    const logDir = resolve(opts.logDir);
    const logPath = join(logDir, "svnl-log.jsonl");

    try {
      const competitions = await discoverCompetitions({
        loadMoreClicks: parseInt(opts.clicks),
        browserPath: opts.browser,
        onProgress: (msg) => {
          if (isJson) {
            jsonEvent({ type: "progress", message: msg });
          } else {
            console.log(chalk.gray(msg));
          }
        },
      });

      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(CACHE_FILE, JSON.stringify(competitions, null, 2));
      await appendLog(
        {
          timestamp: new Date().toISOString(),
          operation: "discover",
          durationMs: Date.now() - startedAt,
          details: { competitions: competitions.length },
        },
        logDir,
      );

      if (isJson) {
        jsonEvent({ type: "complete", data: competitions });
      } else {
        console.log(
          chalk.green(`\n✓ Found ${competitions.length} competitions`),
        );
        console.log(chalk.gray(`  Saved to ${CACHE_FILE}`));
        console.log(chalk.gray(`  Log: ${logPath}`));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isJson) {
        jsonEvent({ type: "error", message: msg });
      } else {
        console.error(chalk.red(`Error: ${msg}`));
      }
      process.exit(1);
    }
  });

program
  .command("list")
  .description("List cached competitions")
  .option("-f, --format <type>", "Output format (table|json)", "table")
  .action(async (opts) => {
    if (!existsSync(CACHE_FILE)) {
      console.error(
        chalk.yellow("No cached competitions. Run 'svnl discover' first."),
      );
      process.exit(1);
    }

    const competitions: Competition[] = JSON.parse(
      await readFile(CACHE_FILE, "utf-8"),
    );

    if (opts.format === "json") {
      console.log(JSON.stringify(competitions, null, 2));
    } else {
      console.log(chalk.bold(`\n${competitions.length} competitions:\n`));
      for (const comp of competitions.slice(0, 30)) {
        const category =
          comp.category === "nationals"
            ? chalk.yellow("[SM]")
            : chalk.gray("[  ]");
        console.log(`  ${category} ${comp.id.padEnd(40)} ${comp.date || ""}`);
        console.log(`       ${chalk.cyan(comp.name || "(no name)")}`);
      }
      if (competitions.length > 30) {
        console.log(chalk.gray(`\n  ... and ${competitions.length - 30} more`));
      }
    }
  });

program
  .command("scrape <ids...>")
  .description("Scrape specific competitions by ID")
  .option("-o, --output <dir>", "Output directory", "./output")
  .option("-f, --format <type>", "Output format (csv|json)", "csv")
  .option("--force", "Force re-scrape (bypass cache)")
  .option("--log-dir <dir>", "Log directory", "./logs")
  .option("--combined", "Write all competitions into one file")
  .option("--validate", "Show detailed validation warnings")
  .option("--json", "Output JSON events (for SwiftUI)")
  .action(async (ids: string[], opts) => {
    const isJson = opts.json;
    const startedAt = Date.now();

    if (!existsSync(CACHE_FILE)) {
      const msg = "No cached competitions. Run 'svnl discover' first.";
      if (isJson) {
        jsonEvent({ type: "error", message: msg });
      } else {
        console.error(chalk.yellow(msg));
      }
      process.exit(1);
    }

    const allCompetitions: Competition[] = JSON.parse(
      await readFile(CACHE_FILE, "utf-8"),
    );

    const competitions = allCompetitions.filter((c) => ids.includes(c.id));

    if (competitions.length === 0) {
      const msg = `No competitions found matching: ${ids.join(", ")}`;
      if (isJson) {
        jsonEvent({ type: "error", message: msg });
      } else {
        console.error(chalk.red(msg));
      }
      process.exit(1);
    }

    try {
      const { results, parseErrorCount } = await scrapeCompetitions(
        competitions,
        {
          onProgress: (msg) => {
            if (isJson) {
              jsonEvent({ type: "progress", message: msg });
            } else {
              console.log(chalk.gray(msg));
            }
          },
          force: opts.force,
        },
      );

      const timestamp = Date.now();
      const outputDir = resolve(opts.output);
      const logDir = resolve(opts.logDir);
      const logPath = join(logDir, "svnl-log.jsonl");
      let outputPath = join(outputDir, `results_${timestamp}.${opts.format}`);
      let outputPaths: string[] | null = null;
      if (opts.combined) {
        await writeResults(results, outputPath, opts.format);
      } else {
        outputPaths = await writeResultsPerCompetition(
          results,
          outputDir,
          opts.format,
        );
        outputPath = outputPaths[0] || outputPath;
      }

      const totalLifters = results.reduce(
        (sum, r) => sum + r.lifters.length,
        0,
      );
      await appendLog(
        {
          timestamp: new Date().toISOString(),
          operation: "scrape",
          durationMs: Date.now() - startedAt,
          details: {
            competitions: results.length,
            lifters: totalLifters,
            competitionIds: results.map((result) => result.competition.id),
            combined: Boolean(opts.combined),
            format: opts.format,
            outputDir,
            forced: Boolean(opts.force),
            skipped: results.filter((r) => r.metadata?.skipped).length,
            scraped: results.filter((r) => !r.metadata?.skipped).length,
          },
        },
        logDir,
      );

      if (!isJson) {
        printParseHealth(results);
      }
      if (opts.validate && !isJson) {
        printValidationDetails(results);
      }

      if (isJson) {
        jsonEvent({
          type: "complete",
          data: {
            outputPath,
            outputPaths: outputPaths || undefined,
            competitions: results.length,
            lifters: totalLifters,
            parseErrors: parseErrorCount,
          },
        });
      } else {
        console.log(
          chalk.green(
            `\n✓ Scraped ${results.length} competitions (${totalLifters} lifters)`,
          ),
        );
        if (outputPaths) {
          console.log(
            chalk.gray(`  Output: ${outputDir} (${outputPaths.length} files)`),
          );
        } else {
          console.log(chalk.gray(`  Output: ${outputPath}`));
        }
        console.log(chalk.gray(`  Log: ${logPath}`));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isJson) {
        jsonEvent({ type: "error", message: msg });
      } else {
        console.error(chalk.red(`Error: ${msg}`));
      }
      process.exit(1);
    }
  });

program
  .command("scrape-all")
  .description("Scrape all cached competitions")
  .option("-o, --output <dir>", "Output directory", "./output")
  .option("-f, --format <type>", "Output format (csv|json)", "csv")
  .option("--force", "Force re-scrape (bypass cache)")
  .option("--log-dir <dir>", "Log directory", "./logs")
  .option("--combined", "Write all competitions into one file")
  .option("--validate", "Show detailed validation warnings")
  .option("--json", "Output JSON events (for SwiftUI)")
  .action(async (opts) => {
    const isJson = opts.json;
    const startedAt = Date.now();

    if (!existsSync(CACHE_FILE)) {
      const msg = "No cached competitions. Run 'svnl discover' first.";
      if (isJson) {
        jsonEvent({ type: "error", message: msg });
      } else {
        console.error(chalk.yellow(msg));
      }
      process.exit(1);
    }

    const competitions: Competition[] = JSON.parse(
      await readFile(CACHE_FILE, "utf-8"),
    );

    if (!isJson) {
      console.log(
        chalk.bold(`Scraping ${competitions.length} competitions...\n`),
      );
    }

    try {
      const { results, parseErrorCount } = await scrapeCompetitions(
        competitions,
        {
          onProgress: (msg) => {
            if (isJson) {
              jsonEvent({ type: "progress", message: msg });
            } else {
              console.log(chalk.gray(msg));
            }
          },
          force: opts.force,
        },
      );

      const timestamp = Date.now();
      const outputDir = resolve(opts.output);
      const logDir = resolve(opts.logDir);
      const logPath = join(logDir, "svnl-log.jsonl");
      let outputPath = join(outputDir, `results_${timestamp}.${opts.format}`);
      let outputPaths: string[] | null = null;
      if (opts.combined) {
        await writeResults(results, outputPath, opts.format);
      } else {
        outputPaths = await writeResultsPerCompetition(
          results,
          outputDir,
          opts.format,
        );
        outputPath = outputPaths[0] || outputPath;
      }

      const totalLifters = results.reduce(
        (sum, r) => sum + r.lifters.length,
        0,
      );
      await appendLog(
        {
          timestamp: new Date().toISOString(),
          operation: "scrape-all",
          durationMs: Date.now() - startedAt,
          details: {
            competitions: results.length,
            lifters: totalLifters,
            competitionIds: results.map((result) => result.competition.id),
            combined: Boolean(opts.combined),
            format: opts.format,
            outputDir,
            forced: Boolean(opts.force),
            skipped: results.filter((r) => r.metadata?.skipped).length,
            scraped: results.filter((r) => !r.metadata?.skipped).length,
          },
        },
        logDir,
      );

      if (!isJson) {
        printParseHealth(results);
      }
      if (opts.validate && !isJson) {
        printValidationDetails(results);
      }

      if (isJson) {
        jsonEvent({
          type: "complete",
          data: {
            outputPath,
            outputPaths: outputPaths || undefined,
            competitions: results.length,
            lifters: totalLifters,
            parseErrors: parseErrorCount,
          },
        });
      } else {
        console.log(
          chalk.green(
            `\n✓ Scraped ${results.length} competitions (${totalLifters} lifters)`,
          ),
        );
        if (outputPaths) {
          console.log(
            chalk.gray(`  Output: ${outputDir} (${outputPaths.length} files)`),
          );
        } else {
          console.log(chalk.gray(`  Output: ${outputPath}`));
        }
        console.log(chalk.gray(`  Log: ${logPath}`));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isJson) {
        jsonEvent({ type: "error", message: msg });
      } else {
        console.error(chalk.red(`Error: ${msg}`));
      }
      process.exit(1);
    }
  });

program
  .command("debug-dump <id>")
  .description(
    "Save a competition page's full HTML as a fixture candidate and print its parse report",
  )
  .option("-o, --out <dir>", "Output directory", "./samples")
  .action(async (id: string, opts) => {
    try {
      let html: string | null = null;
      let sourceLabel: string;
      let competition: Competition = {
        id,
        url: id,
        name: id,
        date: "",
        category: "local",
      };

      if (id.startsWith("http")) {
        sourceLabel = id;
      } else {
        html = await readDebugArtifact(id);
        sourceLabel = html ? "~/.svnl-scraper/debug/" : "live page";
        if (existsSync(CACHE_FILE)) {
          const competitions: Competition[] = JSON.parse(
            await readFile(CACHE_FILE, "utf-8"),
          );
          const cached = competitions.find((c) => c.id === id);
          if (cached) competition = cached;
        }
        if (!html && competition.url === id) {
          console.error(
            chalk.red(
              `No debug artifact and no cached competition for '${id}'. Run 'svnl discover' or pass a URL.`,
            ),
          );
          process.exit(1);
        }
      }

      if (!html) {
        console.log(chalk.gray(`Fetching ${competition.url}...`));
        const response = await fetch(competition.url);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch: ${response.status} ${response.statusText}`,
          );
        }
        html = await response.text();
      } else {
        console.log(chalk.gray(`Using saved HTML from ${sourceLabel}`));
      }

      const outDir = resolve(opts.out);
      await mkdir(outDir, { recursive: true });
      const safeName = (competition.id || "page").replace(/[^\w.-]+/g, "_");
      const outPath = join(outDir, `${safeName}.html`);
      await writeFile(outPath, html, "utf-8");

      const { report } = parseCompetitionPage(html, competition);
      console.log(JSON.stringify(report, null, 2));

      const color =
        report.confidence === "ok"
          ? chalk.green
          : report.confidence === "suspect"
            ? chalk.yellow
            : chalk.red;
      console.log(
        color(
          `\n${report.confidence === "ok" ? "✓" : "⚠"} confidence=${report.confidence}, ${report.liftersParsed} lifters from ${report.tablesMatched}/${report.tablesSeen} tables`,
        ),
      );
      console.log(chalk.gray(`  HTML saved to ${outPath}`));
      console.log(
        chalk.gray(
          `  To pin as a regression fixture: keep it in samples/ and run UPDATE_GOLDEN=1 bun test`,
        ),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${msg}`));
      process.exit(1);
    }
  });

program.parse();
