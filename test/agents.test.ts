import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadAgentsFromDir, discoverAgents } from "../src/agents.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "agents");

describe("loadAgentsFromDir", () => {
  it("returns empty array for a missing directory", () => {
    const agents = loadAgentsFromDir("/nonexistent/path", "user");
    expect(agents).toEqual([]);
  });

  it("skips non-.md files", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const names = agents.map((a) => a.name);
    expect(names).not.toContain("not-markdown");
  });

  it("skips agents with no description", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const names = agents.map((a) => a.name);
    expect(names).not.toContain("broken");
  });

  it("parses name and description", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout).toBeDefined();
    expect(scout!.description).toBe("Fast codebase recon");
  });

  it("parses tools as trimmed string array", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout!.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
  });

  it("leaves tools undefined when not specified", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const worker = agents.find((a) => a.name === "worker");
    expect(worker!.tools).toBeUndefined();
  });

  it("parses model field", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout!.model).toBe("claude-haiku-4-5");
  });

  it("leaves model undefined when not specified", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const worker = agents.find((a) => a.name === "worker");
    expect(worker!.model).toBeUndefined();
  });

  it("parses thinking field", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout!.thinking).toBe("low");
  });

  it("parses steps as number", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const thinker = agents.find((a) => a.name === "thinker");
    expect(thinker!.steps).toBe(30);
  });

  it("parses steps from opencode-compat agents", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const researcher = agents.find((a) => a.name === "researcher");
    expect(researcher).toBeDefined();
    expect(researcher!.steps).toBe(30);
  });

  it("silently ignores unknown opencode frontmatter fields", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const researcher = agents.find((a) => a.name === "researcher");
    expect(researcher).toBeDefined();
    expect(researcher!.description).toBe("Research agent");
    // Extra fields from opencode (mode, temperature, color) must not throw
    expect(researcher!.model).toBe("claude-sonnet-4-5");
  });

  it("sets source on each agent", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    expect(agents.every((a) => a.source === "user")).toBe(true);
  });

  it("sets filePath on each agent", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    expect(agents.every((a) => a.filePath.endsWith(".md"))).toBe(true);
  });

  it("body after frontmatter becomes systemPrompt", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout!.systemPrompt.trim()).toBe("You are a scout.");
  });
});

describe("discoverAgents scope", () => {
  it("scope=user returns agents with source=user", () => {
    const { agents } = discoverAgents(FIXTURES, "user");
    expect(agents.every((a) => a.source === "user")).toBe(true);
  });

  it("scope=project returns empty when no .pi/agents dir exists", () => {
    const { agents } = discoverAgents("/nonexistent", "project");
    expect(agents).toEqual([]);
  });

  it("scope=both: project agents override user agents with same name", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const projectAgentsDir = join(tmpBase, ".pi", "agents");
    mkdirSync(projectAgentsDir, { recursive: true });

    writeFileSync(
      join(projectAgentsDir, "scout.md"),
      "---\nname: scout\ndescription: Project scout override\n---\nProject version.",
    );

    const cwd = tmpBase;
    const { agents } = discoverAgents(cwd, "both");

    const scout = agents.find((a) => a.name === "scout");
    // The project version should win since it exists in .pi/agents under cwd
    expect(scout?.description).toBe("Project scout override");
    expect(scout?.source).toBe("project");

    rmSync(tmpBase, { recursive: true, force: true });
  });
});
