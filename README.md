# Boat for OpenChamber

Your [boat.dev](https://boat.dev) cloud sandboxes inside OpenChamber: a Work
Status section, a rail panel for the OpenCode sessions running on them, and `@`
mentions for those sessions.

<!-- Screenshot: the Boat section in Work Status and the rail panel. -->
_Screenshot coming soon._

## Requirements

- OpenChamber 2.7.1 or newer (web, desktop and the phone; VS Code loads no extensions).
- The [boat CLI](https://docs.boat.dev) on the same machine, signed in — `boat status` should answer.
- OpenCode in the sandbox: boat's environments ship it, and the extension starts
  its background service on demand.
- `git` on PATH, used to read a project's remote for scoping.

## Install

[Install Boat](openchamber://extensions/install?url=https%3A%2F%2Fgithub.com%2Ffahimalizain%2Fboat-openchamber)

The button opens the desktop app and asks before it fetches anything. Elsewhere,
add `https://github.com/fahimalizain/boat-openchamber` in **Settings → Extensions**.

## What you get

**Work Status section "Boat"** — one line per sandbox with state, size and time
left, a badge while one of the sandbox's OpenCode sessions is busy, and Stop,
Extend 1h, Desktop or Resume on the row. Scoped to the open project, with a muted
note for the sandboxes in others.

**Rail panel** — two tabs. **Sandboxes** lists the project's sandboxes and the
others, one row each with state, size, environment and auto-stop time; Stop or
Resume is on the row, with Extend, Desktop, OpenCode and Copy in its menu, and
clicking the row opens its OpenCode sessions. **Sessions** talks to the sandbox's
own OpenCode server: the open session's title opens a switcher card with New
session, the sandbox's sessions and the directory filter, and the tab shows that
list in place of the transcript while no session is open. The transcript
collapses reasoning and expands tool rows in place, with inline permission and
question cards, and a composer that picks the agent, model and reasoning level.
The live badge in the header shows the event relay. **OpenCode** starts the
sandbox's server if it is not running, hosts it on a private boat URL and opens
its web UI already signed in; each click mints a fresh one-time link. Every
action ends in a toast, and failures show a banner.

**New sandboxes** — the panel's **New sandbox** button opens a form with two
independent choices: **Start from** a clean machine, a saved snapshot, or a copy
of an existing sandbox; and an **Environment**, which injects repos, secrets and
credentials (the account default, the project's matched environment, or for a
copy the source's own). Pick a size with its specs, a name and the auto-stop
hours. Copies are renamed after they start because `boat fork` has no name flag.
Creation runs in the background and the new sandbox appears selected when it is
ready. **Copy** on the selected sandbox opens the same form preset to a copy.

**`@` mentions** — type `@` in the composer and pick under **Sandboxes**: an
OpenCode session becomes a compact transcript (prompts, answers, one line per
tool call, errors) and a sandbox becomes a summary with its session list. The
agent gets the text, not the window.

**Agent instructions** — every session learns the sandbox ids, names and states,
plus the `boat exec <id> -- <command>` one-liner and where the sandbox agents
live (the Boat panel's Sessions tab). With a project open, the project's
sandboxes are named first in their own scoped instructions.

**Sidebar marks** — each registered project with sandboxes carries a small anchor
on its rows: green while a sandbox is up or an OpenCode session is busy, muted
when only stopped sandboxes remain, with a tooltip such as “2 sandboxes · 1 agent
running”. The mark clears when the project has none.

**Phone** — the panel opts in on the phone (`panel.mobile`) and switches to a
compact layout: one column, the session switcher as a full-width card, the
transcript, touch-sized controls, and safe-area padding. The create form works
the same at 360px.

**Remembered choices** — the last sandbox, provider and model are kept per
project, in device storage when the host offers it and in memory otherwise.

## Project scoping

A sandbox belongs to the open project when, in priority order:

1. It carries an `openchamber.project` label naming the project — the `owner/repo`
   slug or the folder name, case-insensitive.
2. Its boat environment attaches the project's repository, read from
   `git -C <dir> remote` (origin first) and normalized to `owner/repo`.
3. Its environment name equals the project folder name, case-insensitive.

With no project open, every sandbox shows. The create form defaults to the
environment that matches the open project, so a sandbox created from the panel
lands in it. Sidebar marks follow the same scoping; a `{ directory }` mark lands
on that project's sessions and worktree row, and the project list is learned
from the panel and from the open Work Status directory, then kept in
`~/.boat-openchamber/projects.json`.

## Privacy

- Everything runs on this machine. The extension talks to boat.dev only through
  the boat CLI, with the login you already have; there is no other network call.
- Sessions, messages and models come from the **sandbox's own OpenCode server**,
  reached through a `boat host` port URL. OpenCode's password and boat's port
  token stay inside the service's connection; neither is logged or returned to
  the panel.
- `boat env list` is read for environment names and repository full names only.
  Secret files, variables and setup scripts are dropped at the adapter boundary
  and never logged, cached, returned or emitted.

## Development

```sh
npm run build      # bundle service/main.ts and panel/main.ts
npm run check      # validate the package
npm run typecheck  # tsc --noEmit
npm test           # matcher, mention rows, create form, OpenCode normalisation
```

The bundler and package checker are bun scripts. `scripts/bun.sh` uses a real
`bun` when one is installed and falls back to `npx -y bun@latest`, so either
works. Installing an extension never builds it: `service/main.js` and
`panel/main.js` are committed.

```
shared/    sandbox shapes and state helpers; OpenCode shapes; route DTOs; time
service/   main.ts wires HTTP; boat.ts is the CLI adapter; domain/ typed reads;
           opencode/ connection, normalisation, reads, session cache and live relay;
           data/ caches and the project registry; project/ scoping; status/ section;
           mentions/ rows and text; create/ validation and the create job;
           marks/ mark computation and the marker; routes/ one module per route group
panel/     main.ts bootstraps; api.ts client; state + data + actions + live + create
           + preferences; device.ts picks the compact layout; chat-model + catalog +
           session-pick; views/ header, session bar (switcher), session list (the
           inline picker), session, message, composer, create, banner
```

CI (`.github/workflows/ci.yml`) installs, typechecks, tests, builds, runs the
package check, and fails when the committed bundles are stale.

## Releasing

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. `npm run build && npm run check && npm test`.
3. Commit the sources and the rebuilt bundles, then push. CI confirms they match.
4. Users update from **Settings → Extensions**; the app notices a new version.

## License

MIT © Fahim Ali Zain
