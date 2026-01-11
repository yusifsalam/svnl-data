import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import { scrapeCompetitions } from "../../scraper";
import type { Competition, CompetitionResult } from "../../types";

export function ScrapingView({
  competitions,
  forceMode,
  progress,
  onProgress,
  onComplete,
  onError,
}: {
  competitions: Competition[];
  forceMode: boolean;
  progress: string;
  onProgress: (msg: string) => void;
  onComplete: (results: CompetitionResult[]) => void;
  onError: (error: string) => void;
}) {
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) {
      setStarted(true);
      scrapeCompetitions(competitions, { onProgress, force: forceMode })
        .then(onComplete)
        .catch((e) => onError(e instanceof Error ? e.message : String(e)));
    }
  }, [started]);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="green">
          <Spinner type="dots" />
        </Text>
        <Text>
          {progress.match(/^(Saving|Saved)/)
            ? " Saving files..."
            : ` Scraping ${competitions.length} competitions...`}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text color="gray">{progress}</Text>
      </Box>
    </Box>
  );
}
