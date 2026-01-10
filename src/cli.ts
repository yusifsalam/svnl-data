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
import type { Competition, JsonEvent } from "./types";

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

program
  .command("discover")
  .description("Discover competitions from SVNL archive")
  .option("-c, --clicks <number>", "Number of 'Load more' clicks", "0")
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
      const results = await scrapeCompetitions(competitions, {
        onProgress: (msg) => {
          if (isJson) {
            jsonEvent({ type: "progress", message: msg });
          } else {
            console.log(chalk.gray(msg));
          }
        },
        force: opts.force,
      });

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

      if (opts.validate && !isJson) {
        let totalValidatedLifters = 0;
        let totalLiftersWithWarnings = 0;
        let totalWarnings = 0;

        for (const result of results) {
          const validation = result.metadata?.validation;
          if (validation) {
            totalValidatedLifters += validation.totalLifters;
            totalLiftersWithWarnings += validation.liftersWithWarnings;
            totalWarnings += validation.allWarnings.length;
          }
        }

        if (totalLiftersWithWarnings === 0) {
          console.log(
            chalk.green(
              `\n✓ Validation: ${totalValidatedLifters} lifters passed all checks`,
            ),
          );
        } else {
          console.log(
            chalk.yellow(
              `\n⚠ Validation: ${totalLiftersWithWarnings}/${totalValidatedLifters} lifters have warnings (${totalWarnings} total)`,
            ),
          );

          for (const result of results) {
            const validation = result.metadata?.validation;
            if (validation && validation.allWarnings.length > 0) {
              console.log(chalk.yellow(`\n  ${result.competition.name}:`));
              for (const warning of validation.allWarnings.slice(0, 10)) {
                console.log(chalk.gray(`    ${warning.message}`));
              }
              if (validation.allWarnings.length > 10) {
                console.log(
                  chalk.gray(
                    `    ... and ${validation.allWarnings.length - 10} more`,
                  ),
                );
              }
            }
          }
        }
      }

      if (isJson) {
        jsonEvent({
          type: "complete",
          data: {
            outputPath,
            outputPaths: outputPaths || undefined,
            competitions: results.length,
            lifters: totalLifters,
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
      const results = await scrapeCompetitions(competitions, {
        onProgress: (msg) => {
          if (isJson) {
            jsonEvent({ type: "progress", message: msg });
          } else {
            console.log(chalk.gray(msg));
          }
        },
        force: opts.force,
      });

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

      if (opts.validate && !isJson) {
        let totalValidatedLifters = 0;
        let totalLiftersWithWarnings = 0;
        let totalWarnings = 0;

        for (const result of results) {
          const validation = result.metadata?.validation;
          if (validation) {
            totalValidatedLifters += validation.totalLifters;
            totalLiftersWithWarnings += validation.liftersWithWarnings;
            totalWarnings += validation.allWarnings.length;
          }
        }

        if (totalLiftersWithWarnings === 0) {
          console.log(
            chalk.green(
              `\n✓ Validation: ${totalValidatedLifters} lifters passed all checks`,
            ),
          );
        } else {
          console.log(
            chalk.yellow(
              `\n⚠ Validation: ${totalLiftersWithWarnings}/${totalValidatedLifters} lifters have warnings (${totalWarnings} total)`,
            ),
          );

          for (const result of results) {
            const validation = result.metadata?.validation;
            if (validation && validation.allWarnings.length > 0) {
              console.log(chalk.yellow(`\n  ${result.competition.name}:`));
              for (const warning of validation.allWarnings.slice(0, 10)) {
                console.log(chalk.gray(`    ${warning.message}`));
              }
              if (validation.allWarnings.length > 10) {
                console.log(
                  chalk.gray(
                    `    ... and ${validation.allWarnings.length - 10} more`,
                  ),
                );
              }
            }
          }
        }
      }

      if (isJson) {
        jsonEvent({
          type: "complete",
          data: {
            outputPath,
            outputPaths: outputPaths || undefined,
            competitions: results.length,
            lifters: totalLifters,
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

program.parse();
