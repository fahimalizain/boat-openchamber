# Changelog

## 0.2.0 — 2026-11-13

- Create sandboxes from the panel: a **New sandbox** form with three sources
  (environment, saved snapshot, fork), machine size, name, auto-stop hours and
  plan capacity. Creating is asynchronous: the form returns at once, progress
  arrives live, and the new sandbox is selected when it is ready.
- A **Fork** action on the selected sandbox opens the form preset to Fork.
- `GET /create-options` and `POST /create` on the service; the form defaults to
  the environment that matches the open project.
- Sizes and the auto-stop cap follow the plan (`small`/`default`/`large`, with
  the plan's reason on a blocked size).

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
