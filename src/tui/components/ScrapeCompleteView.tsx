import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { CompetitionResult } from "../../cli/types";

export function ScrapeCompleteView({
  results,
  failedCount,
  progress,
  onBack,
}: {
  results: CompetitionResult[];
  failedCount: number;
  progress: string;
  onBack: () => void;
}) {
  const [showSummary, setShowSummary] = useState(false);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    }
    if (input === "s") {
      setShowSummary(!showSummary);
    }
  });

  const totalLifters = results.reduce((sum, r) => sum + r.lifters.length, 0);
  let totalValidatedLifters = 0;
  let totalLiftersWithWarnings = 0;
  let totalWarnings = 0;
  let totalErrors = 0;
  const parseProblems: string[] = [];
  const seenCompetitions = new Set<string>();

  for (const result of results) {
    const validation = result.metadata?.validation;
    if (validation) {
      totalValidatedLifters += validation.totalLifters;
      totalLiftersWithWarnings += validation.liftersWithWarnings;
      totalWarnings += validation.allWarnings.length;
      totalErrors += validation.allWarnings.filter(
        (w) => w.severity === "error",
      ).length;
    }

    const report = result.metadata?.parseReport;
    const competitionId =
      result.metadata?.competitionId || result.competition.id;
    if (
      report &&
      report.confidence !== "ok" &&
      !seenCompetitions.has(competitionId)
    ) {
      seenCompetitions.add(competitionId);
      parseProblems.push(
        `${competitionId}: parse confidence ${report.confidence}`,
      );
    }
  }

  return (
    <Box flexDirection="column">
      <Text bold color="green">
        ✓ Scrape Complete
      </Text>
      <Box marginTop={1}>
        <Text color="gray">{progress}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>
          Scraped {results.length} competitions ({totalLifters} lifters)
        </Text>
      </Box>

      {failedCount > 0 && (
        <Box marginTop={1}>
          <Text color="red">
            ✗ {failedCount} competition{failedCount === 1 ? "" : "s"} failed to
            scrape (see log above)
          </Text>
        </Box>
      )}

      {parseProblems.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          {parseProblems.map((problem) => (
            <Text key={problem} color="red">
              ✗ {problem} — raw HTML in ~/.svnl-scraper/debug/
            </Text>
          ))}
        </Box>
      )}

      {totalValidatedLifters > 0 && (
        <Box marginTop={1}>
          {totalWarnings === 0 ? (
            <Text color="green">
              ✓ Validation: {totalValidatedLifters} lifters passed all checks
            </Text>
          ) : (
            <Text color={totalErrors > 0 ? "red" : "yellow"}>
              ⚠ Validation: {totalLiftersWithWarnings}/{totalValidatedLifters}{" "}
              lifters have warnings ({totalWarnings} total
              {totalErrors > 0 ? `, ${totalErrors} errors` : ""})
            </Text>
          )}
        </Box>
      )}

      {showSummary && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>
            {totalWarnings > 0 ? "Validation Details:" : "Details:"}
          </Text>
          {results.map((result) => {
            const validation = result.metadata?.validation;
            const skipped = result.metadata?.skipped || false;
            const lifterCount = result.lifters.length;
            const warningCount = validation?.allWarnings.length || 0;

            return (
              <Box
                key={result.competition.id}
                flexDirection="column"
                marginTop={1}
              >
                <Text color={warningCount > 0 ? "yellow" : "green"}>
                  {result.competition.name}:
                </Text>
                <Text color="gray">
                  {"  "}• {lifterCount} lifters
                  {skipped ? " (cached)" : " (scraped)"}
                </Text>
                {validation && (
                  <Text color="gray">
                    {"  "}•{" "}
                    {warningCount === 0
                      ? "All validation checks passed"
                      : `${warningCount} validation warning${warningCount === 1 ? "" : "s"}`}
                  </Text>
                )}
                {warningCount > 0 &&
                  validation?.allWarnings.slice(0, 3).map((warning, i) => (
                    <Text key={i} color="gray">
                      {"    "}- {warning.message}
                    </Text>
                  ))}
                {warningCount > 3 && (
                  <Text color="gray">
                    {"    "}... and {warningCount - 3} more
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          Press 's' to {showSummary ? "hide" : "show"} summary, Escape to return
          to menu
        </Text>
      </Box>
    </Box>
  );
}
