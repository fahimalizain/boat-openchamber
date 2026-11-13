/** A twelve-line table router: exact method and path, no patterns. */
import type { Reply, RequestContext } from './http.ts';

export type RouteHandler = (context: RequestContext) => Promise<Reply>;
export type Route = { method: 'GET' | 'POST'; path: string; handler: RouteHandler };

export const route = (method: Route['method'], path: string, handler: RouteHandler): Route => ({
  method,
  path,
  handler,
});

export const createRouter = (routes: Route[]): ((context: RequestContext) => Promise<Reply | null>) => {
  const table = new Map<string, RouteHandler>();
  for (const entry of routes) {
    const key = `${entry.method} ${entry.path}`;
    if (table.has(key)) throw new Error(`Boat service: duplicate route ${key}.`);
    table.set(key, entry.handler);
  }
  return async (context) => table.get(`${context.method} ${context.path}`)?.(context) ?? null;
};
