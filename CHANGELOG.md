# Changelog

## 0.1.0 — 2026-11-13

First public release.

- Work Status section "Boat": one row per sandbox with state, size, time left,
  Stop, Extend 1h and Desktop, a running-agent badge, and Resume for stopped
  sandboxes. Scoped to the open project, with a note for the rest.
- Rail panel: sandbox picker, conversations with harness, model, prompt count
  and running badge, a live event chat, and a composer to prompt, steer or
  interrupt. Provider and model for a new conversation, toast on every result.
- `@` mentions: every cached conversation and a sandbox overview, resolved into
  a compact transcript or a sandbox summary for the agent.
- Agent instructions: a short sandbox list for every session, per project when
  one is open.
- Project scoping by the `openchamber.project` label, a repository the boat
  environment attaches, or the environment name matching the folder.
