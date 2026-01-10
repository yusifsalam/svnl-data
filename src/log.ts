// Log file writer for operations

import { appendFile, mkdir } from "fs/promises";
import { join, resolve } from "path";

export type LogEntry = {
  timestamp: string;
  operation: string;
  durationMs: number;
  details?: Record<string, unknown>;
};

export async function appendLog(entry: LogEntry, dir: string): Promise<void> {
  const resolvedDir = resolve(dir);
  await mkdir(resolvedDir, { recursive: true });
  const line = JSON.stringify(entry);
  await appendFile(join(resolvedDir, "svnl-log.jsonl"), `${line}\n`, "utf-8");
}
