import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { Competition } from "../../cli/types";

export function ListView({
  competitions,
  onBack,
}: {
  competitions: Competition[];
  onBack: () => void;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const totalPages = Math.ceil(competitions.length / pageSize);

  useInput((input, key) => {
    if (key.escape) onBack();
    if (key.leftArrow && page > 0) setPage(page - 1);
    if (key.rightArrow && page < totalPages - 1) setPage(page + 1);
  });

  const start = page * pageSize;
  const visible = competitions.slice(start, start + pageSize);

  return (
    <Box flexDirection="column">
      {visible.map((comp) => (
        <Box key={comp.id}>
          <Text color={comp.category === "nationals" ? "yellow" : "white"}>
            {comp.category === "nationals" ? "[SM] " : "     "}
          </Text>
          <Text>{comp.name || comp.id}</Text>
          <Text color="gray"> - {comp.date}</Text>
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color="gray">
          Page {page + 1}/{totalPages} | ←/→ to navigate, Escape to go back
        </Text>
      </Box>
    </Box>
  );
}
