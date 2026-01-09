// CSV and JSON output generation

import { mkdir, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import type { Attempt, CompetitionResult } from "./types";

/**
 * Convert results to CSV string
 */
export function toCSV(results: CompetitionResult[]): string {
  const headers = [
    "competition_id",
    "competition_name",
    "competition_date",
    "competition_start_date",
    "competition_end_date",
    "event_type",
    "position",
    "name",
    "birth_year",
    "gender",
    "age_class",
    "equipment",
    "weight_class",
    "body_weight",
    "club",
    "squat_1",
    "squat_1_success",
    "squat_2",
    "squat_2_success",
    "squat_3",
    "squat_3_success",
    "bench_1",
    "bench_1_success",
    "bench_2",
    "bench_2_success",
    "bench_3",
    "bench_3_success",
    "deadlift_1",
    "deadlift_1_success",
    "deadlift_2",
    "deadlift_2_success",
    "deadlift_3",
    "deadlift_3_success",
    "total",
    "points",
  ];

  const rows: string[] = [headers.join(",")];

  for (const result of results) {
    for (const lifter of result.lifters) {
      const row = [
        escape(result.competition.id),
        escape(result.competition.name),
        escape(result.competition.date),
        escape(result.competition.startDate || ""),
        escape(result.competition.endDate || ""),
        escape(result.competition.eventType || ""),
        lifter.position,
        escape(lifter.name),
        lifter.birthYear,
        lifter.gender,
        escape(lifter.ageClass || ""),
        lifter.equipment,
        escape(lifter.weightClass),
        lifter.bodyWeight,
        escape(lifter.club),
        ...attemptColumns(lifter.squat),
        ...attemptColumns(lifter.bench),
        ...attemptColumns(lifter.deadlift),
        lifter.total,
        lifter.points,
      ];
      rows.push(row.join(","));
    }
  }

  return rows.join("\n");
}

/**
 * Convert results to JSON string
 */
export function toJSON(results: CompetitionResult[]): string {
  return JSON.stringify(results, null, 2);
}

/**
 * Write results to file
 */
export async function writeResults(
  results: CompetitionResult[],
  path: string,
  format: "csv" | "json",
): Promise<void> {
  const content = format === "csv" ? toCSV(results) : toJSON(results);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf-8");
}

export async function writeResultsPerCompetition(
  results: CompetitionResult[],
  outputDir: string,
  format: "csv" | "json",
): Promise<string[]> {
  const paths: string[] = [];
  const resolvedDir = resolve(outputDir);
  await mkdir(resolvedDir, { recursive: true });

  for (const result of results) {
    const filename = `${sanitizeFilename(result.competition.id)}.${format}`;
    const filePath = join(resolvedDir, filename);
    await writeResults([result], filePath, format);
    paths.push(filePath);
  }

  return paths;
}

// Helper functions

function escape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

function attemptColumns(
  attempts: [Attempt, Attempt, Attempt],
): (number | boolean)[] {
  return [
    attempts[0].weight,
    attempts[0].success,
    attempts[1].weight,
    attempts[1].success,
    attempts[2].weight,
    attempts[2].success,
  ];
}
