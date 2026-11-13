/**
 * A git remote or a repository full name as `owner/repo`, lower-case. Handles
 * the scp-like, ssh, https and git forms, credentials, a trailing slash and a
 * `.git` suffix. Returns null for anything that is not a repository path.
 */
export const normalizeRepoSlug = (value: string): string | null => {
  const text = value.trim();
  if (!text) return null;

  const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(text);
  if (scp?.[2]) return fromPath(scp[2]);

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      return fromPath(new URL(text).pathname);
    } catch {
      return null;
    }
  }

  return fromPath(text);
};

const fromPath = (path: string): string | null => {
  const parts = path.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const repo = parts[parts.length - 1]?.replace(/\.git$/i, '').toLowerCase() ?? '';
  const owner = parts[parts.length - 2]?.toLowerCase() ?? '';
  if (!/^[a-z0-9._-]+$/.test(owner) || !/^[a-z0-9._-]+$/.test(repo)) return null;
  return `${owner}/${repo}`;
};
