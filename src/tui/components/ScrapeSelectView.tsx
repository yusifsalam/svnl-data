import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { Competition } from "../../cli/types";

export function ScrapeSelectView({
  competitions,
  selectedIds,
  forceMode,
  onToggle,
  onToggleForce,
  onStart,
  onBack,
}: {
  competitions: Competition[];
  selectedIds: Set<string>;
  forceMode: boolean;
  onToggle: (id: string) => void;
  onToggleForce: () => void;
  onStart: () => void;
  onBack: () => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const totalPages = Math.ceil(competitions.length / pageSize);

  useInput((input, key) => {
    if (key.escape) onBack();
    if (key.upArrow && cursor > 0) setCursor(cursor - 1);
    if (
      key.downArrow &&
      cursor < Math.min(pageSize - 1, competitions.length - page * pageSize - 1)
    ) {
      setCursor(cursor + 1);
    }
    if (key.leftArrow && page > 0) {
      setPage(page - 1);
      setCursor(0);
    }
    if (key.rightArrow && page < totalPages - 1) {
      setPage(page + 1);
      setCursor(0);
    }
    if (input === " ") {
      const idx = page * pageSize + cursor;
      if (idx < competitions.length) {
        onToggle(competitions[idx].id);
      }
    }
    if (input === "f") {
      onToggleForce();
    }
    if (key.return && selectedIds.size > 0) {
      onStart();
    }
  });

  const start = page * pageSize;
  const visible = competitions.slice(start, start + pageSize);

  return (
    <Box flexDirection="column">
      <Text bold>
        Select competitions to scrape ({selectedIds.size} selected)
      </Text>
      <Box marginTop={1}>
        <Text>
          Force mode:{" "}
          {forceMode ? (
            <Text color="yellow">ON</Text>
          ) : (
            <Text color="gray">OFF</Text>
          )}
        </Text>
        <Text color="gray"> (bypass cache)</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {visible.map((comp, i) => {
          const isSelected = selectedIds.has(comp.id);
          const isCursor = i === cursor;
          return (
            <Box key={comp.id}>
              <Text color={isCursor ? "cyan" : undefined}>
                {isCursor ? ">" : " "} [{isSelected ? "x" : " "}]{" "}
              </Text>
              <Text
                color={comp.category === "nationals" ? "yellow" : undefined}
              >
                {comp.name || comp.id}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">
          Space to toggle, F for force mode, Enter to start, ←/→ pages, Esc to
          cancel
        </Text>
      </Box>
    </Box>
  );
}
