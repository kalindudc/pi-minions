export { MockTUI, type RenderLogEntry } from "./mock-tui.js";
export { MockAgentTree } from "./mock-tree.js";
export { MockSubsessionManager, MockAgentSession } from "./mock-subsession.js";
export { TestHarness, type HarnessOptions } from "./harness.js";

import { TestHarness, type HarnessOptions } from "./harness.js";

export function createTestHarness(options?: HarnessOptions): TestHarness {
  return new TestHarness(options);
}
