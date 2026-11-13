/**
 * Reaching an OpenCode server inside a sandbox: start it, read its address and
 * password, host the port, and mint a sign-in link. Two gates stand in front of
 * the web UI: boat's `_token` on the hosted port and OpenCode's own server
 * password. `opencode pair` mints a one-time `/auth/connect/…` link for the
 * second, and boat keeps the path when it trades `_token` for its cookie, so a
 * single URL passes both.
 */
import { isRecord, readString } from '../../shared/json.ts';
import { BoatError, runBoat } from '../boat.ts';

const MISSING = '__BOAT_OPENCODE_MISSING__';

const MARK = {
  status: '__BOAT_OPENCODE_STATUS__',
  password: '__BOAT_OPENCODE_PASSWORD__',
  home: '__BOAT_OPENCODE_HOME__',
  repos: '__BOAT_OPENCODE_REPOS__',
} as const;

const MARKER_PATTERN = /__BOAT_OPENCODE_[A-Z]+__/;

/**
 * Starts OpenCode's background service (a no-op when it already runs) and
 * prints its address, password, home directory and repository directories.
 * Problems go to stdout, not the exit code: a failed `boat exec` exits non-zero
 * with no message worth showing.
 */
const START_SCRIPT = [
  `command -v opencode >/dev/null 2>&1 || { echo ${MISSING}; exit 0; }`,
  'opencode service start >/dev/null 2>&1',
  `echo ${MARK.status}`,
  'opencode service status 2>&1',
  `echo ${MARK.password}`,
  'opencode service get password 2>&1',
  `echo ${MARK.home}`,
  'pwd',
  `echo ${MARK.repos}`,
  // boat environments clone their repositories directly under the home
  // directory. Only that level is considered: hidden toolchains such as .nvm
  // are not projects, and deeper directories belong to a repository already.
  'for d in "$HOME"/*/; do [ -d "$d/.git" ] && printf \'%s\\n\' "${d%/}"; done',
  // The loop's last test is false for a non-repository: never let that (or any
  // other probe) turn the whole exec into a non-zero exit, which boat reports
  // without the stdout we need.
  'exit 0',
].join('\n');

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const execScript = async (sandboxId: string, script: string): Promise<string> => {
  try {
    const data = await runBoat('exec', [sandboxId, '--timeout', '60', '--', script], { timeoutMs: 70_000 });
    return isRecord(data) ? readString(data.stdout) ?? '' : '';
  } catch (failure) {
    // A failed `boat exec` reports the script's own stdout, which here includes
    // OpenCode's password. Keep the two safe codes and drop every other detail.
    if (failure instanceof BoatError && (failure.code === 'missing-cli' || failure.code === 'not-signed-in')) {
      throw failure;
    }
    throw new BoatError('command-failed', 'boat exec could not run in that sandbox.');
  }
};

/** The local port from `opencode service status`, e.g. `http://127.0.0.1:49374`. */
export const readServicePort = (output: string): number | null => {
  const match = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0):(\d+)/.exec(output);
  const port = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null;
};

/** The hosted URL split into its origin and boat's access token. */
export const readHostedUrl = (value: unknown): { origin: string; token: string | null } | null => {
  const url = isRecord(value) ? readString(value.url) : null;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    return { origin: parsed.origin, token: parsed.searchParams.get('_token') };
  } catch {
    return null;
  }
};

/** The first `/auth/connect/…` link `opencode pair` prints for this origin. */
export const readPairLink = (output: string, origin: string): string | null => {
  for (const match of output.matchAll(/https?:\/\/\S+\/auth\/connect\/[\w-]+/g)) {
    if (match[0].startsWith(`${origin}/`)) return match[0];
  }
  return null;
};

const section = (output: string, marker: string): string => {
  const index = output.indexOf(marker);
  if (index < 0) return '';
  const rest = output.slice(index + marker.length);
  const next = rest.search(MARKER_PATTERN);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
};

const absoluteLines = (value: string): string[] => (
  value.split(/\r?\n/).flatMap((line) => {
    const path = line.trim();
    return path.startsWith('/') && !path.includes('\0') ? [path] : [];
  })
);

/**
 * The sandbox's repositories, then its home, as directories the panel can open
 * a session in. Repository paths are sorted so the service picks the same
 * default on every machine.
 */
export const sessionDirectories = (home: string, repos: string[]): string[] => {
  const unique = [...new Set(repos)].sort();
  return [...new Set([...unique, home])];
};

/**
 * The directory a new session starts in. boat clones an environment's
 * repositories directly under the home directory, so the first repository is
 * the project the sandbox exists for; with no repository, home is the only
 * honest choice. The panel can pick any of `sessionDirectories` instead.
 */
export const chooseSessionDirectory = (home: string, repos: string[]): string => (
  [...new Set(repos)].sort()[0] ?? home
);

export type OpencodeService = {
  port: number;
  /** OpenCode's HTTP Basic password. Never leaves the service. */
  password: string;
  home: string;
  repos: string[];
  /** The default session directory, derived from the repositories. */
  directory: string;
  directories: string[];
};

/** Parses the four-section script output; null when OpenCode did not answer. */
export const readOpencodeService = (output: string): OpencodeService | null => {
  if (output.includes(MISSING)) return null;
  const port = readServicePort(section(output, MARK.status));
  const password = section(output, MARK.password)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^[A-Za-z0-9_-]{8,200}$/.test(line)) ?? '';
  const home = absoluteLines(section(output, MARK.home))[0] ?? '';
  const repos = absoluteLines(section(output, MARK.repos)).filter((path) => path !== home);
  if (!port || !/^[A-Za-z0-9_-]{8,200}$/.test(password) || !home) return null;
  return {
    port,
    password,
    home,
    repos,
    directory: chooseSessionDirectory(home, repos),
    directories: sessionDirectories(home, repos),
  };
};

export const ensureOpencodeService = async (sandboxId: string): Promise<OpencodeService> => {
  const output = await execScript(sandboxId, START_SCRIPT);
  if (output.includes(MISSING)) throw new Error('OpenCode is not installed in this sandbox.');
  const service = readOpencodeService(output);
  if (!service) throw new Error('OpenCode did not start in this sandbox.');
  return service;
};

/**
 * Hosts OpenCode's localhost-only port on a private boat URL. The token rides
 * in the URL, so the returned `protected` flag says whether the cookie header
 * is needed.
 */
export const hostOpencode = async (
  sandboxId: string,
  port: number,
): Promise<{ origin: string; token: string | null; protected: boolean }> => {
  // `--localhost`: the service listens on 127.0.0.1 only.
  let raw: unknown;
  try {
    raw = await runBoat(
      'host',
      [sandboxId, String(port), '--localhost', '--title', 'OpenCode'],
      { timeoutMs: 20_000 },
    );
  } catch (failure) {
    if (failure instanceof BoatError && (failure.code === 'missing-cli' || failure.code === 'not-signed-in')) {
      throw failure;
    }
    // A failed host command can echo the URL, whose token must stay in the service.
    throw new BoatError('command-failed', 'boat could not host the OpenCode port.');
  }
  const hosted = readHostedUrl(raw);
  if (!hosted) throw new Error('boat host returned no URL for OpenCode.');
  return { ...hosted, protected: isRecord(raw) && raw.isProtected === true };
};

export const openOpencodeUrl = async (sandboxId: string): Promise<string> => {
  const service = await ensureOpencodeService(sandboxId);
  const hosted = await hostOpencode(sandboxId, service.port);

  const pairing = await execScript(sandboxId, `opencode pair --url ${shellQuote(hosted.origin)} 2>&1`);
  const link = readPairLink(pairing, hosted.origin);
  if (!link) throw new Error('OpenCode did not print a sign-in link.');

  if (!hosted.token) return link;
  const url = new URL(link);
  url.searchParams.set('_token', hosted.token);
  return url.toString();
};
