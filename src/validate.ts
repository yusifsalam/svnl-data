import type { Attempt, CompetitionResult, Lifter } from "./types";

export interface ValidationWarning {
  severity: "warning";
  rule: string;
  message: string;
  lifterName?: string;
  competitionId?: string;
  details?: Record<string, unknown>;
}

export interface ValidationSummary {
  totalLifters: number;
  liftersWithWarnings: number;
  warningsByRule: Record<string, number>;
  allWarnings: ValidationWarning[];
}

export function validateCompetitionResult(
  result: CompetitionResult,
): ValidationSummary {
  const warnings: ValidationWarning[] = [];
  let liftersWithWarnings = 0;

  const eventType = result.competition.eventType || "sbd";

  for (const lifter of result.lifters) {
    const lifterWarnings = validateLifter(
      lifter,
      result.competition.id,
      eventType,
    );
    if (lifterWarnings.length > 0) {
      liftersWithWarnings++;
      warnings.push(...lifterWarnings);
    }
  }

  const warningsByRule: Record<string, number> = {};
  for (const warning of warnings) {
    warningsByRule[warning.rule] = (warningsByRule[warning.rule] || 0) + 1;
  }

  return {
    totalLifters: result.lifters.length,
    liftersWithWarnings,
    warningsByRule,
    allWarnings: warnings,
  };
}

export function validateLifter(
  lifter: Lifter,
  competitionId: string,
  eventType: "sbd" | "b",
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  const totalWarning = validateTotalCalculation(lifter, eventType);
  if (totalWarning) {
    totalWarning.competitionId = competitionId;
    warnings.push(totalWarning);
  }

  const completenessWarnings = validateDataCompleteness(lifter);
  for (const warning of completenessWarnings) {
    warning.competitionId = competitionId;
    warnings.push(warning);
  }

  const rangeWarnings = validateReasonableRanges(lifter);
  for (const warning of rangeWarnings) {
    warning.competitionId = competitionId;
    warnings.push(warning);
  }

  const progressionWarnings = validateAttemptProgression(lifter);
  for (const warning of progressionWarnings) {
    warning.competitionId = competitionId;
    warnings.push(warning);
  }

  return warnings;
}

function validateTotalCalculation(
  lifter: Lifter,
  eventType: "sbd" | "b",
): ValidationWarning | null {
  if (lifter.total === 0) {
    return null;
  }

  const bestSquat = eventType === "sbd" ? getBestLift(lifter.squat) : 0;
  const bestBench = getBestLift(lifter.bench);
  const bestDeadlift = eventType === "sbd" ? getBestLift(lifter.deadlift) : 0;

  const calculated = bestSquat + bestBench + bestDeadlift;

  if (calculated !== lifter.total) {
    const details: Record<string, unknown> = {
      calculated,
      recorded: lifter.total,
      eventType,
    };

    let message: string;
    if (eventType === "b") {
      message = `Total mismatch: calculated ${calculated}kg (bench only), recorded ${lifter.total}kg`;
    } else {
      message = `Total mismatch: calculated ${calculated}kg (S:${bestSquat} + B:${bestBench} + D:${bestDeadlift}), recorded ${lifter.total}kg`;
      details.bestSquat = bestSquat;
      details.bestBench = bestBench;
      details.bestDeadlift = bestDeadlift;
    }

    return {
      severity: "warning",
      rule: "total_calculation",
      message,
      lifterName: lifter.name,
      details,
    };
  }

  return null;
}

function validateDataCompleteness(lifter: Lifter): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (!lifter.name || lifter.name.trim() === "") {
    warnings.push({
      severity: "warning",
      rule: "data_completeness",
      message: "Missing name",
      lifterName: lifter.name || "(empty)",
      details: { field: "name" },
    });
  }

  if (!lifter.club || lifter.club.trim() === "") {
    warnings.push({
      severity: "warning",
      rule: "data_completeness",
      message: "Missing club",
      lifterName: lifter.name,
      details: { field: "club" },
    });
  }

  return warnings;
}

function validateReasonableRanges(lifter: Lifter): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  const allAttempts = [...lifter.squat, ...lifter.bench, ...lifter.deadlift];
  const seenWeights = new Set<number>();

  for (const attempt of allAttempts) {
    if (attempt.weight > 0 && !seenWeights.has(attempt.weight)) {
      seenWeights.add(attempt.weight);
      if (attempt.weight < 20 || attempt.weight > 500) {
        warnings.push({
          severity: "warning",
          rule: "reasonable_ranges",
          message: `Unusual lift weight: ${attempt.weight}kg (expected 20-500kg)`,
          lifterName: lifter.name,
          details: { weight: attempt.weight, min: 20, max: 500 },
        });
      }
    }
  }

  if (
    lifter.bodyWeight > 0 &&
    (lifter.bodyWeight < 30 || lifter.bodyWeight > 200)
  ) {
    warnings.push({
      severity: "warning",
      rule: "reasonable_ranges",
      message: `Unusual body weight: ${lifter.bodyWeight}kg (expected 30-200kg)`,
      lifterName: lifter.name,
      details: { bodyWeight: lifter.bodyWeight, min: 30, max: 200 },
    });
  }

  return warnings;
}

function validateAttemptProgression(lifter: Lifter): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  function checkLiftProgression(
    attempts: [Attempt, Attempt, Attempt],
    liftName: string,
  ): void {
    const successfulAttempts = attempts
      .map((a, idx) => ({ ...a, attemptNum: idx + 1 }))
      .filter((a) => a.success && a.weight > 0);

    for (let i = 1; i < successfulAttempts.length; i++) {
      const prev = successfulAttempts[i - 1];
      const curr = successfulAttempts[i];

      if (curr.weight < prev.weight) {
        warnings.push({
          severity: "warning",
          rule: "attempt_progression",
          message: `${liftName} attempt ${curr.attemptNum} (${curr.weight}kg) is less than attempt ${prev.attemptNum} (${prev.weight}kg)`,
          lifterName: lifter.name,
          details: {
            lift: liftName,
            attempt1: prev.attemptNum,
            weight1: prev.weight,
            attempt2: curr.attemptNum,
            weight2: curr.weight,
          },
        });
      }
    }
  }

  checkLiftProgression(lifter.squat, "Squat");
  checkLiftProgression(lifter.bench, "Bench");
  checkLiftProgression(lifter.deadlift, "Deadlift");

  return warnings;
}

function getBestLift(attempts: [Attempt, Attempt, Attempt]): number {
  return Math.max(...attempts.filter((a) => a.success).map((a) => a.weight), 0);
}
