import puppeteer from "puppeteer-core";
import { parseCompetitionPage } from "./parser";
import type {
  Competition,
  CompetitionResult,
  ParseReport,
  ProgressCallback,
} from "./types";
import {
  extractCompetitionTables,
  computeHash,
  readHtmlCache,
  writeDebugArtifact,
  writeHtmlCache,
  shouldScrape as shouldScrapeCheck,
} from "./cache";
import { validateCompetitionResult } from "./validate";

const SVNL_ARCHIVE_URL =
  "https://www.suomenvoimanostoliitto.fi/kilpailut/tulosarkisto/";

interface DiscoverOptions {
  loadMoreClicks?: number;
  browserPath?: string;
  onProgress?: ProgressCallback;
}

interface ScrapeOptions {
  onProgress?: ProgressCallback;
  force?: boolean;
  useCache?: boolean;
}

// Distinguishes a parser failure from a fetch/cache failure so callers can
// count them separately (parse problems vs. competitions that never loaded)
export class ScrapeParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ScrapeParseError";
  }
}

/**
 * Discover competitions from SVNL archive page
 * Uses Puppeteer because the page requires clicking "Load more" buttons
 */
export async function discoverCompetitions(
  options: DiscoverOptions = {},
): Promise<Competition[]> {
  const { loadMoreClicks = 0, browserPath, onProgress } = options;

  const executablePath = browserPath || (await findBrowserPath());
  if (!executablePath) {
    throw new Error(
      "Chrome/Chromium not found. Set SVNL_BROWSER_PATH or install Chrome.",
    );
  }

  onProgress?.("Launching browser...");
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
  });

  try {
    const page = await browser.newPage();
    onProgress?.("Loading SVNL archive page...");
    await page.goto(SVNL_ARCHIVE_URL, { waitUntil: "networkidle2" });

    // Click "Load more" button multiple times
    for (let i = 0; i < loadMoreClicks; i++) {
      try {
        const clicked = await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll("button"));
          const loadMoreBtn = buttons.find((btn) =>
            btn.textContent?.includes("Lataa lisää"),
          );
          if (loadMoreBtn && !(loadMoreBtn as HTMLButtonElement).disabled) {
            loadMoreBtn.click();
            return true;
          }
          return false;
        });

        if (!clicked) {
          onProgress?.("No more competitions to load");
          break;
        }

        onProgress?.(`Clicked "Load more" (${i + 1}/${loadMoreClicks})`);
        await new Promise((r) => setTimeout(r, 2000)); // Wait for content
      } catch {
        break;
      }
    }

    // Extract competition links from specific sections
    onProgress?.("Extracting competition links...");

    const competitions = await page.evaluate(() => {
      const results: Array<{
        id: string;
        url: string;
        name: string;
        date: string;
        category: string;
      }> = [];
      const seen = new Set<string>();

      // Helper to extract competitions from a section
      function extractFromSection(sectionName: string, category: string) {
        // Find the H2 with this section name
        const h2s = Array.from(document.querySelectorAll("h2"));
        const sectionH2 = h2s.find(
          (h) => h.textContent?.trim() === sectionName,
        );
        if (!sectionH2) return;

        // Find the container after this H2 (usually a sibling or parent's sibling)
        let container = sectionH2.nextElementSibling;

        // Sometimes the structure is H2 followed by a div/section containing articles
        // Walk through siblings until we hit another H2
        while (container && container.tagName !== "H2") {
          const links = container.querySelectorAll('a[href*="/Tulosarkisto/"]');

          for (const link of links) {
            const href = link.getAttribute("href") || "";
            if (seen.has(href)) continue;
            seen.add(href);

            const name =
              link.getAttribute("aria-label") || link.textContent?.trim() || "";
            const article = link.closest("article");
            const date =
              article?.querySelector("time")?.textContent?.trim() || "";

            const pathParts = href.split("/").filter(Boolean);
            const slug = pathParts[pathParts.length - 1] || "";
            const id = `svnl-${slug}`;

            const baseUrl = "https://www.suomenvoimanostoliitto.fi";
            const url = href.startsWith("http") ? href : `${baseUrl}${href}`;

            results.push({ id, url, name, date, category });
          }

          container = container.nextElementSibling;
        }
      }

      // Extract from the sections we want (in order)
      extractFromSection("Kansalliset kilpailut", "local");
      extractFromSection("SM-kilpailut", "nationals");

      return results;
    });

    onProgress?.(`Found ${competitions.length} competitions`);

    return competitions.map((c) => ({
      id: c.id,
      url: c.url,
      name: c.name,
      date: c.date,
      category: c.category as "nationals" | "local",
    }));
  } finally {
    await browser.close();
  }
}

/**
 * Scrape a single competition
 * Uses simple HTTP fetch since SVNL pages don't require JavaScript
 */
export async function scrapeCompetition(
  competition: Competition,
  options: ScrapeOptions = {},
): Promise<CompetitionResult[]> {
  const { onProgress, force = false, useCache = true } = options;

  onProgress?.(`Fetching ${competition.name || competition.id}...`);

  const response = await fetch(competition.url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch: ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();

  let tableHtml: string;
  let skipped = false;
  let usedCache = false;
  let extractionError: string | null = null;

  try {
    tableHtml = extractCompetitionTables(html);

    if (useCache && !force) {
      const decision = await shouldScrapeCheck(competition.id, tableHtml);

      if (!decision.shouldScrape) {
        const cachedHtml = await readHtmlCache(competition.id);
        if (cachedHtml) {
          onProgress?.("✓ Skipped (unchanged)");
          tableHtml = cachedHtml;
          skipped = true;
          usedCache = true;
        }
      }
    }

    if (!skipped) {
      onProgress?.("Parsing results...");
    }
  } catch (error) {
    extractionError = error instanceof Error ? error.message : String(error);
    onProgress?.(
      `Warning: table extraction failed (${extractionError}), parsing full HTML`,
    );
    tableHtml = html;
  }

  let results: CompetitionResult[];
  let report: ParseReport;
  try {
    ({ results, report } = parseCompetitionPage(tableHtml, competition));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const debugPath = await writeDebugArtifact(competition.id, html, {
      issues: [{ severity: "error", code: "parser_exception", message: msg }],
    });
    onProgress?.(`PARSE ERROR: ${msg} — raw HTML saved to ${debugPath}`);
    throw new ScrapeParseError(msg, { cause: error });
  }

  // Cache only pages that extracted cleanly and parsed with usable confidence,
  // so a failed-confidence or unparseable page can never overwrite the last
  // good cache and hide itself behind the hash-skip on the next run
  if (!skipped && !extractionError && report.confidence !== "failed") {
    const hash = computeHash(tableHtml);
    await writeHtmlCache(competition.id, tableHtml, hash);
  }

  if (extractionError) {
    report.issues.push({
      severity: "warning",
      code: "table_extraction_failed",
      message: extractionError,
    });
  }

  onProgress?.(`Found ${report.liftersParsed} lifters`);

  if (report.confidence !== "ok") {
    const debugPath = await writeDebugArtifact(competition.id, html, report);
    const label = report.confidence === "failed" ? "PARSE ERROR" : "PARSE WARNING";
    const detail = report.issues
      .filter((issue) => issue.severity !== "info")
      .map((issue) => issue.message)
      .slice(0, 3)
      .join("; ");
    onProgress?.(
      `${label}: ${competition.id} confidence=${report.confidence} (${detail}) — raw HTML saved to ${debugPath}`,
    );
  }

  results.forEach((r) => {
    const validation = validateCompetitionResult(r, report);
    r.metadata = {
      competitionId: competition.id,
      skipped,
      cached: usedCache,
      hashMatch: skipped,
      validation,
      parseReport: report,
    };

    if (validation.liftersWithWarnings > 0) {
      onProgress?.(
        `⚠ ${validation.liftersWithWarnings}/${validation.totalLifters} lifters have warnings`,
      );
    }
  });

  return results;
}

/**
 * Scrape multiple competitions with rate limiting
 */
export async function scrapeCompetitions(
  competitions: Competition[],
  options: ScrapeOptions & { delayMs?: number } = {},
): Promise<{
  results: CompetitionResult[];
  failedCount: number;
  parseErrorCount: number;
}> {
  const { onProgress, delayMs = 2000, force = false } = options;
  const results: CompetitionResult[] = [];
  let skippedCount = 0;
  let scrapedCount = 0;
  let failedCount = 0;
  let parseErrorCount = 0;

  for (let i = 0; i < competitions.length; i++) {
    const comp = competitions[i];
    const prefix = `[${i + 1}/${competitions.length}]`;

    onProgress?.(
      force
        ? `${prefix} Re-scraping ${comp.name || comp.id} (forced)`
        : `${prefix} Checking ${comp.name || comp.id}`,
    );

    try {
      const result = await scrapeCompetition(comp, { onProgress, force });
      results.push(...result);

      const metadata = result[0]?.metadata;
      if (metadata?.parseReport?.confidence === "failed") {
        parseErrorCount++;
      }
      if (metadata?.skipped) {
        skippedCount++;
      } else {
        scrapedCount++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      failedCount++;
      // A parser exception is a parse problem, not a load failure; fetch/cache
      // errors count only toward failedCount
      if (error instanceof ScrapeParseError) parseErrorCount++;
      onProgress?.(`Error: ${msg}`);
    }

    // Rate limit between requests
    if (i < competitions.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (skippedCount > 0 || scrapedCount > 0 || failedCount > 0) {
    const parts = [`${scrapedCount} scraped`, `${skippedCount} skipped`];
    if (failedCount > 0) parts.push(`${failedCount} FAILED`);
    if (parseErrorCount > 0) parts.push(`${parseErrorCount} PARSE ERRORS`);
    onProgress?.(`Summary: ${parts.join(", ")}`);
  }

  return { results, failedCount, parseErrorCount };
}

/**
 * Find Chrome/Chromium browser path
 */
async function findBrowserPath(): Promise<string | null> {
  const { existsSync } = await import("fs");
  const { homedir } = await import("os");

  const candidates = [
    process.env.SVNL_BROWSER_PATH,
    `${homedir()}/.svnl-scraper/chrome/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];

  for (const path of candidates) {
    if (path && existsSync(path)) {
      return path;
    }
  }

  return null;
}
