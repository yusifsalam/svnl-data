import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { CompetitionResult } from "../../types";

export function ScrapeCompleteView({
  results,
  progress,
  onBack,
}: {
  results: CompetitionResult[];
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

  for (const result of results) {
    const validation = result.metadata?.validation;
    if (validation) {
      totalValidatedLifters += validation.totalLifters;
      totalLiftersWithWarnings += validation.liftersWithWarnings;
      totalWarnings += validation.allWarnings.length;
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

      {totalValidatedLifters > 0 && (
        <Box marginTop={1}>
          {totalLiftersWithWarnings === 0 ? (
            <Text color="green">
              ✓ Validation: {totalValidatedLifters} lifters passed all checks
            </Text>
          ) : (
            <Text color="yellow">
              ⚠ Validation: {totalLiftersWithWarnings}/{totalValidatedLifters}{" "}
              lifters have warnings ({totalWarnings} total)
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
