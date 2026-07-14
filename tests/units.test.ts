import { describe, expect, test } from "bun:test";
import {
  detectColumnMap,
  extractAgeClassFromText,
  isResultsTable,
  parseAttempt,
  parseBirthYear,
  parseDateRange,
} from "../src/cli/parser";
import { cellFromHtml, rowFromHtml } from "./helpers";

describe("detectColumnMap", () => {
  test("maps standard SVNL header row", () => {
    const row = rowFromHtml(
      `<tr>
        <th>Sij</th><th>M/N</th><th>Sarja</th><th>Paino</th><th>Nimi</th><th>Seura</th>
        <th>1.</th><th>2.</th><th>3.</th><th>Jalkakyykky</th>
        <th>1.</th><th>2.</th><th>3.</th><th>Penkkipunnerrus</th>
        <th>1.</th><th>2.</th><th>3.</th><th>Maastanosto</th>
        <th>Yhteistulos</th><th>IPF GL</th>
      </tr>`,
    );
    const map = detectColumnMap(row);
    expect(map.position).toBe(0);
    expect(map.gender).toBe(1);
    expect(map.weightClass).toBe(2);
    expect(map.bodyWeight).toBe(3);
    expect(map.name).toBe(4);
    expect(map.club).toBe(5);
    expect(map.squatStart).toBe(6);
    expect(map.benchStart).toBe(10);
    expect(map.deadliftStart).toBe(14);
    expect(map.total).toBe(18);
    expect(map.points).toBe(19);
  });

  test("bench-only header clears squat/deadlift", () => {
    const row = rowFromHtml(
      `<tr>
        <th>Sij</th><th>Sarja</th><th>Paino</th><th>Nimi</th><th>Seura</th>
        <th>1.</th><th>2.</th><th>3.</th><th>Penkkipunnerrus</th>
        <th>Tulos</th>
      </tr>`,
    );
    const map = detectColumnMap(row);
    expect(map.squatStart).toBeUndefined();
    expect(map.deadliftStart).toBeUndefined();
    expect(map.benchStart).toBe(5);
  });

  test("attempt starts from sub-header 1. 2. 3. triples", () => {
    const header = rowFromHtml(
      `<tr>
        <th>Sij</th><th>Sarja</th><th>Paino</th><th>Nimi</th><th>Seura</th>
        <th colspan="4">Jalkakyykky</th>
        <th colspan="4">Penkkipunnerrus</th>
        <th colspan="4">Maastanosto</th>
        <th>Yhteistulos</th><th>Pisteet</th>
      </tr>`,
    );
    const subHeader = rowFromHtml(
      `<tr>
        <td></td><td></td><td></td><td></td><td></td>
        <td>1.</td><td>2.</td><td>3.</td><td>Tulos</td>
        <td>1.</td><td>2.</td><td>3.</td><td>Tulos</td>
        <td>1.</td><td>2.</td><td>3.</td><td>Tulos</td>
        <td>Yhteistulos</td><td>Pisteet</td>
      </tr>`,
    );
    const map = detectColumnMap(header, subHeader);
    expect(map.squatStart).toBe(5);
    expect(map.benchStart).toBe(9);
    expect(map.deadliftStart).toBe(13);
    expect(map.points).toBe(18);
    expect(map.total).toBe(17);
  });
});

describe("parseAttempt", () => {
  test("plain weight is a successful attempt", () => {
    expect(parseAttempt(cellFromHtml("<td>152,5</td>"))).toEqual({
      weight: 152.5,
      success: true,
    });
  });

  test("dash and empty mean no attempt", () => {
    expect(parseAttempt(cellFromHtml("<td>-</td>"))).toEqual({
      weight: 0,
      success: false,
    });
    expect(parseAttempt(cellFromHtml("<td></td>"))).toEqual({
      weight: 0,
      success: false,
    });
    expect(parseAttempt(undefined)).toEqual({ weight: 0, success: false });
  });

  test("inline line-through style marks failure", () => {
    const cell = cellFromHtml(
      `<td><span style="text-decoration: line-through;">160</span></td>`,
    );
    expect(parseAttempt(cell)).toEqual({ weight: 160, success: false });
  });

  test("semantic strikethrough tags mark failure", () => {
    expect(parseAttempt(cellFromHtml("<td><s>160</s></td>"))).toEqual({
      weight: 160,
      success: false,
    });
    expect(parseAttempt(cellFromHtml("<td><del>160</del></td>"))).toEqual({
      weight: 160,
      success: false,
    });
    expect(parseAttempt(cellFromHtml("<td><strike>160</strike></td>"))).toEqual(
      { weight: 160, success: false },
    );
  });

  test("strike-ish class names mark failure", () => {
    expect(
      parseAttempt(cellFromHtml(`<td class="strikethrough">160</td>`)),
    ).toEqual({ weight: 160, success: false });
    expect(
      parseAttempt(cellFromHtml(`<td><span class="strike">160</span></td>`)),
    ).toEqual({ weight: 160, success: false });
  });

  test("negative-number convention marks failure", () => {
    expect(parseAttempt(cellFromHtml("<td>-152,5</td>"))).toEqual({
      weight: 152.5,
      success: false,
    });
  });
});

describe("parseBirthYear", () => {
  test("four-digit year passes through", () => {
    expect(parseBirthYear("1987")).toBe(1987);
  });

  test("two-digit years pivot between centuries", () => {
    expect(parseBirthYear("05")).toBe(2005);
    expect(parseBirthYear("99")).toBe(1999);
  });

  test("pivot tracks the current year", () => {
    const pivot = new Date().getFullYear() % 100;
    const atPivot = String(pivot).padStart(2, "0");
    const pastPivot = String(pivot + 1).padStart(2, "0");
    expect(parseBirthYear(atPivot)).toBe(2000 + pivot);
    expect(parseBirthYear(pastPivot)).toBe(1900 + pivot + 1);
  });

  test("garbage yields 0", () => {
    expect(parseBirthYear("")).toBe(0);
    expect(parseBirthYear(null)).toBe(0);
    expect(parseBirthYear("abc")).toBe(0);
  });
});

describe("extractAgeClassFromText", () => {
  test("recognizes known age classes", () => {
    expect(extractAgeClassFromText("M40 Klassinen")).toBe("M40");
    expect(extractAgeClassFromText("naiset n23")).toBe("N23");
    expect(extractAgeClassFromText("M18")).toBe("M18");
  });

  test("recognizes broadened age classes", () => {
    expect(extractAgeClassFromText("M75")).toBe("M75");
    expect(extractAgeClassFromText("N45 Klassinen")).toBe("N45");
    expect(extractAgeClassFromText("M80")).toBe("M80");
    expect(extractAgeClassFromText("N16")).toBe("N16");
  });

  test("age class directly after weight class digits still matches", () => {
    expect(extractAgeClassFromText("KV63N40")).toBe("N40");
  });

  test("does not match weight classes or letter-prefixed tokens", () => {
    expect(extractAgeClassFromText("N63")).toBeNull();
    expect(extractAgeClassFromText("M74")).toBeNull();
    expect(extractAgeClassFromText("SM40")).toBeNull();
    expect(extractAgeClassFromText("Miehet avoin")).toBeNull();
  });
});

describe("isResultsTable", () => {
  test("matches nimi + seura header", () => {
    const rows = [rowFromHtml("<tr><th>Sij</th><th>Nimi</th><th>Seura</th></tr>")];
    expect(isResultsTable(rows)).toEqual({ match: true, headerRowIndex: 0 });
  });

  test("matches nimi + sarja when seura is missing", () => {
    const rows = [rowFromHtml("<tr><th>Sarja</th><th>Nimi</th></tr>")];
    expect(isResultsTable(rows)).toEqual({ match: true, headerRowIndex: 0 });
  });

  test("falls back to a row naming two lifts", () => {
    const rows = [
      rowFromHtml("<tr><td>Kilpailun tulokset</td></tr>"),
      rowFromHtml(
        "<tr><th>Jalkakyykky</th><th>Penkkipunnerrus</th><th>Maastanosto</th></tr>",
      ),
    ];
    expect(isResultsTable(rows)).toEqual({ match: true, headerRowIndex: 1 });
  });

  test("prefers the nimi header even when a lift row comes first", () => {
    const rows = [
      rowFromHtml("<tr><td>Jalkakyykky ja penkkipunnerrus</td></tr>"),
      rowFromHtml("<tr><th>Nimi</th><th>Seura</th></tr>"),
    ];
    expect(isResultsTable(rows)).toEqual({ match: true, headerRowIndex: 1 });
  });

  test("rejects unrelated tables", () => {
    const rows = [rowFromHtml("<tr><td>Ennätykset</td><td>2025</td></tr>")];
    expect(isResultsTable(rows)).toEqual({ match: false, headerRowIndex: -1 });
  });
});

describe("parseDateRange", () => {
  test("single date", () => {
    expect(parseDateRange("30.12.2025")).toEqual({
      startDate: "30.12.2025",
      endDate: "30.12.2025",
    });
  });

  test("range within a month", () => {
    expect(parseDateRange("7.-9.11.2025")).toEqual({
      startDate: "7.11.2025",
      endDate: "9.11.2025",
    });
  });

  test("range across months", () => {
    expect(parseDateRange("31.1.-2.2.2025")).toEqual({
      startDate: "31.1.2025",
      endDate: "2.2.2025",
    });
  });

  test("empty input yields empty range", () => {
    expect(parseDateRange("")).toEqual({});
  });
});
