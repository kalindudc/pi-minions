import { bench, describe, expect, it } from 'vitest';
import { ResultQueue } from '../../src/queue.js';

describe('ResultQueue performance', () => {
  bench('add 10000 results', () => {
    const queue = new ResultQueue();
    for (let i = 0; i < 10000; i++) {
      queue.add({
        id: `id${i}`,
        name: `name${i}`,
        task: `task${i}`,
        output: 'test output',
        usage: { input: 100, output: 50, cost: 0.001, cacheRead: 0, cacheWrite: 0, contextTokens: 0, turns: 1 },
        status: 'pending',
        completedAt: Date.now(),
        duration: 1000,
        exitCode: 0,
      });
    }
  }, { time: 2000 });

  bench('getPending with 10000 results', () => {
    const queue = new ResultQueue();
    for (let i = 0; i < 10000; i++) {
      queue.add({
        id: `id${i}`,
        name: `name${i}`,
        task: `task${i}`,
        output: 'test output',
        usage: { input: 100, output: 50, cost: 0.001, cacheRead: 0, cacheWrite: 0, contextTokens: 0, turns: 1 },
        status: 'pending',
        completedAt: Date.now(),
        duration: 1000,
        exitCode: 0,
      });
    }
    queue.getPending();
  }, { time: 1000 });

  it('queue memory growth', () => {
    const queue = new ResultQueue();
    for (let i = 0; i < 10000; i++) {
      queue.add({
        id: `id${i}`,
        name: `name${i}`,
        task: `task${i}`,
        output: 'test output',
        usage: { input: 100, output: 50, cost: 0.001, cacheRead: 0, cacheWrite: 0, contextTokens: 0, turns: 1 },
        status: 'pending',
        completedAt: Date.now(),
        duration: 1000,
        exitCode: 0,
      });
    }
    expect(queue.getPending().length).toBe(10000);
    // This exposes the unbounded growth issue - the Map grows without bound
    // as there's no mechanism to remove old results
  });
});
