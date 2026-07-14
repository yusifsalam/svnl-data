import { describe, expect, test } from "bun:test";
import { parseCompetitionPage } from "../src/cli/parser";
import { makeCompetition } from "./helpers";

// The invariant "correct parse OR loud failure, never silent wrong data" is
// the whole point of the parser's confidence machinery. tests/mutations.test.ts
// exercises it against real SVNL pages, but those samples are gitignored, so
// that suite disappears in a clean checkout. These synthetic fixtures encode
// the same invariants against hand-built HTML so they run everywhere.

const HEADER = [
  "Sij",
  "M/N",
  "Sarja",
  "Paino",
  "Nimi",
  "Seura",
  "1.",
  "2.",
  "3.",
  "Jalkakyykky",
  "1.",
  "2.",
  "3.",
  "Penkkipunnerrus",
  "1.",
  "2.",
  "3.",
  "Maastanosto",
  "Yhteistulos",
  "IPF GL",
];

interface LifterSpec {
  pos: string;
  gender: string;
  sarja: string;
  bw: string;
  name: string;
  club: string;
  squat: [string, string, string];
  bestS: string;
  bench: [string, string, string];
  bestB: string;
  deadlift: [string, string, string];
  bestD: string;
  total: string;
  points: string;
}

// Best of each lift = heaviest successful attempt; total = sum of the three.
// A negative-number cell (e.g. "-220") is the parser's "failed attempt".
const BASELINE: LifterSpec[] = [
  {
    pos: "1.",
    gender: "M",
    sarja: "83",
    bw: "82.5",
    name: "Matti Meikäläinen / 90",
    club: "Voima Ry",
    squat: ["200", "210", "-220"],
    bestS: "210",
    bench: ["140", "150", "-155"],
    bestB: "150",
    deadlift: ["230", "240", "250"],
    bestD: "250",
    total: "610",
    points: "400.5",
  },
  {
    pos: "2.",
    gender: "M",
    sarja: "83",
    bw: "81.0",
    name: "Antti Virtanen / 88",
    club: "Tampere PL",
    squat: ["190", "200", "205"],
    bestS: "205",
    bench: ["130", "140", "-145"],
    bestB: "140",
    deadlift: ["220", "230", "-235"],
    bestD: "230",
    total: "575",
    points: "380.2",
  },
  {
    pos: "3.",
    gender: "M",
    sarja: "93",
    bw: "90.0",
    name: "Jukka Korhonen / 85",
    club: "Helsinki Voima",
    squat: ["180", "190", "-195"],
    bestS: "190",
    bench: ["120", "130", "135"],
    bestB: "135",
    deadlift: ["210", "220", "-225"],
    bestD: "220",
    total: "545",
    points: "360.0",
  },
];

const BASELINE_NAMES = ["Matti Meikäläinen", "Antti Virtanen", "Jukka Korhonen"];
const BASELINE_TOTALS = [610, 575, 545];

function rowCells(l: LifterSpec): string[] {
  return [
    l.pos,
    l.gender,
    l.sarja,
    l.bw,
    l.name,
    l.club,
    ...l.squat,
    l.bestS,
    ...l.bench,
    l.bestB,
    ...l.deadlift,
    l.bestD,
    l.total,
    l.points,
  ];
}

function buildTable(header: string[], rows: string[][]): string {
  const headerHtml = `<tr>${header.map((h) => `<th>${h}</th>`).join("")}</tr>`;
  const bodyHtml = rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("");
  return `<table>${headerHtml}${bodyHtml}</table>`;
}

function buildPage(table: string): string {
  return `<h1>Testikilpailu, Pori, 30.12.2025</h1>\n${table}`;
}

function parse(html: string) {
  return parseCompetitionPage(html, makeCompetition({}));
}

function baselineRows(): string[][] {
  return BASELINE.map(rowCells);
}

describe("synthetic mutation drills", () => {
  test("baseline SVNL layout parses cleanly", () => {
    const { results, report } = parse(buildPage(buildTable(HEADER, baselineRows())));

    expect(report.confidence).toBe("ok");
    expect(results[0].lifters.map((l) => l.name)).toEqual(BASELINE_NAMES);
    expect(results[0].lifters.map((l) => l.total)).toEqual(BASELINE_TOTALS);
  });

  test("stray leading column shifts every field: flagged failed, never ok", () => {
    const rows = baselineRows().map((cells) => ["x", ...cells]);
    const { report } = parse(buildPage(buildTable(HEADER, rows)));

    expect(report.confidence).toBe("failed");
    expect(
      report.issues.some(
        (issue) =>
          issue.severity === "error" &&
          (issue.code === "column_misalignment" ||
            issue.code === "low_parse_confidence"),
      ),
    ).toBe(true);
  });

  test("renamed Nimi/Seura headers: parses via lift-header gate, flagged suspect", () => {
    const header = HEADER.map((h) =>
      h === "Nimi" ? "Urheilija" : h === "Seura" ? "Joukkue" : h,
    );
    const { results, report } = parse(buildPage(buildTable(header, baselineRows())));

    expect(report.confidence).toBe("suspect");
    expect(results[0].lifters.map((l) => l.name)).toEqual(BASELINE_NAMES);
    expect(results[0].lifters.map((l) => l.total)).toEqual(BASELINE_TOTALS);
    expect(
      report.tables[0].fallbacksUsed.some((note) =>
        note.startsWith("legacy_positional_map"),
      ),
    ).toBe(true);
  });

  test("Yhteistulos renamed to Tulos still resolves the total column", () => {
    const header = HEADER.map((h) => (h === "Yhteistulos" ? "Tulos" : h));
    const { results, report } = parse(buildPage(buildTable(header, baselineRows())));

    expect(report.confidence).toBe("ok");
    expect(results[0].lifters.map((l) => l.total)).toEqual(BASELINE_TOTALS);
  });

  test("all total/points headers renamed: flagged, never silent zero totals", () => {
    const header = HEADER.map((h) =>
      /^(Yhteistulos|Tulos|IPF GL)$/i.test(h) ? "Score" : h,
    );
    const { results, report } = parse(buildPage(buildTable(header, baselineRows())));

    expect(report.confidence).not.toBe("ok");
    const zeroTotalsLookHealthy =
      report.confidence === "ok" &&
      results[0].lifters.every((l) => l.total === 0);
    expect(zeroTotalsLookHealthy).toBe(false);
  });

  test("descending positions are flagged suspect", () => {
    const rows = baselineRows();
    rows[0][0] = "3.";
    rows[1][0] = "2.";
    rows[2][0] = "1.";
    const { report } = parse(buildPage(buildTable(HEADER, rows)));

    const table = report.tables.find((t) => t.matched);
    expect(table?.checks.positionMonotonic).toBe(false);
    expect(report.confidence).toBe("suspect");
  });

  test("strikethrough encoding does not change which attempts count", () => {
    // Failed attempts rendered as struck-through *positive* numbers: if the
    // strike is missed, the heavier struck weight would become the best and
    // inflate the total. All three encodings must agree.
    const strikeSpan = (w: string) =>
      `<span style="text-decoration: line-through;">${w}</span>`;
    const strikeS = (w: string) => `<s>${w}</s>`;
    const strikeClass = (w: string) =>
      `<span class="strikethrough">${w}</span>`;

    const withStrikes = (strike: (w: string) => string): LifterSpec[] => [
      { ...BASELINE[0], squat: ["200", "210", strike("225")], bench: ["140", "150", strike("165")] },
      { ...BASELINE[1], bench: ["130", "140", strike("150")], deadlift: ["220", "230", strike("240")] },
      { ...BASELINE[2], squat: ["180", "190", strike("200")], deadlift: ["210", "220", strike("230")] },
    ];

    const runFor = (strike: (w: string) => string) => {
      const rows = withStrikes(strike).map(rowCells);
      const { results, report } = parse(buildPage(buildTable(HEADER, rows)));
      return { results, report };
    };

    const spanRun = runFor(strikeSpan);
    expect(spanRun.report.confidence).toBe("ok");
    expect(spanRun.results[0].lifters.map((l) => l.total)).toEqual(BASELINE_TOTALS);

    const canonical = JSON.stringify(spanRun.results);
    for (const strike of [strikeS, strikeClass]) {
      const run = runFor(strike);
      expect(run.report.confidence).toBe("ok");
      expect(JSON.stringify(run.results)).toEqual(canonical);
    }
  });
});
