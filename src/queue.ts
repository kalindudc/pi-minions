import type { QueuedResult } from "./types.js";

export class ResultQueue {
  private results = new Map<string, QueuedResult>();
  private listeners = new Set<() => void>();

  add(result: QueuedResult): void {
    this.results.set(result.id, result);
    this.notify();
  }

  get(id: string): QueuedResult | undefined {
    return this.results.get(id);
  }

  getPending(): QueuedResult[] {
    return Array.from(this.results.values()).filter((r) => r.status === "pending");
  }

  /** Mark a result as accepted (auto-delivered to parent). Internal use. */
  accept(id: string): void {
    const result = this.results.get(id);
    if (!result || result.status !== "pending") return;
    this.results.delete(id);
    this.notify();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
