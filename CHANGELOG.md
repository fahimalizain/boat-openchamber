# Changelog

## 0.3.2 — 2026-11-13

- Fixed the panel against the real CLI output: every JSONL reader now unwraps the
  `{ event, data }` envelope (conversations, events, the `-f` follower and
  create/fork progress), a single-line JSONL result is no longer dropped, and
  streamed partial responses collapse into their final event by id.
- Replies now continue a conversation on its own harness and model
  (`claude-code` → `claude`, from boat's own catalogue) instead of boat's
  dashboard default.
- The composer's agent and model choices come from boat's `provider-models`
  catalogue (cached, persisted, with a built-in fallback), marked by the default
  profile's connected credentials, with a reasoning select. The free-text model
  field is gone, and the chosen agent, model and reasoning are remembered per
  project.
- A conversation the list no longer has is cleared after a short grace window,
  so the composer cannot sit in reply mode for a missing thread.
- `[hidden]` is respected globally, so Interrupt, the provider row and the header
  actions no longer show when they should not; the header meta line uses body
  text and the composer hint reads “Reply”.

## 0.3.1 — 2026-11-13

- Reworked the New sandbox form: **Start from** (clean machine / saved snapshot /
  copy of a sandbox) is now separate from **Environment**, which applies to every
  start. The environment defaults to the project's, a copy inherits the source's
  unless changed, sizes carry their specs, snapshot and copy pickers show size,
  date or state, every field is labelled, and the billing hint is one short line.
- A copy is renamed with `boat rename <id> <name>` after it starts; a failed
  rename still selects the sandbox and explains itself in a banner.
- The create request is now `{ start, environment?, size?, name?, autoStopHours }`,
  mapped to `boat new` / `boat fork` argv by one tested function.
- Removed the old three-tab source model with no leftovers.

## 0.3.0 — 2026-11-13

- Sidebar marks: a small anchor on each registered project's rows, with the
  sandbox count and running agents, set only when it changes and rate-limited.
  The project list comes from the panel's `listProjects` and the open Work
  Status directory, kept in `~/.boat-openchamber/projects.json`. The service now
  sets `keepRunning` so marks survive an idle stop.
- Phone: `panel.mobile` and a compact layout from `ready.device` — one column,
  the conversation list and chat with a back button, 44px controls, safe-area
  and keyboard insets, and the create form at 360px.
- Preferences: the last sandbox, provider and model per project, in device
  storage when `features.deviceStorage` allows it, in memory otherwise.
- Upgraded to `@openchamber/sdk` 2.7.1 and an `engines.openchamber` floor of
  `>=2.7.1` for marks and device fields.

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
