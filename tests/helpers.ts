import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import type { Competition } from "../src/cli/types";

export const SAMPLES_DIR = join(import.meta.dir, "..", "samples");
export const GOLDEN_DIR = join(import.meta.dir, "golden");

// samples/ is gitignored (real SVNL pages, kept locally); tests skip
// gracefully when it is absent
export function listSamples(): string[] {
  if (!existsSync(SAMPLES_DIR)) return [];
  return readdirSync(SAMPLES_DIR)
    .filter((name) => name.endsWith(".html"))
    .sort();
}

export function loadSample(filename: string): string {
  return readFileSync(join(SAMPLES_DIR, filename), "utf-8");
}

export function sampleSlug(filename: string): string {
  return filename
    .replace(/ - Suomen Voimanostoliitto ry\.html$/i, "")
    .replace(/\.html$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function makeCompetition(overrides: Partial<Competition> = {}): Competition {
  return {
    id: "test-competition",
    url: "https://example.test/competition",
    name: "Test Competition",
    date: "",
    category: "local",
    ...overrides,
  };
}

export function cellFromHtml(cellHtml: string): Element {
  const { document } = parseHTML(`<table><tr>${cellHtml}</tr></table>`);
  const cell = document.querySelector("td, th");
  if (!cell) throw new Error(`No cell parsed from: ${cellHtml}`);
  return cell as unknown as Element;
}

export function rowFromHtml(rowHtml: string): Element {
  const { document } = parseHTML(`<table>${rowHtml}</table>`);
  const row = document.querySelector("tr");
  if (!row) throw new Error(`No row parsed from: ${rowHtml}`);
  return row as unknown as Element;
}
