/** Request context and replies shared by every route module. */
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_CHARS = 96 * 1024;

export type Reply = { status: number; body: unknown };

export type RequestContext = {
  method: string;
  path: string;
  search: URLSearchParams;
  /** The raw request body, read once. */
  body: () => Promise<string>;
  json: <T>() => Promise<T | null>;
  reply: (status: number, body: unknown) => Reply;
};

export const sendReply = (res: ServerResponse, reply: Reply): void => {
  res.writeHead(reply.status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(reply.body));
};

const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk: string) => {
    body += chunk;
    if (body.length > MAX_BODY_CHARS) {
      reject(new Error('Request body is too large.'));
      req.destroy();
    }
  });
  req.on('end', () => resolve(body));
  req.on('error', reject);
});

export const createRequestContext = (req: IncomingMessage, res: ServerResponse): RequestContext => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  let pending: Promise<string> | null = null;

  const body = (): Promise<string> => {
    pending ??= readBody(req);
    return pending;
  };

  return {
    method: req.method ?? 'GET',
    path: url.pathname,
    search: url.searchParams,
    body,
    json: async <T>() => {
      try {
        const parsed: unknown = JSON.parse((await body()) || '{}');
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as T : null;
      } catch {
        return null;
      }
    },
    reply: (status, payload) => ({ status, body: payload }),
  };
};
