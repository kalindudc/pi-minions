import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { logger } from "../logger.js";
import type { ResultQueue } from "../queue.js";
import type { AgentTree } from "../tree.js";
import type { SpawnResult } from "../types.js";

export async function handleCompletion(
  sessionPromise: Promise<SpawnResult>,
  id: string,
  name: string,
  task: string,
  startTime: number,
  tree: AgentTree,
  queue: ResultQueue,
  pi: ExtensionAPI,
): Promise<void> {
  logger.debug("spawn:completion", "handleCompletion-called", { id, name, task });

  let result: SpawnResult;

  try {
    result = await sessionPromise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("spawn:completion", "sessionPromise-rejected", { id, name, error: msg });
    tree.updateStatus(id, "failed", 1, msg);
    logger.error("spawn:tool", "bg-failed", { id, name, error: msg });
    return;
  }

  logger.debug("spawn:completion", "sessionPromise-resolved", {
    id,
    name,
    exitCode: result.exitCode,
    hasOutput: !!result.finalOutput,
    outputLength: result.finalOutput?.length,
    outputPreview: result.finalOutput?.slice(0, 200),
    hasError: !!result.error,
  });

  // Do not overwrite an already-aborted status (e.g. user halted the minion)
  const currentNode = tree.get(id);
  if (currentNode?.status === "aborted") {
    logger.debug("spawn:completion", "skipping-update-already-aborted", { id });
    return;
  }

  const status = result.exitCode === 0 ? "completed" : "failed";
  tree.updateStatus(id, status, result.exitCode, result.error);
  tree.updateUsage(id, result.usage);
  logger.debug("spawn:completion", "tree-updated", { id, status });

  queue.add({
    id,
    name,
    task,
    output: result.finalOutput,
    usage: result.usage,
    status: "pending",
    completedAt: Date.now(),
    duration: Date.now() - startTime,
    exitCode: result.exitCode,
    error: result.error,
  });
  logger.debug("spawn:completion", "queue-add-called", { id });

  const content = `[Background minion "${name}" completed - exit code: ${result.exitCode}]`;

  try {
    const messagePayload = {
      customType: "minion-complete" as const,
      content,
      display: true,
      details: {
        id,
        name,
        task,
        exitCode: result.exitCode,
        error: result.error,
        duration: Date.now() - startTime,
        output: result.finalOutput,
      },
    };

    if (tree.isForegrounded(id)) {
      logger.debug("spawn:completion", "minion-was-foregrounded, skipping-sendMessage", { id });
    } else {
      pi.sendMessage(messagePayload, { triggerTurn: true });
      logger.debug("spawn:completion", "sendMessage-called", { id, name, triggerTurn: true });
    }
  } catch (sendErr) {
    const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
    logger.error("spawn:completion", "sendMessage-failed", { id, error: sendMsg });
  }

  queue.accept(id);
  logger.info("spawn:tool", "completed", {
    id,
    name,
    exitCode: result.exitCode,
  });
}
