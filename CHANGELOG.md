# Changelog

## Unreleased

- The panel now drives each sandbox's **OpenCode server** instead of the boat
  CLI: the Conversations tab became **Sessions**, with a dense session list and
  directory filter, a live transcript (collapsed reasoning, tool rows that expand
  in place), inline permission and question cards, and a composer for the agent,
  model and reasoning level. New sessions land in the environment's repository
  or the sandbox home.
- The service keeps one authenticated connection per sandbox (boat's port token
  plus OpenCode's password), relays OpenCode's event stream to the panel, and
  rebuilds the connection once when it expires or the proxy refuses it.
- The Work Status row badge, the sidebar marks and `agentRunning` now mean “an
  OpenCode session in this sandbox is busy”. They only read sandboxes whose
  OpenCode connection is already open, so a badge never starts a server by
  itself.
- `@` mentions list OpenCode sessions; a session resolves to its transcript, a
  sandbox to its summary and session list.
- Agent instructions teach `boat exec <id> -- <command>` and point at the panel
  for sandbox agents; the `boat prompt` / `steer` / `interrupt` teaching, the
  conversation routes, the boat event relay and boat's agent catalogue are gone.
- The session list shows whole rows (four at a time) above a divider, and the
  directory filter only lists sessions whose own directory matches.
- The open session's header is the session switcher: clicking its title opens a
  card with New session, the sandbox's sessions (busy first, then newest) and
  the directory filter, and with no session open that list fills the tab. The
  always-visible list, the phone's back button and the header's folder and
  agent/model chips are gone; the toolbar keeps the sandbox picker and state.
- **OpenCode** in a running sandbox's row menu opens the sandbox's own OpenCode
  web UI in a browser tab. It starts OpenCode's background service when needed,
  hosts its port on a token-gated boat URL, and signs in with a one-time
  `opencode pair` link, so one URL passes both boat's gate and OpenCode's
  password.

## 0.4.0 — 2026-11-13

- The panel is split into **Sandboxes** and **Conversations** tabs; the
  redundant BOAT heading is gone and the LIVE badge now sits above the chat.
- Sandboxes tab: New sandbox at the top, “This project” / “Other sandboxes”
  groups, and one row per sandbox with its state, size, environment and
  auto-stop time. Each row carries Stop or Resume (never both, Stop asks twice),
  with Extend 1h, Desktop and Copy in an overflow menu; the row opens the
  sandbox’s conversations. A running-agent badge shows when known.
- Conversations tab: a compact sandbox switcher and state line, an inline Resume
  banner when the sandbox is stopped, and the unchanged conversation list, chat
  and composer.
- The last tab and the default-tab rule (Conversations only when the remembered
  sandbox has conversations) are stored per device.

## 0.3.3 — 2026-11-13

- The composer's Agent, Model and Reasoning selects sit in one horizontal row
  above the textarea, labels included, and wrap to full-width on a narrow panel.
  The composer no longer shrinks below its content, so the textarea cannot sit
  under the row; the separate “New conversation” hint is gone (Reply and Steer
  keep theirs).

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
