import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { parseHTML } from "linkedom";

const HTML_CACHE_DIR = join(homedir(), ".svnl-scraper", "html");

export function extractCompetitionTables(html: string): string {
  const { document } = parseHTML(html);
  const tables = document.querySelectorAll("table");
  const relevantTables: string[] = [];

  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll("tr"));

    let hasResultsTable = false;
    for (const row of rows) {
      const text = row.textContent?.toLowerCase() || "";
      if (text.includes("nimi") && text.includes("seura")) {
        hasResultsTable = true;
        break;
      }
    }

    if (hasResultsTable) {
      relevantTables.push(table.outerHTML);
    }
  }

  if (relevantTables.length === 0) {
    throw new Error("No competition tables found in HTML");
  }

  return relevantTables.join("\n");
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
