import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { useState } from "react";

export function DiscoverView({
  progress,
  onStart,
  onBack,
}: {
  progress: string;
  onStart: () => void;
  onBack: () => void;
}) {
  const [started, setStarted] = useState(false);

  useInput((input, key) => {
    if (key.escape) onBack();
    if (input === "s" && !started) {
      setStarted(true);
      onStart();
    }
  });

  if (started) {
    return (
      <Box flexDirection="column">
        <Box>
          <Text color="green">
            <Spinner type="dots" />
          </Text>
          <Text> {progress}</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>Press 's' to start discovery, Escape to go back</Text>
    </Box>
  );
}
