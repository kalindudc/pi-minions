import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import type { AgentTree } from "./tree.js";
import type { DetachHandle } from "./tools/spawn.js";
import { logger } from "./logger.js";

export const MINIONS_STATUS_KEY = "minions-status";

// Hint rotation interval in milliseconds
const HINT_ROTATION_INTERVAL = 4000;

// Static hints (always available)
const STATIC_HINTS = [
  "/minions",
  "/minions list",
];

export interface StatusTracker {
  refresh(): void;
  setUi(ui: ExtensionContext["ui"] | null): void;
  destroy(): void;
}

export function createStatusTracker(
  tree: AgentTree,
  detachHandles: Map<string, DetachHandle>,
): StatusTracker {
  let cachedUi: ExtensionContext["ui"] | null = null;
  let lastBgCount = -1;
  let lastFgCount = -1;
  let currentHintIndex = 0;
  let hintRotationTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Generate dynamic hints based on current minions
   */
  function generateHints(
    bgRunning: { id: string; name: string }[],
    fgRunning: { id: string; name: string }[],
  ): string[] {
    const hints: string[] = [...STATIC_HINTS];

    // Add personalized hints for each foreground minion
    for (const minion of fgRunning) {
      hints.push(`/minions bg ${minion.name}`);
      hints.push(`/minions steer ${minion.name} <message>`);
      hints.push(`/minions show ${minion.name}`);
    }

    // Add hints for background minions (no bg command since already background)
    for (const minion of bgRunning) {
      hints.push(`/minions show ${minion.name}`);
      hints.push(`/minions halt ${minion.name}`);
    }

    return hints;
  }

  /**
   * Get the next hint in rotation
   */
  function getNextHint(hints: string[]): string {
    if (hints.length === 0) return "";
    const hint = hints[currentHintIndex % hints.length];
    return hint;
  }

  /**
   * Start hint rotation timer
   */
  function startHintRotation(): void {
    if (hintRotationTimer) {
      logger.debug("status", "rotation-already-running");
      return;
    }
    logger.debug("status", "rotation-start", { interval: HINT_ROTATION_INTERVAL });
    hintRotationTimer = setInterval(() => {
      currentHintIndex++;
      logger.debug("status", "rotation-tick", { index: currentHintIndex });
      // Trigger a refresh to update the displayed hint
      refresh();
    }, HINT_ROTATION_INTERVAL);
  }

  /**
   * Stop hint rotation timer
   */
  function stopHintRotation(): void {
    if (hintRotationTimer) {
      logger.debug("status", "rotation-stop");
      clearInterval(hintRotationTimer);
      hintRotationTimer = null;
    }
    currentHintIndex = 0;
  }

  /**
   * Format the status line: ⟳ bg: <count>   ·   <hint>
   */
  function formatStatus(
    bgCount: number,
    fgCount: number,
    hint: string,
    theme: Theme,
  ): string {
    const parts: string[] = [];

    // Only show count if there are minions
    if (bgCount > 0 || fgCount > 0) {
      parts.push(`⟳ bg: ${bgCount}`);
    }

    // Add hint with separator
    if (hint) {
      if (parts.length > 0) {
        parts.push(`  ·  ${hint}`);
      } else {
        parts.push(hint);
      }
    }

    return theme.fg("muted", parts.join(""));
  }

  function refresh(): void {
    if (!cachedUi) {
      logger.debug("status", "skip-no-ui");
      return;
    }

    const allRunning = tree.getRunning();

    // Background: no detach handle = already in background
    const bgRunning = allRunning
      .filter((n) => !detachHandles.has(n.id))
      .map((n) => ({ id: n.id, name: n.name }));
    const bgCount = bgRunning.length;

    // Foreground: has detach handle = can be detached to background
    const fgRunning = allRunning
      .filter((n) => detachHandles.has(n.id))
      .map((n) => ({ id: n.id, name: n.name }));
    const fgCount = fgRunning.length;

    // Determine if we need to update
    const hasChanges = bgCount !== lastBgCount || fgCount !== lastFgCount;

    if (hasChanges) {
      logger.debug("status", "update", {
        bgFrom: lastBgCount,
        bgTo: bgCount,
        fgFrom: lastFgCount,
        fgTo: fgCount,
        hasTimer: !!hintRotationTimer,
        allRunning: allRunning.map((n) => `${n.name}(${n.id})`),
        detachHandles: [...detachHandles.keys()],
      });

      lastBgCount = bgCount;
      lastFgCount = fgCount;

      // Manage hint rotation based on total minions
      // Keep rotating as long as there are minions to show hints for
      const totalMinions = bgCount + fgCount;
      if (totalMinions > 0) {
        startHintRotation();
      } else {
        logger.debug("status", "rotation-stop-trigger", { reason: "no-minions" });
        stopHintRotation();
      }
    }

    // Generate hints and get current one
    const hints = generateHints(bgRunning, fgRunning);
    const currentHint = getNextHint(hints);

    // Update status
    const { theme } = cachedUi;
    const totalMinions = bgCount + fgCount;

    if (totalMinions === 0) {
      // Clear status when no minions
      cachedUi.setStatus(MINIONS_STATUS_KEY, undefined);
    } else {
      const statusText = formatStatus(bgCount, fgCount, currentHint, theme);
      cachedUi.setStatus(MINIONS_STATUS_KEY, statusText);
    }
  }

  function setUi(ui: ExtensionContext["ui"] | null): void {
    cachedUi = ui;
  }

  function destroy(): void {
    stopHintRotation();
  }

  return { refresh, setUi, destroy };
}
