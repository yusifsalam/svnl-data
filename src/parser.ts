import { parseHTML } from "linkedom";
import type { Attempt, Competition, CompetitionResult, Lifter } from "./types";

/**
 * Parse a competition page HTML into structured data
 */
export function parseCompetitionPage(
  html: string,
  competition: Competition,
): CompetitionResult[] {
  const { document } = parseHTML(html);

  const parsedCompetition = parseEventInfo(document, competition);
  let lifters = parseLifters(document);

  const competitionNameLower = parsedCompetition.name.toLowerCase();
  if (competitionNameLower.includes("varuste")) {
    lifters = lifters.map((lifter) => ({ ...lifter, equipment: "equipped" }));
  }

  const eventType = detectEventType(lifters);

  const byEquipment = new Map<"raw" | "equipped", Lifter[]>();
  for (const lifter of lifters) {
    const list = byEquipment.get(lifter.equipment) || [];
    list.push(lifter);
    byEquipment.set(lifter.equipment, list);
  }

  if (byEquipment.size <= 1) {
    return [{ competition: { ...parsedCompetition, eventType }, lifters }];
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

  return results;
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
      } else if (parts.length >= 3) {
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

function parseDateRange(dateText: string): {
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
 * Parse all lifters from results tables
 */
function parseLifters(doc: Document): Lifter[] {
  const lifters: Lifter[] = [];
  const tables = doc.querySelectorAll("table");

  for (const table of tables) {
    // Find header rows to determine column layout
    const rows = Array.from(table.querySelectorAll("tr"));

    // Look for the row containing "Nimi" and "Seura" to identify this as a results table
    let headerRowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const text = rows[i].textContent?.toLowerCase() || "";
      if (text.includes("nimi") && text.includes("seura")) {
        headerRowIndex = i;
        break;
      }
    }

    if (headerRowIndex === -1) continue;

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
    const columnMap = detectColumnMap(rows[headerRowIndex], subHeaderRow);
    const dataStartIndex = subHeaderRow
      ? headerRowIndex + 2
      : headerRowIndex + 1;

    const genderInfo = findGenderMarkers(rows);
    const hasGenderColumn = columnMap.gender !== undefined;
    let defaultGender: "M" | "F" | null = null;
    let currentGender = findGenderBeforeIndex(rows, dataStartIndex);
    let currentAgeClassHeader = findAgeClassBeforeIndex(
      rows,
      dataStartIndex,
      columnMap,
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
            columnMap,
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
      const ageClassFromRow = extractAgeClassFromText(rowText);
      if (ageClassFromRow && isAgeClassHeaderRow(row, rowText, columnMap)) {
        currentAgeClassHeader = ageClassFromRow;
        currentGender = ageClassFromRow.startsWith("N") ? "F" : "M";
        continue;
      }

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

      const minRequiredIndex = Math.max(
        nameIndex,
        clubIndex,
        positionIndex,
        genderIndex ?? -1,
        weightClassIndex,
        bodyWeightIndex,
      );
      if (cells.length <= minRequiredIndex) continue;

      const nonEmptyCells = cells.filter((cell) => {
        const text = (cell.textContent || "").trim();
        return text && text !== "-";
      });
      if (nonEmptyCells.length === 1) {
        const rowText = (row.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        const equipmentFromLabel = extractEquipmentLabel(rowText);
        if (equipmentFromLabel) {
          currentEquipment = equipmentFromLabel;
          continue;
        }
        const genderFromLabel = extractGenderLabel(rowText);
        if (genderFromLabel) {
          currentGender = genderFromLabel;
          const headerAgeClass = extractAgeClassFromText(rowText);
          if (headerAgeClass) {
            currentAgeClassHeader = headerAgeClass;
          }
          continue;
        }
        if (rowText === "naiset" || rowText === "women") {
          currentGender = "F";
          continue;
        }
        if (rowText === "miehet" || rowText === "men") {
          currentGender = "M";
          continue;
        }
      }

      // Get name from column
      const nameText = cells[nameIndex]?.textContent?.trim() || "";

      // Skip empty names or division/gender headers
      if (!nameText) continue;
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

      // Skip if no valid position (likely not a lifter row)
      if (position === 0 && !positionText.match(/^\d/)) continue;

      // Parse gender from column 1, fallback to section header
      const genderText =
        genderIndex !== undefined
          ? cells[genderIndex]?.textContent?.trim().toUpperCase() || ""
          : "";
      let gender: "M" | "F";
      if (genderText.startsWith("N")) {
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
  }

  return lifters;
}

type ColumnMap = {
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

function detectColumnMap(row: Element, subHeaderRow?: Element): ColumnMap {
  const headerTexts = Array.from(row.querySelectorAll("th, td")).map((cell) =>
    (cell.textContent || "").trim().toLowerCase(),
  );
  const subHeaderTexts = subHeaderRow
    ? Array.from(subHeaderRow.querySelectorAll("th, td")).map((cell) =>
        (cell.textContent || "").trim().toLowerCase(),
      )
    : null;

  const columnMap: ColumnMap = {};

  headerTexts.forEach((text, index) => {
    if (text.includes("sij")) columnMap.position = index;
    if (text.includes("m/n") || text.includes("sukupuoli"))
      columnMap.gender = index;
    if (text.includes("sarja")) columnMap.weightClass = index;
    if (text.includes("paino") && !text.includes("kk"))
      columnMap.bodyWeight = index;
    if (text.includes("nimi")) columnMap.name = index;
    if (text === "sv" || text.includes("syntymävuosi")) {
      columnMap.birthYear = index;
    }
    if (text.includes("seura")) columnMap.club = index;

    if (text.includes("jalkakyykky") || text.startsWith("jk")) {
      if (columnMap.squatStart === undefined) {
        columnMap.squatStart = numberedAttemptStart(headerTexts, index);
      }
    }

    if (text.includes("penkkipunnerrus") || text.startsWith("pp")) {
      if (columnMap.benchStart === undefined) {
        columnMap.benchStart = numberedAttemptStart(headerTexts, index);
      }
    }

    if (text.includes("maastanosto") || text.startsWith("mn")) {
      if (columnMap.deadliftStart === undefined) {
        columnMap.deadliftStart = numberedAttemptStart(headerTexts, index);
      }
    }

    if (text.includes("yhteistulos") || text.includes("tulos")) {
      columnMap.total = index;
    }
    if (text.includes("ipf") && text.includes("gl")) columnMap.points = index;
  });

  if (subHeaderTexts) {
    const squatHeaderIndex = headerTexts.findIndex(
      (text) => text.includes("jalkakyykky") || text.startsWith("jk"),
    );
    const benchHeaderIndex = headerTexts.findIndex(
      (text) => text.includes("penkkipunnerrus") || text.startsWith("pp"),
    );
    const deadliftHeaderIndex = headerTexts.findIndex(
      (text) => text.includes("maastanosto") || text.startsWith("mn"),
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
        text.includes("ipf") || text.includes("gl") || text.includes("pisteet"),
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
          break;
        }
      }
    }
  }

  const hasSquatHeader = headerTexts.some((text) =>
    text.includes("jalkakyykky"),
  );
  const hasDeadliftHeader = headerTexts.some((text) =>
    text.includes("maastanosto"),
  );
  const hasBenchHeader = headerTexts.some((text) =>
    text.includes("penkkipunnerrus"),
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
        text.startsWith("mn"),
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
  if (trimmed.includes("varuste")) {
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

function extractAgeClassFromText(text: string): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim().toUpperCase();
  const match = trimmed.match(/([NM](?:14|18|23|40|50|60|70))/);
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
function parseAttempt(cell: Element | undefined): Attempt {
  if (!cell) return { weight: 0, success: false };

  const text = cell.textContent?.trim().replace(/\s/g, "") || "";
  if (!text || text === "-" || text === "0") {
    return { weight: 0, success: false };
  }

  const weight = Math.abs(parseNumber(text));

  // Failed attempts have strikethrough styling
  const hasStrikethrough = cell.innerHTML?.includes("line-through") || false;

  return { weight, success: weight > 0 && !hasStrikethrough };
}

/**
 * Parse a number from text, handling Finnish decimal comma
 */
function parseNumber(text: string | null | undefined): number {
  if (!text) return 0;
  return parseFloat(text.trim().replace(",", ".")) || 0;
}

function parseBirthYear(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  const match = trimmed.match(/\d{2,4}/);
  if (!match) return 0;
  let year = parseInt(match[0]) || 0;
  if (year >= 0 && year < 100) {
    year += year <= 25 ? 2000 : 1900;
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
