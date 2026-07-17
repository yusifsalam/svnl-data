import { parseHTML } from "linkedom";
import type {
  Attempt,
  Competition,
  CompetitionResult,
  Lifter,
  ParseConfidence,
  ParseIssue,
  ParseReport,
  TableReport,
} from "./types";

/**
 * Parse a competition page HTML into structured data.
 * The report captures what the parser saw and guessed, so a source
 * format change surfaces as diagnostics instead of silent bad data.
 */
export function parseCompetitionPage(
  html: string,
  competition: Competition,
): { results: CompetitionResult[]; report: ParseReport } {
  const { document } = parseHTML(html);

  const parsedCompetition = parseEventInfo(document, competition);
  const outcome = parseLifters(document);
  let lifters = outcome.lifters;

  const competitionNameLower = parsedCompetition.name.toLowerCase();
  if (competitionNameLower.includes("varuste")) {
    lifters = lifters.map((lifter) => ({ ...lifter, equipment: "equipped" }));
  }

  const report = buildParseReport(outcome, lifters.length);

  const eventType = detectEventType(lifters);

  const byEquipment = new Map<"raw" | "equipped", Lifter[]>();
  for (const lifter of lifters) {
    const list = byEquipment.get(lifter.equipment) || [];
    list.push(lifter);
    byEquipment.set(lifter.equipment, list);
  }

  if (byEquipment.size <= 1) {
    return {
      results: [{ competition: { ...parsedCompetition, eventType }, lifters }],
      report,
    };
  }

  const results: CompetitionResult[] = [];
  for (const [equipment, group] of byEquipment.entries()) {
    const equipmentLabel = equipment === "raw" ? "Classic" : "Equipped";
    results.push({
      competition: {
        ...parsedCompetition,
        id: `${parsedCompetition.id}-${equipment}`,
        name: `${parsedCompetition.name} (${equipmentLabel})`,
        eventType,
      },
      lifters: group,
    });
  }

  return { results, report };
}

function buildParseReport(
  outcome: LiftersOutcome,
  lifterCount: number,
): ParseReport {
  const issues = [...outcome.issues];

  if (outcome.tablesMatched === 0) {
    issues.push({
      severity: "error",
      code: "no_results_table",
      message: `No results table recognized (${outcome.tablesSeen} tables on page)`,
    });
  } else if (lifterCount === 0) {
    issues.push({
      severity: "error",
      code: "no_lifters_parsed",
      message: "Results table matched but no lifter rows were parsed",
    });
  }

  let confidence: ParseConfidence = "ok";
  for (const table of outcome.tables) {
    if (table.matched) {
      if (table.confidence === "failed") confidence = "failed";
      else if (table.confidence === "suspect" && confidence === "ok") {
        confidence = "suspect";
      }
    } else if (confidence === "ok") {
      // A table-shaped table nobody recognized may be lost results;
      // degrade so it surfaces, but matched-table failures rank higher
      confidence = "suspect";
    }
  }
  if (outcome.tablesMatched === 0 || lifterCount === 0) {
    confidence = "failed";
  }

  return {
    tablesSeen: outcome.tablesSeen,
    tablesMatched: outcome.tablesMatched,
    tables: outcome.tables,
    issues,
    liftersParsed: lifterCount,
    confidence,
  };
}

/**
 * Extract competition info from page header/title
 */
function parseEventInfo(doc: Document, competition: Competition): Competition {
  const titleEl = doc.querySelector("h1.entry-title, h1, title");
  const titleText = titleEl?.textContent?.trim() || "";

  // Title format: "PV-81, Kansallinen voimanostokilpailu, Pori, 30.12.2025"
  const parts = titleText.split(",").map((s) => s.trim());

  let name = titleText || competition.name || competition.id;
  let date = "";
  let location = "";
  let category: "nationals" | "local" = competition.category || "local";

  if (parts.length >= 2) {
    const lastPart = parts[parts.length - 1];
    date = lastPart;
    const dateOnly = extractDateFromText(lastPart);
    if (dateOnly) {
      date = dateOnly;
      const locationOnly = extractLocationFromText(lastPart, dateOnly);
      if (locationOnly) {
        location = locationOnly;
      } else if (
        parts.length >= 3 &&
        !looksLikeCompetitionName(parts[parts.length - 2])
      ) {
        location = parts[parts.length - 2];
      }
    }
    // Name is everything except date/location parts
    const nameParts = parts.slice(0, -1);
    if (location && nameParts.length > 0 && nameParts[nameParts.length - 1] === location) {
      nameParts.pop();
    }
    name = nameParts.join(", ");

    // Detect category from title
    const lowerTitle = titleText.toLowerCase();
    if (lowerTitle.includes("sm-") || lowerTitle.includes("suomen mestaruus")) {
      category = "nationals";
    }
  }

  date = cleanDate(date);

  if (!isLikelyDate(date)) {
    const timeEl = doc.querySelector("time");
    const timeText =
      timeEl?.getAttribute("datetime")?.trim() ||
      timeEl?.textContent?.trim() ||
      "";
    const cleanedTime = cleanDate(timeText);
    if (isLikelyDate(cleanedTime)) {
      date = cleanedTime;
    }
  }

  if (!isLikelyDate(date) && competition.date) {
    date = competition.date;
  }

  const dateRange = parseDateRange(date);

  return {
    id: competition.id,
    url: competition.url,
    name,
    date,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    location: location || undefined,
    category,
  };
}

// The segment before the date is usually a city, but some titles omit the
// city and that slot is event-name text instead (e.g. "LIKE, Klassisen
// voimanoston masters SM-kilpailut, 5.-7.6.2026"). Competition keywords
// mark it as name, not location; Finnish city names never contain them.
function looksLikeCompetitionName(part: string): boolean {
  const text = part.toLowerCase();
  return [
    "voimanost",
    "penkkipunnerrus",
    "kilpailu",
    "klassi",
    "kansallinen",
    "jäsenten",
    "mästerskap",
    "styrkelyft",
    "masters",
    "mestaruus",
    "sm-",
  ].some((keyword) => text.includes(keyword));
}

function cleanDate(value: string): string {
  if (!value) return "";
  return value
    .replace(/\s+-\s+[A-Za-z\u00c4\u00d6\u00c5\u00e4\u00f6\u00e5\s]+$/i, "")
    .trim();
}

function extractDateFromText(value: string): string {
  const cleaned = cleanDate(value);
  const rangeMatch = cleaned.match(
    /(\d{1,2}\.(?:\d{1,2}\.)?\s*[–-]\s*\d{1,2}\.\d{1,2}\.\d{2,4})/
  );
  if (rangeMatch) return rangeMatch[1];
  const singleMatch = cleaned.match(/(\d{1,2}\.\d{1,2}\.\d{2,4})/);
  if (singleMatch) return singleMatch[1];
  return "";
}

function extractLocationFromText(value: string, dateOnly: string): string {
  const cleaned = value
    .replace(dateOnly, "")
    .replace(/\s+-\s+Suomen Voimanostoliitto ry$/i, "")
    .replace(/[–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  if (!cleaned.match(/[A-Za-zÄÖÅäöå]/)) return "";
  return cleaned;
}

function isLikelyDate(value: string): boolean {
  if (!value) return false;
  return (
    /(\d{1,2}\.\d{1,2}\.\d{2,4})/.test(value) ||
    /(\d{1,2}\.\s*[-\u2013]\s*\d{1,2}\.\d{1,2}\.\d{2,4})/.test(value)
  );
}

export function parseDateRange(dateText: string): {
  startDate?: string;
  endDate?: string;
} {
  if (!dateText) return {};

  const normalized = dateText.replace(/\s+/g, " ").trim();
  const rangeMatch = normalized.match(
    /^(\d{1,2})\.(\d{1,2})?\.?\s*[-\u2013]\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/,
  );
  if (rangeMatch) {
    const [, startDay, startMonth, endDay, endMonth, endYear] = rangeMatch;
    const month = startMonth || endMonth;
    return {
      startDate: `${startDay}.${month}.${endYear}`,
      endDate: `${endDay}.${endMonth}.${endYear}`,
    };
  }

  const singleMatch = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (singleMatch) {
    return { startDate: normalized, endDate: normalized };
  }

  return {};
}

/**
 * Identify a results table and its header row. Shared with cache.ts so
 * extraction and parsing can never disagree on which tables count.
 * Primary signal is the Nimi column paired with Seura or Sarja; a row
 * naming two or more lifts is accepted as a fallback so a renamed
 * name/club header doesn't silently drop the whole table.
 */
export function isResultsTable(rows: Element[]): {
  match: boolean;
  headerRowIndex: number;
} {
  for (let i = 0; i < rows.length; i++) {
    const text = rows[i].textContent?.toLowerCase() || "";
    if (
      (text.includes("nimi") || text.includes("name")) &&
      (text.includes("seura") ||
        text.includes("sarja") ||
        text.includes("club") ||
        text.includes("class"))
    ) {
      return { match: true, headerRowIndex: i };
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const text = rows[i].textContent?.toLowerCase() || "";
    const liftHeaderCount = Math.max(
      ["jalkakyykky", "penkkipunnerrus", "maastanosto"].filter((lift) =>
        text.includes(lift),
      ).length,
      ["squat", "bench", "deadlift"].filter((lift) => text.includes(lift))
        .length,
    );
    if (liftHeaderCount >= 2) {
      return { match: true, headerRowIndex: i };
    }
  }
  return { match: false, headerRowIndex: -1 };
}

type LiftersOutcome = {
  lifters: Lifter[];
  tables: TableReport[];
  issues: ParseIssue[];
  tablesSeen: number;
  tablesMatched: number;
};

export function isTableShaped(rows: Element[]): boolean {
  return (
    rows.length >= 3 &&
    rows.some((row) => row.querySelectorAll("td, th").length >= 6)
  );
}

/**
 * Parse all lifters from results tables
 */
function parseLifters(doc: Document): LiftersOutcome {
  const lifters: Lifter[] = [];
  const tableReports: TableReport[] = [];
  const issues: ParseIssue[] = [];
  const tables = Array.from(doc.querySelectorAll("table"));
  let tablesMatched = 0;

  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const table = tables[tableIndex];
    const rows = Array.from(table.querySelectorAll("tr"));

    const { match, headerRowIndex } = isResultsTable(rows);
    if (!match) {
      // A table-shaped table that fails the gate is the alarm for
      // "the header wording changed and we stopped recognizing results"
      if (isTableShaped(rows)) {
        const snippet = (rows[0]?.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120);
        tableReports.push({
          tableIndex,
          matched: false,
          skippedReason: "no recognizable results header",
          fallbacksUsed: [],
          rowsParsed: 0,
          rowsDroppedExpected: 0,
          droppedRows: [],
          checks: {},
          confidence: "failed",
        });
        issues.push({
          severity: "warning",
          code: "table_unmatched",
          message: `Table ${tableIndex} looks like a results table but no header row was recognized`,
          tableIndex,
          snippet,
        });
      }
      continue;
    }
    tablesMatched++;

    const tableLifterStart = lifters.length;
    const fallbacksUsed: string[] = [];
    let rowsDroppedExpected = 0;
    // Results tables end with records/judges sections; drops there are
    // structural, not lost lifters
    let inFooterSection = false;
    const droppedRows: TableReport["droppedRows"] = [];
    const dropRow = (rowIndex: number, reason: string, text: string) => {
      if (droppedRows.length < 20) {
        droppedRows.push({
          rowIndex,
          reason,
          snippet: text.replace(/\s+/g, " ").trim().slice(0, 120),
        });
      }
    };

    // SVNL tables have fixed column structure:
    // 0: Sij (position)
    // 1: M/N (gender)
    // 2: Sarja (weight class)
    // 3: Paino (body weight)
    // 4: Nimi (name)
    // 5: Seura (club)
    // 6-8: Squat attempts (1, 2, 3)
    // 9: Best squat
    // 10-12: Bench attempts (1, 2, 3)
    // 13: Best bench
    // 14-16: Deadlift attempts (1, 2, 3)
    // 17: Best deadlift
    // 18: Total
    // 19: Points

    const subHeaderRow =
      headerRowIndex + 1 < rows.length && isHeaderRow(rows[headerRowIndex + 1])
        ? rows[headerRowIndex + 1]
        : undefined;
    const columnMap = detectColumnMap(
      rows[headerRowIndex],
      subHeaderRow,
      fallbacksUsed,
    );
    const dataStartIndex = subHeaderRow
      ? headerRowIndex + 2
      : headerRowIndex + 1;

    const missingCritical: string[] = [];
    if (columnMap.name === undefined) missingCritical.push("name");
    if (columnMap.club === undefined) missingCritical.push("club");
    if (columnMap.position === undefined) missingCritical.push("position");
    if (columnMap.bodyWeight === undefined) missingCritical.push("bodyWeight");
    if (columnMap.total === undefined) missingCritical.push("total");
    if (columnMap.benchStart === undefined) missingCritical.push("benchStart");
    if (missingCritical.length > 0) {
      fallbacksUsed.push(
        `legacy_positional_map(${missingCritical.join(",")})`,
      );
    }

    // Header-derived indices with the historical fixed layout as the
    // fallback candidate; when the candidate is in play (fallbacksUsed)
    // the cross-checks decide whether its output is trustworthy
    const positionIndex = columnMap.position ?? 0;
    const genderIndex = columnMap.gender;
    const weightClassIndex = columnMap.weightClass ?? 2;
    const bodyWeightIndex = columnMap.bodyWeight ?? 3;
    const nameIndex = columnMap.name ?? 4;
    const clubIndex = columnMap.club ?? 5;
    const birthYearIndex = columnMap.birthYear;
    const squatStart = columnMap.squatStart;
    const benchStart = columnMap.benchStart ?? 10;
    const deadliftStart = columnMap.deadliftStart;
    const totalIndex = columnMap.total ?? 18;
    const pointsIndex = columnMap.points ?? 19;

    const resolvedMap: ColumnMap = {
      ...columnMap,
      position: positionIndex,
      weightClass: weightClassIndex,
      bodyWeight: bodyWeightIndex,
      name: nameIndex,
      club: clubIndex,
      benchStart,
      total: totalIndex,
      points: pointsIndex,
    };

    const minRequiredIndex = Math.max(
      nameIndex,
      clubIndex,
      positionIndex,
      genderIndex ?? -1,
      weightClassIndex,
      bodyWeightIndex,
    );

    let keptNoPosition = 0;

    const genderInfo = findGenderMarkers(rows);
    const hasGenderColumn = columnMap.gender !== undefined;
    let defaultGender: "M" | "F" | null = null;
    let currentGender = findGenderBeforeIndex(rows, dataStartIndex);
    let currentAgeClassHeader = findAgeClassBeforeIndex(
      rows,
      dataStartIndex,
      resolvedMap,
    );
    let currentEquipment: "raw" | "equipped" = "raw";
    if (!hasGenderColumn) {
      if (genderInfo.hasNaiset && !genderInfo.hasMiehet) {
        defaultGender = "F";
      } else if (genderInfo.hasMiehet && !genderInfo.hasNaiset) {
        if (
          genderInfo.miehetIndex !== null &&
          hasLiftersBeforeIndex(
            rows,
            dataStartIndex,
            genderInfo.miehetIndex,
            resolvedMap,
          )
        ) {
          defaultGender = "F";
        }
      }
    }
    if (!currentGender && defaultGender) {
      currentGender = defaultGender;
    }

    // Parse data rows (skip header rows)
    for (let i = dataStartIndex; i < rows.length; i++) {
      const row = rows[i];
      const cells = Array.from(row.querySelectorAll("td"));
      const rowText = (row.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (
        !inFooterSection &&
        (rowText.startsWith("ennätykset") ||
          rowText.startsWith("tuomarit") ||
          rowText.startsWith("jury") ||
          rowText.includes("päätuomari") ||
          rowText.includes("referee"))
      ) {
        inFooterSection = true;
      }
      const isRepeatedHeader =
        rowText.includes("nimi") &&
        (rowText.includes("sij") || rowText.includes("seura")) &&
        isHeaderRow(row);

      const ageClassFromRow = extractAgeClassFromText(rowText);
      if (ageClassFromRow && isAgeClassHeaderRow(row, rowText, resolvedMap)) {
        currentAgeClassHeader = ageClassFromRow;
        currentGender = ageClassFromRow.startsWith("N") ? "F" : "M";
        rowsDroppedExpected++;
        continue;
      }

      const nonEmptyCells = cells.filter((cell) => {
        const text = (cell.textContent || "").trim();
        return text && text !== "-";
      });
      // Section-header rows carry a single label cell (gender/age class or
      // equipment), often as one colspan cell — so they have fewer cells
      // than minRequiredIndex. Their state update must run before the
      // structural-drop check below; otherwise the gender/equipment switch
      // is silently lost and every following lifter inherits the previous
      // section's gender (masters meets label sections "N40"/"M40"/...)
      if (nonEmptyCells.length === 1) {
        const equipmentFromLabel = extractEquipmentLabel(rowText);
        // English pages combine gender and equipment in one header cell
        // ("Men equipped"); "women" must be tested before "men" since it
        // contains it as a substring
        const sectionGender: "M" | "F" | null =
          rowText === "naiset" || rowText.includes("women")
            ? "F"
            : rowText === "miehet" || rowText.includes("men")
              ? "M"
              : null;
        if (equipmentFromLabel) {
          currentEquipment = equipmentFromLabel;
          if (sectionGender) currentGender = sectionGender;
          rowsDroppedExpected++;
          continue;
        }
        const genderFromLabel = extractGenderLabel(rowText);
        if (genderFromLabel) {
          currentGender = genderFromLabel;
          const headerAgeClass = extractAgeClassFromText(rowText);
          if (headerAgeClass) {
            currentAgeClassHeader = headerAgeClass;
          }
          rowsDroppedExpected++;
          continue;
        }
        if (sectionGender) {
          currentGender = sectionGender;
          rowsDroppedExpected++;
          continue;
        }
      }

      if (cells.length <= minRequiredIndex) {
        const hasContent = cells.some((cell) => {
          const text = (cell.textContent || "").trim();
          return text && text !== "-";
        });
        const looksStructural =
          !hasContent ||
          inFooterSection ||
          isHeaderRow(row) ||
          extractEquipmentLabel(rowText) !== null ||
          extractGenderLabel(rowText) !== null ||
          rowText === "naiset" ||
          rowText === "miehet" ||
          rowText.includes("ennätykset") ||
          rowText.includes("tuomari");
        if (looksStructural) {
          rowsDroppedExpected++;
        } else {
          dropRow(i, "fewer cells than expected", rowText);
        }
        continue;
      }

      // Get name from column
      const nameText = cells[nameIndex]?.textContent?.trim() || "";

      // Skip empty names or division/gender headers
      if (!nameText) {
        if (nonEmptyCells.length === 0 || inFooterSection || isRepeatedHeader) {
          rowsDroppedExpected++;
        } else {
          dropRow(i, "empty name cell", rowText);
        }
        continue;
      }
      const nameLower = nameText.toLowerCase();
      if (
        nameLower === "klassinen" ||
        nameLower === "varuste" ||
        nameLower === "naiset" ||
        nameLower === "miehet" ||
        nameLower.includes("etunimi") ||
        nameLower.includes("ennätykset") ||
        nameLower.includes("tuomari")
      ) {
        rowsDroppedExpected++;
        continue;
      }

      // Parse name and birth year (format: "Name / YY")
      let name = nameText;
      let birthYear = 0;
      if (birthYearIndex !== undefined) {
        birthYear = parseBirthYear(cells[birthYearIndex]?.textContent);
      }
      if (nameText.includes("/")) {
        const [namePart, yearPart] = nameText.split("/").map((s) => s.trim());
        name = namePart;
        if (!birthYear) {
          birthYear = parseBirthYear(yearPart);
        }
      }

      // Parse position
      const positionText =
        cells[positionIndex]?.textContent?.trim().replace(".", "") || "";
      const position = parseInt(positionText) || 0;
      const hasNumericPosition = position !== 0 || !!positionText.match(/^\d/);

      if (!hasNumericPosition && (inFooterSection || isRepeatedHeader)) {
        rowsDroppedExpected++;
        continue;
      }

      // Parse gender from column 1, fallback to section header
      const genderText =
        genderIndex !== undefined
          ? cells[genderIndex]?.textContent?.trim().toUpperCase() || ""
          : "";
      let gender: "M" | "F";
      if (genderText.startsWith("N") || genderText.startsWith("W")) {
        gender = "F";
      } else if (genderText.startsWith("M")) {
        gender = "M";
      } else {
        gender = currentGender || defaultGender || "M";
      }

      // Parse weight class from column 2
      const weightClassText =
        cells[weightClassIndex]?.textContent?.trim() || "";
      const ageClassFromCell = extractAgeClassFromText(weightClassText);
      const weightClassClean = weightClassText
        .replace(/[MN]\d{2}/gi, "")
        .trim();
      const weightClassMatch = weightClassClean.match(/^(\d+(?:\.\d+)?)(\+)?/);
      let weightClass = "";
      if (weightClassMatch) {
        const numeric = weightClassMatch[1];
        const plus = weightClassMatch[2] ? "+" : "";
        weightClass = plus ? `${numeric}+` : `-${numeric}`;
      } else {
        const prefixedMatch = weightClassText.match(
          /^[MN]\s*(\d+(?:\.\d+)?)(\+)?/i,
        );
        if (prefixedMatch) {
          const numeric = prefixedMatch[1];
          const plus = prefixedMatch[2] ? "+" : "";
          weightClass = plus ? `${numeric}+` : `-${numeric}`;
        }
      }
      const ageClass = ageClassFromCell || currentAgeClassHeader || undefined;

      // Parse body weight from column 3
      const bodyWeight = parseNumber(cells[bodyWeightIndex]?.textContent);

      // Parse club from column 5
      const club = cells[clubIndex]?.textContent?.trim() || "";

      // Parse attempts
      const squat = parseAttempts(cells, squatStart);
      const bench = parseAttempts(cells, benchStart);
      const deadlift = parseAttempts(cells, deadliftStart);

      // Parse total and points
      const total = parseNumber(cells[totalIndex]?.textContent);
      const points = parseNumber(cells[pointsIndex]?.textContent);

      // Keep DSQ / out-of-competition rows (position "-", "dsq", empty)
      // as position 0 when they clearly carry lift data; dropping them
      // silently loses real lifters
      if (!hasNumericPosition) {
        const hasLiftData =
          total > 0 ||
          [...squat, ...bench, ...deadlift].some((a) => a.weight > 0);
        if (!/[a-zåäö]/i.test(name) || !hasLiftData) {
          dropRow(i, "no numeric position", rowText);
          continue;
        }
        keptNoPosition++;
      }

      lifters.push({
        name,
        birthYear,
        gender,
        ageClass,
        equipment: currentEquipment,
        weightClass,
        bodyWeight,
        club,
        squat,
        bench,
        deadlift,
        total,
        points,
        position,
      });
    }

    const tableLifters = lifters.slice(tableLifterStart);
    const checks = assessTable(tableLifters);
    const confidence = tableConfidence(
      tableLifters,
      checks,
      fallbacksUsed,
      droppedRows.length,
    );

    tableReports.push({
      tableIndex,
      matched: true,
      columnMap: { ...resolvedMap },
      fallbacksUsed,
      rowsParsed: tableLifters.length,
      rowsDroppedExpected,
      droppedRows,
      checks,
      confidence,
    });

    if (keptNoPosition > 0) {
      issues.push({
        severity: "info",
        code: "kept_no_position",
        message: `Table ${tableIndex}: ${keptNoPosition} lifter(s) without a numeric position kept as position 0 (DSQ/out of competition)`,
        tableIndex,
      });
    }

    if (confidence !== "ok") {
      issues.push({
        severity: confidence === "failed" ? "error" : "warning",
        code:
          checks.totalAgreementRate !== undefined &&
          checks.totalAgreementRate < 0.9
            ? "column_misalignment"
            : "low_parse_confidence",
        message: `Table ${tableIndex}: confidence ${confidence} (totals agree ${formatRate(checks.totalAgreementRate)}, sane names ${formatRate(checks.nameSanityRate)}${fallbacksUsed.length ? `, fallbacks: ${fallbacksUsed.join("; ")}` : ""})`,
        tableIndex,
      });
    }
    if (droppedRows.length > 0) {
      issues.push({
        severity: "warning",
        code: "rows_dropped",
        message: `Table ${tableIndex}: ${droppedRows.length} row(s) dropped unexpectedly (first: ${droppedRows[0].reason})`,
        tableIndex,
        snippet: droppedRows[0].snippet,
      });
    }
  }

  return {
    lifters,
    tables: tableReports,
    issues,
    tablesSeen: tables.length,
    tablesMatched,
  };
}

function formatRate(rate: number | undefined): string {
  return rate === undefined ? "n/a" : `${Math.round(rate * 100)}%`;
}

/**
 * Cross-checks that catch column misalignment: shifted columns destroy
 * the total-vs-best-sum agreement immediately, and numeric text landing
 * in the name column fails the letter test
 */
function assessTable(lifters: Lifter[]): TableReport["checks"] {
  if (lifters.length === 0) return {};

  const best = (attempts: [Attempt, Attempt, Attempt]) =>
    Math.max(0, ...attempts.filter((a) => a.success).map((a) => a.weight));

  let withTotal = 0;
  let totalsAgree = 0;
  let saneNames = 0;
  let positionMonotonic = true;
  let prevPosition = 0;

  for (const lifter of lifters) {
    if (lifter.total > 0) {
      withTotal++;
      const sum =
        best(lifter.squat) + best(lifter.bench) + best(lifter.deadlift);
      if (Math.abs(sum - lifter.total) < 0.011) totalsAgree++;
    }

    const nameSane = /[a-zåäö]/i.test(lifter.name);
    const clubSane = lifter.club === "" || /[a-zåäö]/i.test(lifter.club);
    if (nameSane && clubSane) saneNames++;

    if (lifter.position > 0) {
      if (lifter.position !== 1 && lifter.position < prevPosition) {
        positionMonotonic = false;
      }
      prevPosition = lifter.position;
    }
  }

  return {
    totalAgreementRate: withTotal > 0 ? totalsAgree / withTotal : undefined,
    nameSanityRate: saneNames / lifters.length,
    positionMonotonic,
  };
}

function tableConfidence(
  lifters: Lifter[],
  checks: TableReport["checks"],
  fallbacksUsed: string[],
  unexpectedDrops: number,
): ParseConfidence {
  if (lifters.length === 0) return "failed";
  const agreement = checks.totalAgreementRate;
  const nameSanity = checks.nameSanityRate;
  if (
    (agreement !== undefined && agreement < 0.5) ||
    (nameSanity !== undefined && nameSanity < 0.8)
  ) {
    return "failed";
  }
  // A guessed positional map needs stronger corroboration than a
  // header-derived one before its output is merely "suspect"
  const usedLegacyMap = fallbacksUsed.some((note) =>
    note.startsWith("legacy_positional_map"),
  );
  if (usedLegacyMap && agreement !== undefined && agreement < 0.8) {
    return "failed";
  }
  // Attempts parsed but not a single total: a missing/misplaced total
  // column would otherwise pass vacuously (agreement is undefined)
  const hasLiftData = lifters.some((lifter) =>
    [lifter.squat, lifter.bench, lifter.deadlift].some((attempts) =>
      attempts.some((attempt) => attempt.weight > 0),
    ),
  );
  if (
    (agreement !== undefined && agreement < 0.9) ||
    (agreement === undefined && hasLiftData) ||
    checks.positionMonotonic === false ||
    unexpectedDrops > 0 ||
    fallbacksUsed.length > 0
  ) {
    return "suspect";
  }
  return "ok";
}

export type ColumnMap = {
  position?: number;
  gender?: number;
  weightClass?: number;
  bodyWeight?: number;
  name?: number;
  birthYear?: number;
  club?: number;
  squatStart?: number;
  benchStart?: number;
  deadliftStart?: number;
  total?: number;
  points?: number;
};

/**
 * Header cells use colspan (e.g. "Penkkipunnerrus" spanning attempts +
 * best); indices must be expanded to line up with data columns
 */
function expandedHeaderTexts(row: Element): string[] {
  const texts: string[] = [];
  for (const cell of Array.from(row.querySelectorAll("th, td"))) {
    texts.push((cell.textContent || "").trim().toLowerCase());
    const colspan = parseInt(cell.getAttribute("colspan") || "1") || 1;
    for (let i = 1; i < colspan; i++) texts.push("");
  }
  return texts;
}

export function detectColumnMap(
  row: Element,
  subHeaderRow?: Element,
  fallbackNotes?: string[],
): ColumnMap {
  const headerTexts = expandedHeaderTexts(row);
  // Newer SVNL pages have sub-header rows with only a handful of cells
  // (visual alignment via the main header's colspans); their indices do
  // not correspond to data columns and must not be trusted
  const rawSubHeaderTexts = subHeaderRow
    ? expandedHeaderTexts(subHeaderRow)
    : null;
  const subHeaderTexts =
    rawSubHeaderTexts && rawSubHeaderTexts.length >= headerTexts.length * 0.8
      ? rawSubHeaderTexts
      : null;

  const columnMap: ColumnMap = {};

  headerTexts.forEach((text, index) => {
    if (text.includes("sij") || text === "place") columnMap.position = index;
    if (text.includes("m/n") || text.includes("sukupuoli") || text === "m/w")
      columnMap.gender = index;
    if (text.includes("sarja") || text === "class") columnMap.weightClass = index;
    if ((text.includes("paino") && !text.includes("kk")) || text === "bwt")
      columnMap.bodyWeight = index;
    if (text.includes("nimi") || text.includes("name")) columnMap.name = index;
    if (text === "sv" || text === "by" || text.includes("syntymävuosi")) {
      columnMap.birthYear = index;
    }
    if (text.includes("seura") || text.includes("club")) columnMap.club = index;

    if (
      text.includes("jalkakyykky") ||
      text.startsWith("jk") ||
      text.includes("squat")
    ) {
      if (columnMap.squatStart === undefined) {
        columnMap.squatStart = numberedAttemptStart(headerTexts, index);
      }
    }

    if (
      text.includes("penkkipunnerrus") ||
      text.startsWith("pp") ||
      text.includes("bench")
    ) {
      if (columnMap.benchStart === undefined) {
        columnMap.benchStart = numberedAttemptStart(headerTexts, index);
      }
    }

    if (
      text.includes("maastanosto") ||
      text.startsWith("mn") ||
      text.includes("deadlift")
    ) {
      if (columnMap.deadliftStart === undefined) {
        columnMap.deadliftStart = numberedAttemptStart(headerTexts, index);
      }
    }

    if (
      (text.includes("ipf") && text.includes("gl")) ||
      text.includes("pisteet") ||
      text === "points"
    )
      columnMap.points = index;
  });

  // "Yhteistulos" is unambiguous; a bare "Tulos" also appears as the
  // per-lift best column after each attempt triple, so only accept it
  // when it sits beyond every detected attempt block
  const yhteistulosIndex = lastIndexMatching(headerTexts, (text) =>
    text.includes("yhteistulos"),
  );
  if (yhteistulosIndex !== undefined) {
    columnMap.total = yhteistulosIndex;
  } else {
    const attemptBlockEnds = [
      columnMap.squatStart,
      columnMap.benchStart,
      columnMap.deadliftStart,
    ]
      .filter((start): start is number => start !== undefined)
      .map((start) => start + 3);
    const tulosIndex = lastIndexMatching(headerTexts, (text) =>
      text.includes("tulos"),
    );
    if (
      tulosIndex !== undefined &&
      attemptBlockEnds.every((end) => tulosIndex > end)
    ) {
      columnMap.total = tulosIndex;
    }
  }

  // English pages label the grand total "Total" (the per-lift best column
  // stays "Tulos"), so it never matches the tulos logic above
  if (columnMap.total === undefined) {
    const totalIndex = lastIndexMatching(headerTexts, (text) =>
      text.includes("total"),
    );
    if (totalIndex !== undefined) columnMap.total = totalIndex;
  }

  if (subHeaderTexts) {
    const squatHeaderIndex = headerTexts.findIndex(
      (text) =>
        text.includes("jalkakyykky") ||
        text.startsWith("jk") ||
        text.includes("squat"),
    );
    const benchHeaderIndex = headerTexts.findIndex(
      (text) =>
        text.includes("penkkipunnerrus") ||
        text.startsWith("pp") ||
        text.includes("bench"),
    );
    const deadliftHeaderIndex = headerTexts.findIndex(
      (text) =>
        text.includes("maastanosto") ||
        text.startsWith("mn") ||
        text.includes("deadlift"),
    );

    let lastAttemptEnd = 0;

    if (squatHeaderIndex >= 0) {
      const squatStart = findNextAttemptStart(subHeaderTexts, squatHeaderIndex);
      if (squatStart !== undefined) {
        columnMap.squatStart = squatStart;
        lastAttemptEnd = squatStart + 4;
      }
    }
    if (benchHeaderIndex >= 0) {
      const benchStart = findNextAttemptStart(subHeaderTexts, Math.max(benchHeaderIndex, lastAttemptEnd));
      if (benchStart !== undefined) {
        columnMap.benchStart = benchStart;
        lastAttemptEnd = benchStart + 4;
      }
    }
    if (deadliftHeaderIndex >= 0) {
      const deadliftStart = findNextAttemptStart(
        subHeaderTexts,
        Math.max(deadliftHeaderIndex, lastAttemptEnd),
      );
      if (deadliftStart !== undefined) columnMap.deadliftStart = deadliftStart;
    }

    const pointsIndex = subHeaderTexts.findIndex(
      (text) =>
        text.includes("ipf") ||
        text.includes("gl") ||
        text.includes("pisteet") ||
        text.includes("points"),
    );
    if (pointsIndex !== -1) columnMap.points = pointsIndex;
    if (pointsIndex > 0) {
      columnMap.total = pointsIndex - 1;
    } else {
      const lastTulosIndex = lastIndexMatching(
        subHeaderTexts,
        (text) => text.includes("tulos") || text.includes("yhteistulos"),
      );
      if (lastTulosIndex !== undefined) {
        columnMap.total = lastTulosIndex;
      }
    }
  }

  if (columnMap.benchStart === undefined) {
    for (let i = 0; i < headerTexts.length - 2; i++) {
      if (
        headerTexts[i]?.match(/^1\.?$/) &&
        headerTexts[i + 1]?.match(/^2\.?$/) &&
        headerTexts[i + 2]?.match(/^3\.?$/)
      ) {
        const isSquatColumns =
          columnMap.squatStart !== undefined &&
          i >= columnMap.squatStart &&
          i <= columnMap.squatStart + 3;
        const isDeadliftColumns =
          columnMap.deadliftStart !== undefined &&
          i >= columnMap.deadliftStart &&
          i <= columnMap.deadliftStart + 3;
        if (!isSquatColumns && !isDeadliftColumns) {
          columnMap.benchStart = i;
          fallbackNotes?.push("bench_guess_by_123");
          break;
        }
      }
    }
  }

  const hasSquatHeader = headerTexts.some(
    (text) => text.includes("jalkakyykky") || text.includes("squat"),
  );
  const hasDeadliftHeader = headerTexts.some(
    (text) => text.includes("maastanosto") || text.includes("deadlift"),
  );
  const hasBenchHeader = headerTexts.some(
    (text) => text.includes("penkkipunnerrus") || text.includes("bench"),
  );
  if (hasBenchHeader && !hasSquatHeader && !hasDeadliftHeader) {
    columnMap.squatStart = undefined;
    columnMap.deadliftStart = undefined;
  }

  return columnMap;
}

function numberedAttemptStart(headerTexts: string[], index: number): number {
  if (index >= 3) {
    const hasNumberedAttempts =
      headerTexts[index - 3]?.match(/^1\.?$/) &&
      headerTexts[index - 2]?.match(/^2\.?$/) &&
      headerTexts[index - 1]?.match(/^3\.?$/);
    if (hasNumberedAttempts) {
      return index - 3;
    }
  }
  return index;
}

function findNextAttemptStart(
  headerTexts: string[],
  startIndex: number,
): number | undefined {
  const fromIndex = Math.max(startIndex, 0);
  for (let i = fromIndex; i < headerTexts.length - 2; i++) {
    if (
      headerTexts[i]?.match(/^1\.?$/) &&
      headerTexts[i + 1]?.match(/^2\.?$/) &&
      headerTexts[i + 2]?.match(/^3\.?$/)
    ) {
      return i;
    }
  }
  return undefined;
}

function lastIndexMatching(
  headerTexts: string[],
  predicate: (value: string) => boolean,
): number | undefined {
  for (let i = headerTexts.length - 1; i >= 0; i--) {
    if (predicate(headerTexts[i])) {
      return i;
    }
  }
  return undefined;
}

function isHeaderRow(row: Element): boolean {
  if (row.querySelectorAll("th").length > 0) {
    return true;
  }
  const texts = Array.from(row.querySelectorAll("th, td")).map((cell) =>
    (cell.textContent || "").trim().toLowerCase(),
  );
  if (
    texts.some(
      (text) =>
        text.includes("sij") ||
        text.includes("nimi") ||
        text.includes("seura") ||
        text.includes("sarja") ||
        text.includes("paino") ||
        text.includes("ipf") ||
        text.includes("jalkakyykky") ||
        text.includes("penkkipunnerrus") ||
        text.includes("maastanosto") ||
        text.startsWith("jk") ||
        text.startsWith("pp") ||
        text.startsWith("mn") ||
        text === "place" ||
        text === "club" ||
        text.includes("squat") ||
        text.includes("bench") ||
        text.includes("deadlift") ||
        text.includes("tulos"),
    )
  ) {
    return true;
  }
  return false;
}

function findGenderMarkers(rows: Element[]): {
  hasNaiset: boolean;
  hasMiehet: boolean;
  naisetIndex: number | null;
  miehetIndex: number | null;
} {
  let hasNaiset = false;
  let hasMiehet = false;
  let naisetIndex: number | null = null;
  let miehetIndex: number | null = null;

  rows.forEach((row, index) => {
    const text = (row.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const genderFromLabel = extractGenderLabel(text);
    if (genderFromLabel === "F" || text === "naiset" || text === "women") {
      hasNaiset = true;
      if (naisetIndex === null) naisetIndex = index;
    }
    if (genderFromLabel === "M" || text === "miehet" || text === "men") {
      hasMiehet = true;
      if (miehetIndex === null) miehetIndex = index;
    }
  });

  return { hasNaiset, hasMiehet, naisetIndex, miehetIndex };
}

function findGenderBeforeIndex(
  rows: Element[],
  endIndex: number,
): "M" | "F" | null {
  let gender: "M" | "F" | null = null;
  for (let i = 0; i < Math.min(endIndex, rows.length); i++) {
    const text = (rows[i].textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const genderFromLabel = extractGenderLabel(text);
    if (genderFromLabel) {
      gender = genderFromLabel;
    } else if (text === "naiset" || text === "women") {
      gender = "F";
    } else if (text === "miehet" || text === "men") {
      gender = "M";
    }
  }
  return gender;
}

function extractGenderLabel(text: string): "M" | "F" | null {
  const trimmed = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!trimmed) return null;
  const ageClass = extractAgeClassFromText(trimmed);
  if (ageClass?.startsWith("N")) return "F";
  if (ageClass?.startsWith("M")) return "M";
  return null;
}

function extractEquipmentLabel(text: string): "raw" | "equipped" | null {
  const trimmed = text.replace(/\s+/g, " ").trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.includes("varuste") || trimmed.includes("equipped")) {
    return "equipped";
  }
  if (
    trimmed.includes("klassinen") ||
    trimmed.includes("classic") ||
    trimmed === "raw"
  ) {
    return "raw";
  }
  return null;
}

export function extractAgeClassFromText(text: string): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim().toUpperCase();
  // Enumerated ages rather than [NM]\d{2}, which would collide with
  // weight classes (N63, M74, ...). Digits may directly precede the age
  // class ("KV63N40" = weight class + age class), so only a letter
  // lookbehind guards against e.g. "SM40" matching
  const match = trimmed.match(
    /(?<![A-ZÅÄÖ])([NM](?:1[3-8]|23|4[05]|5[05]|6[05]|7[05]|80))/,
  );
  return match ? match[1] : null;
}

function findAgeClassBeforeIndex(
  rows: Element[],
  endIndex: number,
  columnMap: ColumnMap,
): string | null {
  let ageClass: string | null = null;
  for (let i = 0; i < Math.min(endIndex, rows.length); i++) {
    const text = (rows[i].textContent || "").replace(/\s+/g, " ").trim();
    const label = extractAgeClassFromText(text);
    if (!label) continue;
    const row = rows[i];
    const rowText = text.toLowerCase();
    if (
      isAgeClassHeaderRow(row, rowText, columnMap) ||
      isStandaloneAgeClassRow(row)
    ) {
      ageClass = label;
    }
  }
  return ageClass;
}

function isStandaloneAgeClassRow(row: Element): boolean {
  const cells = Array.from(row.querySelectorAll("td, th"));
  const nonEmptyCells = cells.filter((cell) => {
    const text = (cell.textContent || "").trim();
    return text && text !== "-";
  });
  if (nonEmptyCells.length !== 1) return false;
  const text = (nonEmptyCells[0].textContent || "").trim();
  return extractAgeClassFromText(text) !== null;
}

function hasLiftersBeforeIndex(
  rows: Element[],
  startIndex: number,
  endIndex: number,
  columnMap: ColumnMap,
): boolean {
  const nameIndex = columnMap.name ?? 4;
  const positionIndex = columnMap.position ?? 0;

  for (let i = startIndex; i < Math.min(endIndex, rows.length); i++) {
    const cells = Array.from(rows[i].querySelectorAll("td"));
    if (cells.length <= Math.max(nameIndex, positionIndex)) continue;
    const nameText = cells[nameIndex]?.textContent?.trim() || "";
    const positionText =
      cells[positionIndex]?.textContent?.trim().replace(".", "") || "";
    if (nameText && (parseInt(positionText) || positionText.match(/^\d/))) {
      return true;
    }
  }
  return false;
}

function isAgeClassHeaderRow(
  row: Element,
  rowText: string,
  columnMap: ColumnMap,
): boolean {
  const normalized = rowText.toLowerCase();
  const hasLiftHeaders =
    normalized.includes("jalkakyykky") ||
    normalized.includes("penkkipunnerrus") ||
    normalized.includes("maastanosto");
  if (!hasLiftHeaders) return false;

  const cells = Array.from(row.querySelectorAll("td, th"));
  const nameIndex = columnMap.name ?? 4;
  const positionIndex = columnMap.position ?? 0;
  const nameText = cells[nameIndex]?.textContent?.trim() || "";
  const positionText =
    cells[positionIndex]?.textContent?.trim().replace(".", "") || "";
  if (nameText) return false;
  if (positionText && positionText.match(/^\d/)) return false;
  return true;
}

/**
 * Parse 3 attempt cells starting at given index
 */
function parseAttempts(
  cells: Element[],
  startIndex: number | undefined,
): [Attempt, Attempt, Attempt] {
  if (startIndex === undefined) {
    return [
      { weight: 0, success: false },
      { weight: 0, success: false },
      { weight: 0, success: false },
    ];
  }
  return [
    parseAttempt(cells[startIndex]),
    parseAttempt(cells[startIndex + 1]),
    parseAttempt(cells[startIndex + 2]),
  ];
}

/**
 * Parse a single attempt cell
 */
export function parseAttempt(cell: Element | undefined): Attempt {
  if (!cell) return { weight: 0, success: false };

  const text = cell.textContent?.trim().replace(/\s/g, "") || "";
  if (!text || text === "-" || text === "0") {
    return { weight: 0, success: false };
  }

  const weight = Math.abs(parseNumber(text));

  return { weight, success: weight > 0 && !isFailedAttempt(cell, text) };
}

/**
 * SVNL has marked failed attempts with inline line-through styles, but a
 * styling change would silently flip every failure to a success — so also
 * accept semantic strikethrough tags, strike-ish class names, and the
 * negative-number convention used by some result systems
 */
function isFailedAttempt(cell: Element, text: string): boolean {
  const html = (cell.innerHTML || "").toLowerCase();
  if (html.includes("line-through")) return true;
  if (cell.querySelector("s, del, strike")) return true;
  if ((cell.getAttribute("class") || "").toLowerCase().includes("strike")) {
    return true;
  }
  if (cell.querySelector('[class*="strike"]')) return true;
  if (/^-\d/.test(text)) return true;
  return false;
}

/**
 * Parse a number from text, handling Finnish decimal comma
 */
function parseNumber(text: string | null | undefined): number {
  if (!text) return 0;
  return parseFloat(text.trim().replace(",", ".")) || 0;
}

export function parseBirthYear(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  const match = trimmed.match(/\d{2,4}/);
  if (!match) return 0;
  let year = parseInt(match[0]) || 0;
  if (year >= 0 && year < 100) {
    const pivot = new Date().getFullYear() % 100;
    year += year <= pivot ? 2000 : 1900;
  }
  return year;
}

function detectEventType(lifters: Lifter[]): "sbd" | "b" {
  for (const lifter of lifters) {
    const hasSquat = lifter.squat.some((attempt) => attempt.weight > 0);
    const hasDeadlift = lifter.deadlift.some((attempt) => attempt.weight > 0);
    if (hasSquat || hasDeadlift) {
      return "sbd";
    }
  }
  return "b";
}
