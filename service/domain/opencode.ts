/**
 * A sign-in link to the OpenCode web UI inside a sandbox. Two gates stand in
 * front of it: boat's `_token` on the hosted port and OpenCode's own server
 * password. `opencode pair` mints a one-time `/auth/connect/…` link for the
 * second, and boat keeps the path when it trades `_token` for its cookie, so a
 * single URL passes both.
 */
import { isRecord, readString } from '../../shared/json.ts';
import { runBoat } from '../boat.ts';

const MISSING = 'opencode-missing';

/**
 * Starts OpenCode's background service (a no-op when it already runs) and
 * prints its address. Problems go to stdout, not the exit code: a failed
 * `boat exec` exits non-zero with no message worth showing.
 */
const START_SCRIPT = [
  `command -v opencode >/dev/null 2>&1 || { echo ${MISSING}; exit 0; }`,
  'opencode service start >/dev/null 2>&1',
  'opencode service status 2>&1',
].join('\n');

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

const execScript = async (sandboxId: string, script: string): Promise<string> => {
  const data = await runBoat('exec', [sandboxId, '--timeout', '60', '--', script], { timeoutMs: 70_000 });
  return isRecord(data) ? readString(data.stdout) ?? '' : '';
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

export const openOpencodeUrl = async (sandboxId: string): Promise<string> => {
  const status = await execScript(sandboxId, START_SCRIPT);
  if (status.includes(MISSING)) throw new Error('OpenCode is not installed in this sandbox.');
  const port = readServicePort(status);
  if (!port) throw new Error('OpenCode did not start in this sandbox.');

  // `--localhost`: the service listens on 127.0.0.1 only.
  const hosted = readHostedUrl(await runBoat(
    'host',
    [sandboxId, String(port), '--localhost', '--title', 'OpenCode'],
    { timeoutMs: 20_000 },
  ));
  if (!hosted) throw new Error('boat host returned no URL for OpenCode.');

  const pairing = await execScript(sandboxId, `opencode pair --url ${shellQuote(hosted.origin)} 2>&1`);
  const link = readPairLink(pairing, hosted.origin);
  if (!link) throw new Error('OpenCode did not print a sign-in link.');

  if (!hosted.token) return link;
  const url = new URL(link);
  url.searchParams.set('_token', hosted.token);
  return url.toString();
};
