import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = join("/tmp", "logs", "pi-minions");
export const LOG_FILE = join(LOG_DIR, "debug.log");

// Ensure directory exists at module load time
try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

const val = process.env["PI_MINIONS_DEBUG"];
const debugEnabled = val === "1" || val === "true";

function write(level: string, scope: string, msg: string, data?: unknown): void {
  const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const suffix = data !== undefined ? " " + JSON.stringify(data) : "";
  const line = `[${ts}] [${level}] [${scope}] ${msg}${suffix}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {
    // never throw from a logger
  }
}

export const logger = {
  debug(scope: string, msg: string, data?: unknown): void {
    if (!debugEnabled) return;
    write("DEBUG", scope, msg, data);
  },
  info(scope: string, msg: string, data?: unknown): void {
    write("INFO", scope, msg, data);
  },
  warn(scope: string, msg: string, data?: unknown): void {
    write("WARN", scope, msg, data);
  },
  error(scope: string, msg: string, data?: unknown): void {
    write("ERROR", scope, msg, data);
  },
};
