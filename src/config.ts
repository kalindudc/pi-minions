import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

export interface PiMinionsConfig {
  /** Custom minion names (defaults to built-in pool) */
  minionNames?: string[];
  /** Allow spawning ephemeral (unnamed) minions (default: true) */
  allowEphemeral?: boolean;
  /** Delegation behavior settings */
  delegation?: DelegationConfig;
  /** Display/rendering settings */
  display?: DisplayConfig;
  /** Tool synchronization settings for minion sessions */
  toolSync?: ToolSyncConfig;
  /** Interaction forwarding settings */
  interaction?: InteractionConfig;
}

export interface DelegationConfig {
  /** Enable delegation reminders (default: true) */
  enabled?: boolean;
  /** Tool calls before showing delegation hint (default: 8) */
  toolCallThreshold?: number;
  /** Minutes between delegation hints (default: 8) */
  hintIntervalMinutes?: number;
}

export interface ToolSyncConfig {
  /** Wait for parent tools to register in minion sessions (default: true) */
  enabled?: boolean;
  /** Maximum time in seconds to wait for async tools to register (default: 5) */
  maxWait?: number;
}

export interface InteractionConfig {
  /** Timeout in seconds for interactive UI calls forwarded from minions (default: 60) */
  timeout?: number;
}

export interface DisplayConfig {
  /** Lines to show in expanded output preview (default: 20) */
  outputPreviewLines?: number;
  /** Visible messages in minion observability widget (default: 4) */
  observabilityLines?: number;
  /** Show rotating hints in status widget (default: true) */
  showStatusHints?: boolean;
  /** Spinner animation frames */
  spinnerFrames?: string[];
}

/** Fully resolved config with all defaults applied */
export interface ResolvedConfig {
  minionNames: string[];
  allowEphemeral: boolean;
  delegation: Required<DelegationConfig>;
  display: Required<DisplayConfig>;
  toolSync: Required<ToolSyncConfig>;
  interaction: Required<InteractionConfig>;
}

// Pi settings interface matching the expected structure
interface PiSettings {
  "pi-minions"?: PiMinionsConfig;
}

/** Load pi settings from global and project config files
 *
 * Uses pi's standard paths:
 * - Global: $PI_CODING_AGENT_DIR/settings.json (falls back to ~/.pi/agent/settings.json)
 * - Project: <cwd>/.pi/settings.json
 */
function loadSettings(cwd: string): PiSettings {
  const settings: PiSettings = {};

  // Load global settings first (respects PI_CODING_AGENT_DIR env var)
  const globalSettingsPath = join(getAgentDir(), "settings.json");
  if (existsSync(globalSettingsPath)) {
    try {
      const globalContent = readFileSync(globalSettingsPath, "utf-8");
      const globalSettings = JSON.parse(globalContent) as PiSettings;
      Object.assign(settings, globalSettings);
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  // Project settings override global
  const projectSettingsPath = join(cwd, ".pi", "settings.json");
  if (existsSync(projectSettingsPath)) {
    try {
      const projectContent = readFileSync(projectSettingsPath, "utf-8");
      const projectSettings = JSON.parse(projectContent) as PiSettings;
      // Deep merge pi-minions config if it exists in both
      if (projectSettings["pi-minions"]) {
        settings["pi-minions"] = {
          ...settings["pi-minions"],
          ...projectSettings["pi-minions"],
          delegation: {
            ...settings["pi-minions"]?.delegation,
            ...projectSettings["pi-minions"]?.delegation,
          },
          display: {
            ...settings["pi-minions"]?.display,
            ...projectSettings["pi-minions"]?.display,
          },
          toolSync: {
            ...settings["pi-minions"]?.toolSync,
            ...projectSettings["pi-minions"]?.toolSync,
          },
          interaction: {
            ...settings["pi-minions"]?.interaction,
            ...projectSettings["pi-minions"]?.interaction,
          },
        };
      }
    } catch {
      // Ignore parse errors
    }
  }

  return settings;
}

export const DEFAULT_MINION_NAMES = [
  // core
  "kevin",
  "stuart",
  "bob",
  "otto",
  "mel",

  "arnie",
  "barry",
  "beena",
  "billy",
  "bina",
  "bobby",
  "brett",
  "brian",
  "cameron",
  "carl",
  "claude",
  "dan",
  "dave",
  "devin",
  "donny",
  "erik",
  "frank",
  "fred",
  "gaetano",
  "gary",
  "george",
  "gerald",
  "gigi",
  "jeff",
  "jim",
  "jon",
  "jorge",
  "juan",
  "ken",
  "keela",
  "koko",
  "lance",
  "larry",
  "lionel",
  "lola",
  "lulu",
  "mack",
  "mimi",
  "momo",
  "nana",
  "norbert",
  "pedro",
  "peter",
  "pip",
  "pippa",
  "ralph",
  "robert",
  "ron",
  "samson",
  "steve",
  "ted",
  "tim",
  "tom",
  "tony",
  "zack",
  "ziggy",
];

export const DEFAULT_SPINNER_FRAMES = [
  "[oo]",
  "[oo]",
  "[oo]",
  "[oo]",
  "[o-]",
  "[--]",
  "[--]",
  "[-o]",
  "[oo]",
  "[oo]",
];

export function getConfig(ctx: ExtensionContext): ResolvedConfig {
  const settings = loadSettings(ctx.cwd);
  const user = settings["pi-minions"] ?? {};
  return {
    minionNames: [...(user.minionNames ?? DEFAULT_MINION_NAMES)],
    allowEphemeral: user.allowEphemeral ?? true,
    delegation: {
      enabled: user.delegation?.enabled ?? true,
      toolCallThreshold: user.delegation?.toolCallThreshold ?? 16,
      hintIntervalMinutes: user.delegation?.hintIntervalMinutes ?? 8,
    },
    display: {
      outputPreviewLines: user.display?.outputPreviewLines ?? 20,
      observabilityLines: user.display?.observabilityLines ?? 6,
      showStatusHints: user.display?.showStatusHints ?? true,
      spinnerFrames: [...(user.display?.spinnerFrames ?? DEFAULT_SPINNER_FRAMES)],
    },
    toolSync: {
      enabled: user.toolSync?.enabled ?? true,
      maxWait: user.toolSync?.maxWait ?? 5,
    },
    interaction: {
      timeout: user.interaction?.timeout ?? 300,
    },
  };
}
