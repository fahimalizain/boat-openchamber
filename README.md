# Boat for OpenChamber

Your [boat.dev](https://boat.dev) cloud sandboxes, at a glance inside OpenChamber's
Work Status panel: state, size and time left before auto-stop, with Stop, Extend
and Desktop a click away. Every agent session also learns which sandboxes exist
and how to reach them with the `boat` CLI.

## Install

OpenChamber 2.7.0 or newer, and the `boat` CLI signed in on the same machine
(`boat status` should answer). Install from the repository URL in
Settings → Extensions, or with this link in the desktop app:

```markdown
[Install Boat](openchamber://extensions/install?url=https%3A%2F%2Fgithub.com%2Ffahimalizain%2Fboat-openchamber)
```

## Layout

```
shared/            contracts both sides import
  types.ts         sandbox, conversation, event shapes; state helpers
  routes.ts        request/response DTOs; status row action ids
  events.ts        guard for events arriving over emit
  agent.ts         the seven providers
  json.ts          guards and text helpers

service/
  main.ts          env, auth, health, router, listen
  boat.ts          the CLI adapter: binary, argv, JSON
  http.ts          request context and replies
  router.ts        exact method/path table
  context.ts       composition root: caches, followers, status view
  warm.ts          what runs after every sandbox refresh
  followers.ts     one `boat events --follow` per watched conversation
  instructions.ts  keeps the agent-facing text current
  project/scope.ts the project matcher seam for phase 2.5
  domain/          typed CLI reads and commands (sandboxes, conversations, events, agent, limits)
  data/            caches behind small interfaces (sandbox list, conversations, desktop, agents, plan note)
  status/          the Work Status section (view, instruction text, row actions)
  routes/          one module per route group (status, sandboxes, conversations, events, agent, schedule)

panel/
  main.ts          bootstrap: connectHost + onReady
  app.ts           builds views, wires timers and service events
  api.ts           typed serviceRequest wrappers
  store.ts         composes the state cell, loaders, actions and live feed
  state.ts         PanelState, the cell, banners
  data.ts          sandboxes, conversations and history loaders
  actions.ts       prompts, steers, interrupts, sandbox commands
  live.ts          emitted events, running poll, watch pings
  format.ts        time left, time ago, a local clock
  kit.ts           DOM helpers and button slots
  views/           sandbox header, conversation list, conversation view, composer, banner
```

## What it does

- **Rail panel "Boat"** — pick a sandbox, see its state and time left, and
  Stop, Extend 1h, Resume or open its Desktop. Its conversations are listed with
  harness, model, last prompt, prompt count and a running badge. Open one to
  read the agent's work as a chat: prompts, answers (live while it writes), one
  line per tool call, and errors called out.
- **Composer** — a new conversation with a provider and an optional model, a
  reply in an idle conversation (`boat prompt --resume`), or a steer and an
  Interrupt while a turn runs. Every result ends in a toast, and a failed call
  says why in a banner.
- **Live events** — watching a conversation runs
  `boat events <id> --convo <c> --follow --json` in the service, which forwards
  new events to the panel in batches. Nothing replays, so the panel reads the
  history first and de-duplicates by event id. The follower stops when the panel
  unwatches, after two minutes without a ping, or when the service stops.
- **Work Status section "Boat"** — one line per sandbox, polled every 5 seconds,
  with Stop, Extend 1h, Desktop and Resume, a badge when an agent is running,
  and rows that say what to do when there are no sandboxes, the CLI is missing,
  or the account is at its sandbox limit.
- **Instructions** — a short list of sandbox ids, names and states is handed to
  every agent session, plus the `boat exec` / `boat prompt` one-liners.
- **Scheduled refresh** — a 15-minute wake-up keeps the instructions current
  while no panel is open.

The Desktop action opens the sandbox's desktop URL; it is a link chip in the row
because a service cannot open a window itself. The URL is fetched in the
background and cached for five minutes.

## Requirements

- OpenChamber 2.7.0+ (web or desktop; VS Code and phone load no extensions).
- The `boat` CLI, found on `PATH` or at `~/.ascii/bin/boat`. Set `BOAT_BIN` to
  override the location.

## Development

```sh
npm run build   # bundle service/main.ts -> service/main.js
npm run check   # validate the package
```

The built `service/main.js` and `panel/main.js` are committed: installing an
extension never builds it.

### Service routes

| Route | What it does |
|---|---|
| `GET /status` · `POST /status` | Work Status rows, and the action a click posts |
| `GET /sandboxes` | Sandboxes for the picker, from the cached `boat list` |
| `GET /conversations?sandbox=` | Conversations with harness, model, prompt count and `running` |
| `GET /history?sandbox=&conversation=` | The last 200 events, normalised for the chat |
| `POST /watch` · `POST /unwatch` | Start or re-ping a follower, and stop it |
| `POST /prompt` · `POST /steer` · `POST /interrupt` | Drive the agent; `prompt` returns as soon as the CLI names the conversation |
| `POST /action` | `stop`, `extend`, `resume`, or the desktop URL to open |

`service.keepRunning` is not set: the panel's requests (and its 20-second
watcher ping) keep the service awake while it is open, and ten quiet minutes
after it closes the service stops, taking its followers with it.

Try the service by hand:

```sh
OPENCHAMBER_SERVICE_PORT=4599 OPENCHAMBER_SERVICE_TOKEN=t node service/main.js &
curl -H 'Authorization: Bearer t' localhost:4599/health
curl -H 'Authorization: Bearer t' localhost:4599/status
```

## License

MIT © Fahim Ali Zain
