import puppeteer from "puppeteer-core";
import { parseCompetitionPage } from "./parser";
import type { Competition, CompetitionResult, ProgressCallback } from "./types";
import {
  extractCompetitionTables,
  computeHash,
  readHtmlCache,
  writeHtmlCache,
  shouldScrape as shouldScrapeCheck,
} from "./cache";

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
      const hash = computeHash(tableHtml);
      await writeHtmlCache(competition.id, tableHtml, hash);
      onProgress?.("Parsing results...");
    }
  } catch (error) {
    onProgress?.(`Warning: Cache error, parsing full HTML`);
    tableHtml = html;
  }

  const result = parseCompetitionPage(tableHtml, competition);

  const lifterCount = result.reduce(
    (sum, entry) => sum + entry.lifters.length,
    0,
  );
  onProgress?.(`Found ${lifterCount} lifters`);

  result.forEach((r) => {
    r.metadata = {
      competitionId: competition.id,
      skipped,
      cached: usedCache,
      hashMatch: skipped,
    };
  });

  return result;
}

/**
 * Scrape multiple competitions with rate limiting
 */
export async function scrapeCompetitions(
  competitions: Competition[],
  options: ScrapeOptions & { delayMs?: number } = {},
): Promise<CompetitionResult[]> {
  const { onProgress, delayMs = 2000, force = false } = options;
  const results: CompetitionResult[] = [];
  let skippedCount = 0;
  let scrapedCount = 0;

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
      if (metadata?.skipped) {
        skippedCount++;
      } else {
        scrapedCount++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onProgress?.(`Error: ${msg}`);
    }

    // Rate limit between requests
    if (i < competitions.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  if (!force && (skippedCount > 0 || scrapedCount > 0)) {
    onProgress?.(
      `Summary: ${scrapedCount} scraped, ${skippedCount} skipped (unchanged)`,
    );
  }

  return results;
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
