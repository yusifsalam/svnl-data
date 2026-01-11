#!/usr/bin/env bun

import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { Box, render, Text, useApp } from "ink";
import { homedir } from "os";
import { join } from "path";
import { useEffect, useState } from "react";
import { appendLog } from "../log";
import { writeResults, writeResultsPerCompetition } from "../output";
import { discoverCompetitions } from "../scraper";
import type { Competition, CompetitionResult } from "../types";
import { DiscoverView } from "./components/DiscoverView";
import { ListView } from "./components/ListView";
import { MainMenu } from "./components/MainMenu";
import { ScrapeCompleteView } from "./components/ScrapeCompleteView";
import { ScrapeSelectView } from "./components/ScrapeSelectView";
import { ScrapingView } from "./components/ScrapingView";
import { SettingsView } from "./components/SettingsView";
import type { OutputFormat, OutputMode, Screen } from "./types";

const DATA_DIR = join(homedir(), ".svnl-scraper");
const CACHE_FILE = join(DATA_DIR, "competitions.json");
const SETTINGS_FILE = join(DATA_DIR, "settings.json");

function App() {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("menu");
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [scrapeSelection, setScrapeSelection] = useState<Competition[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [forceMode, setForceMode] = useState(false);
  const [outputMode, setOutputMode] = useState<OutputMode>("per-competition");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("csv");
  const [outputDir, setOutputDir] = useState("./output");
  const [logDir, setLogDir] = useState("./logs");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [scrapeStartedAt, setScrapeStartedAt] = useState<number | null>(null);
  const [scrapeResults, setScrapeResults] = useState<CompetitionResult[]>([]);

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
      if (
        data.outputMode === "per-competition" ||
        data.outputMode === "combined"
      ) {
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
              setProgress(
                `Found ${comps.length} competitions! Log: ${logPath}`,
              );
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
          forceMode={forceMode}
          onToggle={(id) => {
            const next = new Set(selectedIds);
            if (next.has(id)) {
              next.delete(id);
            } else {
              next.add(id);
            }
            setSelectedIds(next);
          }}
          onToggleForce={() => setForceMode(!forceMode)}
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
          forceMode={forceMode}
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
                  competitionIds: results.map(
                    (result) => result.competition.id,
                  ),
                  combined: outputMode === "combined",
                  format: outputFormat,
                  outputDir,
                  forced: forceMode,
                  skipped: results.filter((r) => r.metadata?.skipped).length,
                  scraped: results.filter((r) => !r.metadata?.skipped).length,
                },
              },
              logDir,
            );
            setScrapeResults(results);
            setScreen("scrape-complete");
          }}
          onError={(e) => {
            setError(e);
            setScreen("menu");
          }}
        />
      )}

      {screen === "scrape-complete" && (
        <ScrapeCompleteView
          results={scrapeResults}
          progress={progress}
          onBack={() => {
            setSelectedIds(new Set());
            setForceMode(false);
            setScrapeSelection([]);
            setScrapeStartedAt(null);
            setScrapeResults([]);
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

render(<App />);
