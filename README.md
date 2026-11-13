# Boat for OpenChamber

Your [boat.dev](https://boat.dev) cloud sandboxes inside OpenChamber: a Work
Status section, a rail panel for the agents running on them, and `@` mentions for
their conversations.

<!-- Screenshot: the Boat section in Work Status and the rail panel. -->
_Screenshot coming soon._

## Requirements

- OpenChamber 2.7.0 or newer (web or desktop; VS Code and the phone load no extensions).
- The [boat CLI](https://docs.boat.dev) on the same machine, signed in — `boat status` should answer.
- `git` on PATH, used to read a project's remote for scoping.

## Install

[Install Boat](openchamber://extensions/install?url=https%3A%2F%2Fgithub.com%2Ffahimalizain%2Fboat-openchamber)

The button opens the desktop app and asks before it fetches anything. Elsewhere,
add `https://github.com/fahimalizain/boat-openchamber` in **Settings → Extensions**.

## What you get

**Work Status section "Boat"** — one line per sandbox with state, size and time
left, a badge while an agent works, and Stop, Extend 1h, Desktop or Resume on the
row. Scoped to the open project, with a muted note for the sandboxes in others.

**Rail panel** — pick a sandbox, read its conversations as a chat, and drive the
agent: a new conversation with a provider and optional model, a reply in an idle
one, or a steer and an interrupt while a turn runs. New events arrive live; a
running turn also polls as a fallback. Every action ends in a toast, and failures
show a banner.

**New sandboxes** — the panel's **New sandbox** button opens a form: start from
an environment, a saved snapshot, or a fork of an existing sandbox; choose a
size, a name and the auto-stop hours. The form shows the plan's capacity, warns
before billing, and defaults the environment to the one that matches the open
project. **Fork** on the selected sandbox opens the same form preset to Fork.
Creation runs in the background and the new sandbox appears selected when it is
ready.

**`@` mentions** — type `@` in the composer and pick under **Sandboxes**: a
conversation becomes a compact transcript (prompts, answers, one line per tool
call, errors) and a sandbox becomes a summary with its conversation list. The
agent gets the text, not the window.

**Agent instructions** — every session learns the sandbox ids, names and states,
plus the `boat exec` / `boat prompt` one-liners. With a project open, the project's
sandboxes are named first in their own scoped instructions.

## Project scoping

A sandbox belongs to the open project when, in priority order:

1. It carries an `openchamber.project` label naming the project — the `owner/repo`
   slug or the folder name, case-insensitive.
2. Its boat environment attaches the project's repository, read from
   `git -C <dir> remote` (origin first) and normalized to `owner/repo`.
3. Its environment name equals the project folder name, case-insensitive.

With no project open, every sandbox shows. The create form defaults to the
environment that matches the open project, so a sandbox created from the panel
lands in it.

## Privacy

- Everything runs on this machine. The extension talks to boat.dev only through
  the boat CLI, with the login you already have; there is no other network call.
- `boat env list` is read for environment names and repository full names only.
  Secret files, variables and setup scripts are dropped at the adapter boundary
  and never logged, cached, returned or emitted.

## Development

```sh
npm run build      # bundle service/main.ts and panel/main.ts
npm run check      # validate the package
npm run typecheck  # tsc --noEmit
npm test           # matcher, mention rows, transcript
```

The bundler and package checker are bun scripts. `scripts/bun.sh` uses a real
`bun` when one is installed and falls back to `npx -y bun@latest`, so either
works. Installing an extension never builds it: `service/main.js` and
`panel/main.js` are committed.

```
shared/    sandbox, conversation and event shapes; route DTOs; transcript; time helpers
service/   main.ts wires HTTP; boat.ts is the CLI adapter; domain/ typed reads;
           data/ caches; project/ scoping; status/ section; mentions/ rows and text;
           create/ validation and the create job; routes/ one module per route group
panel/     main.ts bootstraps; api.ts client; state + data + actions + live + create;
           views/ header, conversation list, conversation, composer, create form, banner
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
