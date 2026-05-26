# Roadmap

This roadmap tracks current foreground-only pi-minions work.

## Current focus

- Keep foreground `spawn` fast and reliable.
- Preserve clear activity visibility through status hints, `list_minions`, `show_minion`, and `/minions show`.
- Keep package contents slim by shipping source and standard npm metadata only.
- Improve e2e coverage for foreground delegation, learn surfaces, and observability.

## Future ideas

- Better summaries for long batch outputs.
- More ergonomic filtering in `list_minions`.
- Optional richer activity history search for completed minions.
- Additional examples for writing named agents.
- Performance profiling for large batches.

## Done

- Foreground single and batch minion spawning.
- Named and ephemeral agent discovery.
- File-backed minion sessions with parent tracking.
- Live foreground observability widget.
- Built-in learn/skill text exposed as `learn_minions` and `/minions learn`.
