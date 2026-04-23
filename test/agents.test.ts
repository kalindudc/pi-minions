import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverAgents, loadAgentsFromDir } from "../src/agents.js";

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
    expect(scout?.description).toBe("Fast codebase recon");
  });

  it("parses tools as trimmed string array", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout?.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
  });

  it("leaves tools undefined when not specified", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const worker = agents.find((a) => a.name === "worker");
    expect(worker?.tools).toBeUndefined();
  });

  it("parses model field", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout?.model).toBe("claude-haiku-4-5");
  });

  it("leaves model undefined when not specified", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const worker = agents.find((a) => a.name === "worker");
    expect(worker?.model).toBeUndefined();
  });

  it("parses thinking field", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const scout = agents.find((a) => a.name === "scout");
    expect(scout?.thinking).toBe("low");
  });

  it("parses steps as number", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const thinker = agents.find((a) => a.name === "thinker");
    expect(thinker?.steps).toBe(30);
  });

  it("parses steps from opencode-compat agents", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const researcher = agents.find((a) => a.name === "researcher");
    expect(researcher).toBeDefined();
    expect(researcher?.steps).toBe(30);
  });

  it("silently ignores unknown opencode frontmatter fields", () => {
    const agents = loadAgentsFromDir(FIXTURES, "user");
    const researcher = agents.find((a) => a.name === "researcher");
    expect(researcher).toBeDefined();
    expect(researcher?.description).toBe("Research agent");
    // Extra fields from opencode (mode, temperature, color) must not throw
    expect(researcher?.model).toBe("claude-sonnet-4-5");
  });

  it("parses displayName field", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const agentsDir = join(tmpBase, "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, "bob.md"),
      "---\nname: researcher\ndisplayName: Bob\ndescription: Research agent\n---\nYou are Bob.",
    );
    const agents = loadAgentsFromDir(agentsDir, "user");
    const bob = agents.find((a) => a.name === "researcher");
    expect(bob?.displayName).toBe("Bob");
    rmSync(tmpBase, { recursive: true, force: true });
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
    expect(scout?.systemPrompt.trim()).toBe("You are a scout.");
  });

  it("loads MINION.md from immediate child directories", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const agentsDir = join(tmpBase, "agents");
    const reviewerDir = join(agentsDir, "reviewer");
    mkdirSync(reviewerDir, { recursive: true });

    writeFileSync(
      join(reviewerDir, "MINION.md"),
      "---\ndescription: Reviewer agent\n---\nYou are a reviewer.",
    );

    const agents = loadAgentsFromDir(agentsDir, "user");
    const reviewer = agents.find((a) => a.name === "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer?.description).toBe("Reviewer agent");
    expect(reviewer?.filePath).toBe(join(reviewerDir, "MINION.md"));

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("uses frontmatter name from MINION.md when provided", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const agentsDir = join(tmpBase, "agents");
    const reviewerDir = join(agentsDir, "reviewer");
    mkdirSync(reviewerDir, { recursive: true });

    writeFileSync(
      join(reviewerDir, "MINION.md"),
      "---\nname: strict-reviewer\ndescription: Reviewer agent\n---\nYou are a reviewer.",
    );

    const agents = loadAgentsFromDir(agentsDir, "user");
    expect(agents.find((a) => a.name === "reviewer")).toBeUndefined();
    expect(agents.find((a) => a.name === "strict-reviewer")).toBeDefined();

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("prefers top-level markdown files over MINION.md on name collision", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const agentsDir = join(tmpBase, "agents");
    const reviewerDir = join(agentsDir, "reviewer");
    mkdirSync(reviewerDir, { recursive: true });

    writeFileSync(
      join(agentsDir, "reviewer.md"),
      "---\ndescription: Top-level reviewer\n---\nTop-level prompt.",
    );
    writeFileSync(
      join(reviewerDir, "MINION.md"),
      "---\ndescription: Nested reviewer\n---\nNested prompt.",
    );

    const agents = loadAgentsFromDir(agentsDir, "user");
    const reviewer = agents.find((a) => a.name === "reviewer");
    expect(reviewer?.description).toBe("Top-level reviewer");
    expect(reviewer?.filePath).toBe(join(agentsDir, "reviewer.md"));

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("does not discover MINION.md deeper than one directory level", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const agentsDir = join(tmpBase, "agents");
    const nestedDir = join(agentsDir, "team", "reviewer");
    mkdirSync(nestedDir, { recursive: true });

    writeFileSync(
      join(nestedDir, "MINION.md"),
      "---\ndescription: Deep reviewer\n---\nDeep prompt.",
    );

    const agents = loadAgentsFromDir(agentsDir, "user");
    expect(agents).toEqual([]);

    rmSync(tmpBase, { recursive: true, force: true });
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

  it("discovers agents from .pi/minions/ project directory via MINION.md", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const minionDir = join(tmpBase, ".pi", "minions", "reviewer");
    mkdirSync(minionDir, { recursive: true });

    writeFileSync(
      join(minionDir, "MINION.md"),
      "---\ndescription: Project reviewer\n---\nProject reviewer prompt.",
    );

    mkdirSync(join(tmpBase, ".git"), { recursive: true });

    const { agents } = discoverAgents(tmpBase, "project");
    const reviewer = agents.find((a) => a.name === "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer?.description).toBe("Project reviewer");
    expect(reviewer?.source).toBe("project");

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("discovers agents from .agents/agents/ project directory", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const dotAgentsDir = join(tmpBase, ".agents", "agents");
    mkdirSync(dotAgentsDir, { recursive: true });

    writeFileSync(
      join(dotAgentsDir, "helper.md"),
      "---\nname: helper\ndescription: Dot-agents helper\n---\nHelper prompt.",
    );

    // Create .git so findProjectDir stops here
    mkdirSync(join(tmpBase, ".git"), { recursive: true });

    const { agents } = discoverAgents(tmpBase, "project");
    const helper = agents.find((a) => a.name === "helper");
    expect(helper).toBeDefined();
    expect(helper?.description).toBe("Dot-agents helper");
    expect(helper?.source).toBe("project");

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("project .agents/agents/ overrides global on name collision", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const dotAgentsDir = join(tmpBase, ".agents", "agents");
    mkdirSync(dotAgentsDir, { recursive: true });
    mkdirSync(join(tmpBase, ".git"), { recursive: true });

    writeFileSync(
      join(dotAgentsDir, "scout.md"),
      "---\nname: scout\ndescription: Dot-agents scout override\n---\nDot-agents version.",
    );

    const { agents } = discoverAgents(tmpBase, "both");
    const scout = agents.find((a) => a.name === "scout");
    // Project .agents/agents/ should override global user agents
    expect(scout?.description).toBe("Dot-agents scout override");
    expect(scout?.source).toBe("project");

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it("both .pi/agents/ and .agents/agents/ agents are returned together", () => {
    const tmpBase = join(tmpdir(), `pm-test-${Date.now()}`);
    const piAgentsDir = join(tmpBase, ".pi", "agents");
    const dotAgentsDir = join(tmpBase, ".agents", "agents");
    mkdirSync(piAgentsDir, { recursive: true });
    mkdirSync(dotAgentsDir, { recursive: true });
    mkdirSync(join(tmpBase, ".git"), { recursive: true });

    writeFileSync(
      join(piAgentsDir, "alpha.md"),
      "---\nname: alpha\ndescription: Pi alpha agent\n---\nAlpha prompt.",
    );
    writeFileSync(
      join(dotAgentsDir, "beta.md"),
      "---\nname: beta\ndescription: Dot-agents beta agent\n---\nBeta prompt.",
    );

    const { agents } = discoverAgents(tmpBase, "project");
    const names = agents.map((a) => a.name);
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(agents).toHaveLength(2);

    rmSync(tmpBase, { recursive: true, force: true });
  });
});
