import { Box, Text, useInput } from "ink";
import SelectInput from "ink-select-input";
import { useState } from "react";
import type { OutputFormat, OutputMode } from "../types";

export function SettingsView({
  outputMode,
  onChange,
  outputFormat,
  onFormatChange,
  outputDir,
  onOutputDirChange,
  logDir,
  onLogDirChange,
  onBack,
}: {
  outputMode: OutputMode;
  onChange: (mode: OutputMode) => void;
  outputFormat: OutputFormat;
  onFormatChange: (format: OutputFormat) => void;
  outputDir: string;
  onOutputDirChange: (dir: string) => void;
  logDir: string;
  onLogDirChange: (dir: string) => void;
  onBack: () => void;
}) {
  const [editingField, setEditingField] = useState<"output" | "log" | null>(
    null,
  );
  const [dirInput, setDirInput] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      if (editingField) {
        setEditingField(null);
        setDirInput(editingField === "output" ? outputDir : logDir);
      } else {
        onBack();
      }
      return;
    }
    if (!editingField) return;
    if (key.return) {
      let next = dirInput.trim() || ".";
      if (next.startsWith("./Users/")) {
        next = next.slice(1);
      }
      if (next.startsWith("./Volumes/")) {
        next = next.slice(1);
      }
      if (editingField === "output") {
        onOutputDirChange(next);
      } else {
        onLogDirChange(next);
      }
      setEditingField(null);
      return;
    }
    if (key.backspace || key.delete) {
      setDirInput((prev) => prev.slice(0, -1));
      return;
    }
    if (input) {
      setDirInput((prev) => prev + input);
    }
  });

  const items = [
    {
      label: `${outputMode === "per-competition" ? "●" : "○"} Output: per-competition`,
      value: "per-competition",
    },
    {
      label: `${outputMode === "combined" ? "●" : "○"} Output: combined`,
      value: "combined",
    },
    {
      label: `${outputFormat === "csv" ? "●" : "○"} Format: csv`,
      value: "format-csv",
    },
    {
      label: `${outputFormat === "json" ? "●" : "○"} Format: json`,
      value: "format-json",
    },
    {
      label: `Output directory: ${outputDir}`,
      value: "output-dir",
    },
    {
      label: `Log directory: ${logDir}`,
      value: "log-dir",
    },
    { label: "Back", value: "back" },
  ];

  return (
    <Box flexDirection="column">
      <Text bold>Settings</Text>
      <Box marginTop={1}>
        {editingField ? (
          <Box flexDirection="column">
            <Text>
              {editingField === "output" ? "Output" : "Log"} directory (Enter to
              save, Esc to cancel):
            </Text>
            <Text color="gray">
              Current: {editingField === "output" ? outputDir : logDir}
            </Text>
            <Text color="cyan">{dirInput || " "}</Text>
          </Box>
        ) : (
          <SelectInput
            items={items}
            onSelect={(item) => {
              if (item.value === "back") {
                onBack();
              } else if (item.value === "output-dir") {
                setDirInput("");
                setEditingField("output");
              } else if (item.value === "log-dir") {
                setDirInput("");
                setEditingField("log");
              } else if (item.value === "format-csv") {
                onFormatChange("csv");
                onBack();
              } else if (item.value === "format-json") {
                onFormatChange("json");
                onBack();
              } else {
                onChange(item.value as OutputMode);
                onBack();
              }
            }}
          />
        )}
      </Box>
      <Box marginTop={1}>
        <Text color="gray">Escape to go back</Text>
      </Box>
    </Box>
  );
}
