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

## What it does

- **Work Status section "Boat"** — one line per sandbox, polled every 5 seconds.
  Running sandboxes show their state, machine size and remaining lifetime, with
  **Stop**, **Extend 1h** and a **Desktop** link to the sandbox's streamed
  desktop. Stopped ones show **Resume**. Rows say what to do when there are no
  sandboxes, the CLI is missing, or the account is at its sandbox limit.
- **Instructions** — a short list of sandbox ids, names and states is handed to
  every agent session, plus the `boat exec` / `boat prompt` one-liners, so an
  agent can work in a sandbox without being told the id.
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

The built `service/main.js` is committed: installing an extension never builds it.

Try the service by hand:

```sh
OPENCHAMBER_SERVICE_PORT=4599 OPENCHAMBER_SERVICE_TOKEN=t node service/main.js &
curl -H 'Authorization: Bearer t' localhost:4599/health
curl -H 'Authorization: Bearer t' localhost:4599/status
```

## License

MIT © Fahim Ali Zain
