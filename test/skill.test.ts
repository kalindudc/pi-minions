import { describe, expect, it } from "vitest";
import { getMinionsSkill, MINIONS_SKILL } from "../src/skill.js";

describe("minions skill", () => {
  it("teaches the foreground minion delegation surface", () => {
    const text = getMinionsSkill();

    expect(text).toBe(MINIONS_SKILL);
    expect(text).toContain("spawn");
    expect(text).toContain("tasks");
    expect(text).toContain("agent");
    expect(text).toContain("model");
    expect(text).toContain("halt");
    expect(text).toContain("list_agents");
    expect(text).toContain("foreground");
  });

  it("states removed delegation surfaces are unavailable without naming removed tool commands", () => {
    const text = getMinionsSkill();

    expect(text).toContain("Background minions are not available");
    expect(text).toContain("Live detach is not available");
    expect(text).toContain("User steering is not available");
    expect(text).not.toContain("spawn" + "_bg");
    expect(text).not.toContain("/spawn " + "--bg");
    expect(text).not.toContain("/minions " + "steer");
  });
});
