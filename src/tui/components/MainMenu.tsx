import { Box, Text } from "ink";
import SelectInput from "ink-select-input";

const items = [
  { label: "Discover competitions", value: "discover" },
  { label: "List competitions", value: "list" },
  { label: "Scrape competitions", value: "scrape" },
  { label: "Settings", value: "settings" },
  { label: "Exit", value: "exit" },
];

export function MainMenu({ onSelect }: { onSelect: (action: string) => void }) {
  return (
    <Box flexDirection="column">
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Box marginTop={1}>
        <Text color="gray">Use arrow keys to navigate, Enter to select</Text>
      </Box>
    </Box>
  );
}
