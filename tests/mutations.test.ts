import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { extractCompetitionTables } from "../src/cli/cache";
import { parseCompetitionPage } from "../src/cli/parser";
import { listSamples, loadSample, makeCompetition } from "./helpers";

// Invariant under source-HTML mutations: correct parse OR loud failure,
// never silent wrong data

const HETARMO = listSamples().find((f) => f.includes("HeTarmo"));
const MASTERS = listSamples().find((f) => f.includes("Masters"));

const STRIKE_SPAN =
  /<span style="text-decoration: line-through;">([\s\S]*?)<\/span>/g;

function parseSample(html: string) {
  return parseCompetitionPage(html, makeCompetition({}));
}

function mutateDocument(
  html: string,
  mutate: (document: Document) => void,
): string {
  const { document } = parseHTML(html);
  mutate(document as unknown as Document);
  return document.toString();
}

function resultsTableRows(document: Document): Element[] {
  for (const table of Array.from(document.querySelectorAll("table"))) {
    const rows = Array.from(table.querySelectorAll("tr")) as Element[];
    if (
      rows.some(
        (row) =>
          /nimi/i.test(row.textContent || "") &&
          /seura/i.test(row.textContent || ""),
      )
    ) {
      return rows;
    }
  }
  throw new Error("results table not found");
}

describe.skipIf(!HETARMO || !MASTERS)("mutation drills", () => {
  test("inserted column before Nimi: correct parse or loud failure", () => {
    const html = loadSample(HETARMO!);
    const baseline = parseSample(html);

    const mutated = mutateDocument(html, (document) => {
      for (const row of resultsTableRows(document)) {
        const cells = Array.from(row.querySelectorAll("td, th"));
        if (cells.length >= 6) {
          const filler = document.createElement(
            cells[4].tagName.toLowerCase(),
          );
          filler.textContent =
            cells[4].tagName.toLowerCase() === "th" ? "Lisenssi" : "x";
          row.insertBefore(filler, cells[4]);
        }
      }
    });

    const { results, report } = parseSample(mutated);
    if (report.confidence === "ok") {
      expect(results[0].lifters.map((l) => l.name)).toEqual(
        baseline.results[0].lifters.map((l) => l.name),
      );
      expect(results[0].lifters.map((l) => l.total)).toEqual(
        baseline.results[0].lifters.map((l) => l.total),
      );
    } else {
      expect(
        report.issues.some((issue) => issue.severity !== "info"),
      ).toBe(true);
    }
  });

  const strikethroughVariants: Array<[string, string]> = [
    ["semantic <s> tags", "<s>$1</s>"],
    ["class-based styling", '<span class="strikethrough">$1</span>'],
  ];

  for (const [label, replacement] of strikethroughVariants) {
    test(`strikethrough as ${label} keeps identical failure flags`, () => {
      const html = loadSample(HETARMO!);
      expect(html.match(STRIKE_SPAN)?.length).toBeGreaterThan(0);
      const baseline = parseSample(html);

      const mutated = html.replace(STRIKE_SPAN, replacement);
      const { results, report } = parseSample(mutated);

      expect(report.confidence).toBe("ok");
      expect(JSON.parse(JSON.stringify(results))).toEqual(
        JSON.parse(JSON.stringify(baseline.results)),
      );
    });
  }

  test("deleted 1./2./3. sub-header: never silently shifted attempts", () => {
    const html = loadSample(HETARMO!);
    const baseline = parseSample(html);

    const mutated = mutateDocument(html, (document) => {
      const rows = resultsTableRows(document);
      const headerIndex = rows.findIndex(
        (row) =>
          /nimi/i.test(row.textContent || "") &&
          /seura/i.test(row.textContent || ""),
      );
      rows[headerIndex + 1].remove();
    });

    const { results, report } = parseSample(mutated);
    const identical =
      JSON.stringify(results) === JSON.stringify(baseline.results);
    expect(identical || report.confidence !== "ok").toBe(true);
  });

  test("removed points column: totals intact and points zero, or loud", () => {
    const html = loadSample(HETARMO!);
    const baseline = parseSample(html);

    const mutated = mutateDocument(html, (document) => {
      for (const row of resultsTableRows(document)) {
        const cells = Array.from(row.querySelectorAll("td, th"));
        if (cells.length < 14) continue;
        cells[cells.length - 1].remove();
      }
    });

    const { results, report } = parseSample(mutated);
    if (report.confidence === "ok") {
      expect(results[0].lifters.map((l) => l.total)).toEqual(
        baseline.results[0].lifters.map((l) => l.total),
      );
      expect(results[0].lifters.every((l) => l.points === 0)).toBe(true);
    } else {
      expect(
        report.issues.some((issue) => issue.severity !== "info"),
      ).toBe(true);
    }
  });

  test("Yhteistulos renamed to Tulos still resolves the total column", () => {
    const html = loadSample(MASTERS!);
    expect(/yhteistulos/i.test(html)).toBe(true);
    const baseline = parseSample(html);

    const mutated = html.replace(/yhteistulos/gi, "Tulos");
    const { results, report } = parseSample(mutated);

    expect(report.confidence).toBe("ok");
    expect(results[0].lifters.map((l) => l.total)).toEqual(
      baseline.results[0].lifters.map((l) => l.total),
    );
  });

  test("renamed Nimi/Seura headers: still parses via lift-header gate, flagged suspect", () => {
    const html = loadSample(HETARMO!);
    const baseline = parseSample(html);

    const mutated = html
      .replace(/Nimi/g, "Urheilija")
      .replace(/Seura/g, "Joukkue");
    const { results, report } = parseSample(mutated);

    expect(report.liftersParsed).toBe(baseline.report.liftersParsed);
    expect(report.confidence).toBe("suspect");
    expect(
      report.tables[0].fallbacksUsed.some((note) =>
        note.startsWith("legacy_positional_map"),
      ),
    ).toBe(true);
  });

  test("column shift without header change: flagged failed, never ok", () => {
    const html = loadSample(HETARMO!);

    const mutated = html.replace(
      /<tr><td>(\d+\.)<\/td>/g,
      "<tr><td>$1</td><td>x</td>",
    );
    const { report } = parseSample(mutated);

    expect(report.confidence).toBe("failed");
    expect(
      report.issues.some((issue) => issue.code === "column_misalignment"),
    ).toBe(true);
  });

  test("all total/points headers renamed: flagged, never silent zero totals", () => {
    const html = loadSample(HETARMO!);
    const baseline = parseSample(html);

    const mutated = html.replace(/Yhteistulos|Tulos|pisteet|IPF GL/gi, "Score");
    const { results, report } = parseSample(mutated);

    if (report.confidence === "ok") {
      expect(results[0].lifters.map((l) => l.total)).toEqual(
        baseline.results[0].lifters.map((l) => l.total),
      );
    } else {
      expect(report.confidence).not.toBe("ok");
    }
    const zeroTotalsLookHealthy =
      report.confidence === "ok" &&
      results[0].lifters.every((l) => l.total === 0);
    expect(zeroTotalsLookHealthy).toBe(false);
  });

  test("changed-format sibling table survives extraction and is flagged", () => {
    const html = loadSample(HETARMO!);
    const alienRow =
      "<tr><td>John Doe</td><td>Team A</td><td>1</td><td>2</td><td>3</td><td>4</td></tr>";
    const alienTable =
      "<table><tr><th>Athlete</th><th>Team</th><th>A</th><th>B</th><th>C</th><th>D</th></tr>" +
      alienRow.repeat(3) +
      "</table>";
    const withAlien = html.replace("<table", `${alienTable}<table`);

    const extracted = extractCompetitionTables(withAlien);
    const { report } = parseSample(extracted);

    expect(report.tablesSeen).toBe(2);
    expect(report.tablesMatched).toBe(1);
    expect(
      report.issues.some((issue) => issue.code === "table_unmatched"),
    ).toBe(true);
    expect(report.confidence).toBe("suspect");
  });

  test("descending positions are flagged suspect", () => {
    const html = loadSample(HETARMO!);

    let next = 9;
    const mutated = mutateDocument(html, (document) => {
      for (const row of resultsTableRows(document)) {
        const cells = Array.from(row.querySelectorAll("td"));
        if (cells.length < 15 && !(cells[0]?.textContent || "").match(/^\d/)) {
          continue;
        }
        if ((cells[0]?.textContent || "").match(/^\d+\./)) {
          cells[0].textContent = `${next--}.`;
        }
      }
    });

    const { report } = parseSample(mutated);
    const table = report.tables.find((t) => t.matched);
    expect(table?.checks.positionMonotonic).toBe(false);
    expect(report.confidence).toBe("suspect");
  });
});
