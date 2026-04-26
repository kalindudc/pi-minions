import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MINION_NAMES,
  DEFAULT_SPINNER_FRAMES,
  getConfig,
  type PiMinionsConfig,
  type ResolvedConfig,
} from "../src/config.js";
import { createMockContext } from "./helpers/mock-context.js";

// We need to mock getAgentDir but the module is already imported
// Let's test the actual behavior by creating files at expected locations

describe("getConfig", () => {
  let tempDir: string;
  let agentDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `pi-minions-test-${Date.now()}`);
    agentDir = join(tempDir, "agent");
    mkdirSync(join(tempDir, ".pi"), { recursive: true });
    mkdirSync(agentDir, { recursive: true });

    // Set env var to use our test agent directory
    originalEnv = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });

  afterEach(() => {
    // Restore env
    if (originalEnv === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalEnv;
    }

    try {
      rmSync(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("default values", () => {
    it("returns default configuration when no settings files exist", () => {
      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.minionNames).toEqual(DEFAULT_MINION_NAMES);
      expect(config.allowEphemeral).toBe(true);
      expect(config.delegation.enabled).toBe(true);
      expect(config.delegation.toolCallThreshold).toBe(16);
      expect(config.delegation.hintIntervalMinutes).toBe(8);
      expect(config.display.outputPreviewLines).toBe(20);
      expect(config.display.observabilityLines).toBe(6);
      expect(config.display.showStatusHints).toBe(true);
      expect(config.display.spinnerFrames).toEqual(DEFAULT_SPINNER_FRAMES);
      expect(config.toolSync.enabled).toBe(true);
      expect(config.toolSync.maxWait).toBe(5);
    });

    it("has 61 default minion names", () => {
      expect(DEFAULT_MINION_NAMES).toHaveLength(61);
      expect(DEFAULT_MINION_NAMES[0]).toBe("kevin");
      expect(DEFAULT_MINION_NAMES).toContain("stuart");
      expect(DEFAULT_MINION_NAMES).toContain("bob");
    });

    it("has 10 default spinner frames", () => {
      expect(DEFAULT_SPINNER_FRAMES).toHaveLength(10);
    });
  });

  describe("global settings", () => {
    it("reads minionNames from global settings", () => {
      const globalSettings = {
        "pi-minions": {
          minionNames: ["alpha", "beta", "gamma"],
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.minionNames).toEqual(["alpha", "beta", "gamma"]);
    });

    it("reads allowEphemeral from global settings", () => {
      const globalSettings = {
        "pi-minions": {
          allowEphemeral: false,
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.allowEphemeral).toBe(false);
    });

    it("reads delegation settings from global settings", () => {
      const globalSettings = {
        "pi-minions": {
          delegation: {
            enabled: false,
            toolCallThreshold: 5,
            hintIntervalMinutes: 10,
          },
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.delegation.enabled).toBe(false);
      expect(config.delegation.toolCallThreshold).toBe(5);
      expect(config.delegation.hintIntervalMinutes).toBe(10);
    });

    it("reads display settings from global settings", () => {
      const globalSettings = {
        "pi-minions": {
          display: {
            outputPreviewLines: 30,
            observabilityLines: 8,
            showStatusHints: false,
            spinnerFrames: ["◐", "◓", "◑", "◒"],
          },
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.display.outputPreviewLines).toBe(30);
      expect(config.display.observabilityLines).toBe(8);
      expect(config.display.showStatusHints).toBe(false);
      expect(config.display.spinnerFrames).toEqual(["◐", "◓", "◑", "◒"]);
    });

    it("reads toolSync settings from global settings", () => {
      const globalSettings = {
        "pi-minions": {
          toolSync: {
            enabled: false,
            maxWait: 10,
          },
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.toolSync.enabled).toBe(false);
      expect(config.toolSync.maxWait).toBe(10);
    });
  });

  describe("project settings override global", () => {
    it("project minionNames override global", () => {
      const globalSettings = {
        "pi-minions": {
          minionNames: ["global1", "global2"],
        },
      };
      const projectSettings = {
        "pi-minions": {
          minionNames: ["project1", "project2"],
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));
      writeFileSync(join(tempDir, ".pi", "settings.json"), JSON.stringify(projectSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.minionNames).toEqual(["project1", "project2"]);
    });

    it("project delegation settings override global", () => {
      const globalSettings = {
        "pi-minions": {
          delegation: {
            enabled: true,
            toolCallThreshold: 10,
            hintIntervalMinutes: 15,
          },
        },
      };
      const projectSettings = {
        "pi-minions": {
          delegation: {
            enabled: false,
            toolCallThreshold: 3,
          },
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));
      writeFileSync(join(tempDir, ".pi", "settings.json"), JSON.stringify(projectSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.delegation.enabled).toBe(false);
      expect(config.delegation.toolCallThreshold).toBe(3);
      // hintIntervalMinutes should merge from global since not in project
      expect(config.delegation.hintIntervalMinutes).toBe(15);
    });

    it("project display settings override global", () => {
      const globalSettings = {
        "pi-minions": {
          display: {
            outputPreviewLines: 10,
            observabilityLines: 4,
            showStatusHints: true,
            spinnerFrames: ["a", "b", "c"],
          },
        },
      };
      const projectSettings = {
        "pi-minions": {
          display: {
            outputPreviewLines: 50,
            showStatusHints: false,
          },
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));
      writeFileSync(join(tempDir, ".pi", "settings.json"), JSON.stringify(projectSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.display.outputPreviewLines).toBe(50);
      expect(config.display.showStatusHints).toBe(false);
      // observabilityLines and spinnerFrames should merge from global
      expect(config.display.observabilityLines).toBe(4);
      expect(config.display.spinnerFrames).toEqual(["a", "b", "c"]);
    });

    it("project toolSync settings override global", () => {
      const globalSettings = {
        "pi-minions": {
          toolSync: {
            enabled: true,
            maxWait: 10,
          },
        },
      };
      const projectSettings = {
        "pi-minions": {
          toolSync: {
            enabled: false,
          },
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));
      writeFileSync(join(tempDir, ".pi", "settings.json"), JSON.stringify(projectSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.toolSync.enabled).toBe(false);
      // maxWait should merge from global
      expect(config.toolSync.maxWait).toBe(10);
    });
  });

  describe("partial configuration", () => {
    it("uses defaults for missing delegation fields", () => {
      const globalSettings = {
        "pi-minions": {
          delegation: {
            toolCallThreshold: 5,
            // enabled and hintIntervalMinutes missing
          },
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.delegation.enabled).toBe(true); // default
      expect(config.delegation.toolCallThreshold).toBe(5); // from config
      expect(config.delegation.hintIntervalMinutes).toBe(8); // default
    });

    it("uses defaults for missing display fields", () => {
      const globalSettings = {
        "pi-minions": {
          display: {
            outputPreviewLines: 25,
            // other fields missing
          },
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.display.outputPreviewLines).toBe(25); // from config
      expect(config.display.observabilityLines).toBe(6); // default
      expect(config.display.showStatusHints).toBe(true); // default
      expect(config.display.spinnerFrames).toEqual(DEFAULT_SPINNER_FRAMES); // default
    });

    it("uses defaults when pi-minions key is missing", () => {
      const globalSettings = {
        someOtherExtension: {
          setting: "value",
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      expect(config.minionNames).toEqual(DEFAULT_MINION_NAMES);
      expect(config.delegation.enabled).toBe(true);
    });
  });

  describe("malformed settings handling", () => {
    it("handles invalid JSON in global settings gracefully", () => {
      writeFileSync(join(agentDir, "settings.json"), "not valid json");

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      // Should use defaults when global is invalid
      expect(config.minionNames).toEqual(DEFAULT_MINION_NAMES);
      expect(config.delegation.enabled).toBe(true);
    });

    it("handles invalid JSON in project settings gracefully", () => {
      const globalSettings = {
        "pi-minions": {
          minionNames: ["global"],
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));
      writeFileSync(join(tempDir, ".pi", "settings.json"), "not valid json");

      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      // Should use global settings when project is invalid
      expect(config.minionNames).toEqual(["global"]);
    });

    it("handles missing settings files gracefully", () => {
      const ctx = createMockContext(tempDir);
      const config = getConfig(ctx);

      // No settings files exist, should use defaults
      expect(config.minionNames).toEqual(DEFAULT_MINION_NAMES);
      expect(config.delegation.enabled).toBe(true);
    });
  });

  describe("immutability", () => {
    it("returns a copy of minionNames, not a reference", () => {
      const globalSettings = {
        "pi-minions": {
          minionNames: ["alpha", "beta"],
        },
      };
      writeFileSync(join(agentDir, "settings.json"), JSON.stringify(globalSettings));

      const ctx = createMockContext(tempDir);
      const config1 = getConfig(ctx);
      const config2 = getConfig(ctx);

      // Modifying one should not affect the other
      config1.minionNames.push("gamma");
      expect(config2.minionNames).toEqual(["alpha", "beta"]);
    });
  });
});

describe("Config types", () => {
  it("ResolvedConfig has all required fields", () => {
    const mockResolved: ResolvedConfig = {
      minionNames: ["test"],
      allowEphemeral: true,
      delegation: {
        enabled: true,
        toolCallThreshold: 5,
        hintIntervalMinutes: 10,
      },
      display: {
        outputPreviewLines: 20,
        observabilityLines: 6,
        showStatusHints: true,
        spinnerFrames: ["a", "b"],
      },
      toolSync: {
        enabled: true,
        maxWait: 5,
      },
      interaction: {
        timeout: 60,
      },
    };

    expect(mockResolved.minionNames).toBeDefined();
    expect(mockResolved.delegation.enabled).toBe(true);
    expect(mockResolved.delegation.toolCallThreshold).toBe(5);
    expect(mockResolved.delegation.hintIntervalMinutes).toBe(10);
    expect(mockResolved.display.outputPreviewLines).toBe(20);
    expect(mockResolved.display.observabilityLines).toBe(6);
    expect(mockResolved.display.showStatusHints).toBe(true);
    expect(mockResolved.display.spinnerFrames).toEqual(["a", "b"]);
  });

  it("PiMinionsConfig allows partial configuration", () => {
    // These should compile without error
    const empty: PiMinionsConfig = {};
    const partial1: PiMinionsConfig = { minionNames: ["a"] };
    const partial2: PiMinionsConfig = {
      delegation: { enabled: false },
    };
    const partial3: PiMinionsConfig = {
      display: { outputPreviewLines: 10 },
    };

    expect(empty).toBeDefined();
    expect(partial1.minionNames).toEqual(["a"]);
    expect(partial2.delegation?.enabled).toBe(false);
    expect(partial3.display?.outputPreviewLines).toBe(10);
  });
});

describe("Config inheritance (legacy)", () => {
  it("filters pi-minions from extension list", () => {
    const mockExtensions = [
      { path: "other", resolvedPath: "/path/to/other" },
      { path: "pi-minions", resolvedPath: "/node_modules/pi-minions" },
    ];
    const filtered = mockExtensions.filter((ext) => !ext.resolvedPath.includes("pi-minions"));
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.path).toBe("other");
  });
});
