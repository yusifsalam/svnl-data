import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { parseHTML } from "linkedom";
import { isResultsTable, isTableShaped } from "./parser";
import type { ParseReport } from "./types";

const HTML_CACHE_DIR = join(homedir(), ".svnl-scraper", "html");
// Separate from html/ so bad pages never poison the hash-skip cache
const DEBUG_DIR = join(homedir(), ".svnl-scraper", "debug");

export function extractCompetitionTables(html: string): string {
  const { document } = parseHTML(html);
  const tables = document.querySelectorAll("table");
  const relevantTables: string[] = [];

  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll("tr"));
    // Keep unrecognized table-shaped tables too: dropping them here
    // would hide a changed-format results table from the parser's
    // table_unmatched alarm
    if (isResultsTable(rows).match || isTableShaped(rows)) {
      relevantTables.push(table.outerHTML);
    }
  }

  if (relevantTables.length === 0) {
    throw new Error("No competition tables found in HTML");
  }

  const titleEl = document.querySelector("h1.entry-title, h1, title");
  let titleHtml = "";
  if (titleEl) {
    if (titleEl.tagName.toLowerCase() === "title") {
      titleHtml = `<h1>${titleEl.textContent}</h1>`;
    } else {
      titleHtml = titleEl.outerHTML;
    }
  }

  return titleHtml + "\n" + relevantTables.join("\n");
}

export async function writeDebugArtifact(
  competitionId: string,
  fullHtml: string,
  report: ParseReport | { issues: Array<Record<string, unknown>> },
): Promise<string> {
  await mkdir(DEBUG_DIR, { recursive: true });
  const htmlPath = join(DEBUG_DIR, `${competitionId}.html`);
  await writeFile(htmlPath, fullHtml, "utf-8");
  await writeFile(
    join(DEBUG_DIR, `${competitionId}.report.json`),
    JSON.stringify(report, null, 2),
    "utf-8",
  );
  return htmlPath;
}

export async function readDebugArtifact(
  competitionId: string,
): Promise<string | null> {
  const htmlPath = join(DEBUG_DIR, `${competitionId}.html`);
  if (!existsSync(htmlPath)) return null;
  try {
    return await readFile(htmlPath, "utf-8");
  } catch {
    return null;
  }
}

export function computeHash(html: string): string {
  return createHash("sha256").update(html, "utf-8").digest("hex");
}

export async function getHtmlHash(
  competitionId: string,
): Promise<string | null> {
  const hashPath = join(HTML_CACHE_DIR, `${competitionId}.html.hash`);

  if (!existsSync(hashPath)) {
    return null;
  }

  try {
    return await readFile(hashPath, "utf-8");
  } catch {
    return null;
  }
}

export async function readHtmlCache(
  competitionId: string,
): Promise<string | null> {
  const htmlPath = join(HTML_CACHE_DIR, `${competitionId}.html`);

  if (!existsSync(htmlPath)) {
    return null;
  }

  try {
    return await readFile(htmlPath, "utf-8");
  } catch {
    return null;
  }
}

export async function writeHtmlCache(
  competitionId: string,
  tableHtml: string,
  hash: string,
): Promise<void> {
  if (!existsSync(HTML_CACHE_DIR)) {
    await mkdir(HTML_CACHE_DIR, { recursive: true });
  }

  const htmlPath = join(HTML_CACHE_DIR, `${competitionId}.html`);
  const hashPath = join(HTML_CACHE_DIR, `${competitionId}.html.hash`);
  const htmlTempPath = `${htmlPath}.tmp`;
  const hashTempPath = `${hashPath}.tmp`;

  try {
    await writeFile(htmlTempPath, tableHtml, "utf-8");
    await writeFile(hashTempPath, hash, "utf-8");

    await rename(htmlTempPath, htmlPath);
    await rename(hashTempPath, hashPath);
  } catch (error) {
    try {
      if (existsSync(htmlTempPath)) {
        await import("fs/promises").then(fs => fs.unlink(htmlTempPath));
      }
      if (existsSync(hashTempPath)) {
        await import("fs/promises").then(fs => fs.unlink(hashTempPath));
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

export async function shouldScrape(
  competitionId: string,
  newTableHtml: string,
): Promise<{ shouldScrape: boolean; reason: string }> {
  const cachedHash = await getHtmlHash(competitionId);

  if (!cachedHash) {
    return { shouldScrape: true, reason: "no cache" };
  }

  const newHash = computeHash(newTableHtml);

  if (newHash !== cachedHash) {
    return { shouldScrape: true, reason: "content changed" };
  }

  return { shouldScrape: false, reason: "unchanged" };
}
