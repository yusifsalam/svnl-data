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
  loadMoreClicks,
  onLoadMoreClicksChange,
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
  loadMoreClicks: number;
  onLoadMoreClicksChange: (n: number) => void;
  onBack: () => void;
}) {
  const [editingField, setEditingField] = useState<
    "output" | "log" | "clicks" | null
  >(null);
  const [dirInput, setDirInput] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      if (editingField) {
        setEditingField(null);
      } else {
        onBack();
      }
      return;
    }
    if (!editingField) return;
    if (key.return) {
      if (editingField === "clicks") {
        const n = parseInt(dirInput.trim(), 10);
        onLoadMoreClicksChange(Number.isInteger(n) && n >= 0 ? n : 0);
        setEditingField(null);
        return;
      }
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
      const accepted =
        editingField === "clicks" ? input.replace(/[^0-9]/g, "") : input;
      if (accepted) setDirInput((prev) => prev + accepted);
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
    {
      label: `Load more clicks per section: ${loadMoreClicks}`,
      value: "clicks",
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
              {editingField === "clicks"
                ? "Load more clicks per section"
                : `${editingField === "output" ? "Output" : "Log"} directory`}{" "}
              (Enter to save, Esc to cancel):
            </Text>
            <Text color="gray">
              Current:{" "}
              {editingField === "clicks"
                ? loadMoreClicks
                : editingField === "output"
                  ? outputDir
                  : logDir}
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
              } else if (item.value === "clicks") {
                setDirInput(String(loadMoreClicks));
                setEditingField("clicks");
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
