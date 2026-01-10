#!/usr/bin/env bun

import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { Box, render, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import Spinner from "ink-spinner";
import { homedir } from "os";
import { join } from "path";
import { useEffect, useState } from "react";
import { appendLog } from "./log";
import { writeResults, writeResultsPerCompetition } from "./output";
import { discoverCompetitions, scrapeCompetitions } from "./scraper";
import type { Competition, CompetitionResult } from "./types";

const DATA_DIR = join(homedir(), ".svnl-scraper");
const CACHE_FILE = join(DATA_DIR, "competitions.json");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

type Screen = "menu" | "discover" | "list" | "scrape" | "scraping" | "settings";
type OutputMode = "per-competition" | "combined";
type OutputFormat = "csv" | "json";

function App() {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("menu");
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [scrapeSelection, setScrapeSelection] = useState<Competition[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [outputMode, setOutputMode] = useState<OutputMode>("per-competition");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("csv");
  const [outputDir, setOutputDir] = useState("./output");
  const [logDir, setLogDir] = useState("./logs");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [scrapeStartedAt, setScrapeStartedAt] = useState<number | null>(null);

  // Load cached competitions on start
  useEffect(() => {
    loadCache();
    loadSettings();
  }, []);

  async function loadCache() {
    if (existsSync(CACHE_FILE)) {
      const data = JSON.parse(await readFile(CACHE_FILE, "utf-8"));
      setCompetitions(data);
    }
  }

  async function saveCache(comps: Competition[]) {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify(comps, null, 2));
  }

  async function loadSettings() {
    if (existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(await readFile(SETTINGS_FILE, "utf-8"));
      if (data.outputMode === "per-competition" || data.outputMode === "combined") {
        setOutputMode(data.outputMode);
      }
      if (data.outputFormat === "csv" || data.outputFormat === "json") {
        setOutputFormat(data.outputFormat);
      }
      if (typeof data.outputDir === "string" && data.outputDir.trim()) {
        setOutputDir(data.outputDir);
      }
      if (typeof data.logDir === "string" && data.logDir.trim()) {
        setLogDir(data.logDir);
      }
    }
    setSettingsLoaded(true);
  }

  async function saveSettings() {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(
      SETTINGS_FILE,
      JSON.stringify({ outputMode, outputFormat, outputDir, logDir }, null, 2),
    );
  }

  useEffect(() => {
    if (!settingsLoaded) return;
    saveSettings();
  }, [outputMode, outputFormat, outputDir, logDir, settingsLoaded]);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          SVNL Scraper
        </Text>
        <Text color="gray"> - {competitions.length} competitions cached</Text>
      </Box>

      {error && (
        <Box marginBottom={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}

      {screen === "menu" && (
        <MainMenu
          onSelect={(action) => {
            setError("");
            if (action === "exit") {
              exit();
            } else {
              setScreen(action as Screen);
            }
          }}
        />
      )}

      {screen === "discover" && (
        <DiscoverView
          progress={progress}
          onStart={async () => {
            setProgress("Starting discovery...");
            try {
              const startedAt = Date.now();
              const comps = await discoverCompetitions({
                loadMoreClicks: 5,
                onProgress: setProgress,
              });
              setCompetitions(comps);
              await saveCache(comps);
              const logPath = join(logDir, "svnl-log.jsonl");
              await appendLog(
                {
                  timestamp: new Date().toISOString(),
                  operation: "discover",
                  durationMs: Date.now() - startedAt,
                  details: { competitions: comps.length },
                },
                logDir,
              );
              setProgress(`Found ${comps.length} competitions! Log: ${logPath}`);
              setTimeout(() => setScreen("menu"), 2000);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              setScreen("menu");
            }
          }}
          onBack={() => setScreen("menu")}
        />
      )}

      {screen === "list" && (
        <ListView
          competitions={competitions}
          onBack={() => setScreen("menu")}
        />
      )}

      {screen === "scrape" && (
        <ScrapeSelectView
          competitions={competitions}
          selectedIds={selectedIds}
          onToggle={(id) => {
            const next = new Set(selectedIds);
            if (next.has(id)) {
              next.delete(id);
            } else {
              next.add(id);
            }
            setSelectedIds(next);
          }}
          onStart={() => {
            const selected = competitions.filter((c) => selectedIds.has(c.id));
            setScrapeSelection(selected);
            setScrapeStartedAt(Date.now());
            setScreen("scraping");
          }}
          onBack={() => setScreen("menu")}
        />
      )}

      {screen === "scraping" && (
        <ScrapingView
          competitions={scrapeSelection}
          progress={progress}
          onProgress={setProgress}
          onComplete={async (results) => {
            const startedAt = scrapeStartedAt ?? Date.now();
            const logPath = join(logDir, "svnl-log.jsonl");
            if (outputMode === "combined") {
              setProgress("Saving file...");
              const path = join(
                outputDir,
                `results_${Date.now()}.${outputFormat}`,
              );
              await writeResults(results, path, outputFormat);
              setProgress(`Saved to ${path} | Log: ${logPath}`);
            } else {
              setProgress("Saving files...");
              const outputPaths = await writeResultsPerCompetition(
                results,
                outputDir,
                outputFormat,
              );
              setProgress(
                `Saved ${outputPaths.length} files to ${outputDir} | Log: ${logPath}`,
              );
            }
            await appendLog(
              {
                timestamp: new Date().toISOString(),
                operation: "scrape",
                durationMs: Date.now() - startedAt,
              details: {
                competitions: results.length,
                lifters: results.reduce(
                  (sum, r) => sum + r.lifters.length,
                  0,
                ),
                competitionIds: results.map((result) => result.competition.id),
                combined: outputMode === "combined",
                format: outputFormat,
                outputDir,
              },
            },
            logDir,
          );
            setSelectedIds(new Set());
            setTimeout(() => {
              setScrapeSelection([]);
              setScrapeStartedAt(null);
              setScreen("menu");
            }, 3000);
          }}
          onError={(e) => {
            setError(e);
            setScreen("menu");
          }}
        />
      )}

      {screen === "settings" && (
        <SettingsView
          outputMode={outputMode}
          onChange={(mode) => setOutputMode(mode)}
          outputFormat={outputFormat}
          onFormatChange={(format) => setOutputFormat(format)}
          outputDir={outputDir}
          onOutputDirChange={(dir) => setOutputDir(dir)}
          logDir={logDir}
          onLogDirChange={(dir) => setLogDir(dir)}
          onBack={() => setScreen("menu")}
        />
      )}
    </Box>
  );
}

// ============ MAIN MENU ============

function MainMenu({ onSelect }: { onSelect: (action: string) => void }) {
  const items = [
    { label: "Discover competitions", value: "discover" },
    { label: "List competitions", value: "list" },
    { label: "Scrape competitions", value: "scrape" },
    { label: "Settings", value: "settings" },
    { label: "Exit", value: "exit" },
  ];

  return (
    <Box flexDirection="column">
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Box marginTop={1}>
        <Text color="gray">Use arrow keys to navigate, Enter to select</Text>
      </Box>
    </Box>
  );
}

// ============ SETTINGS VIEW ============

function SettingsView({
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

// ============ DISCOVER VIEW ============

function DiscoverView({
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

// ============ LIST VIEW ============

function ListView({
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

// ============ SCRAPE SELECT VIEW ============

function ScrapeSelectView({
  competitions,
  selectedIds,
  onToggle,
  onStart,
  onBack,
}: {
  competitions: Competition[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
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
          Space to toggle, Enter to start, ←/→ pages, Escape to cancel
        </Text>
      </Box>
    </Box>
  );
}

// ============ SCRAPING VIEW ============

function ScrapingView({
  competitions,
  progress,
  onProgress,
  onComplete,
  onError,
}: {
  competitions: Competition[];
  progress: string;
  onProgress: (msg: string) => void;
  onComplete: (results: CompetitionResult[]) => void;
  onError: (error: string) => void;
}) {
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) {
      setStarted(true);
      scrapeCompetitions(competitions, { onProgress })
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

// ============ RENDER ============

render(<App />);
