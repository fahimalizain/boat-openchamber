/**
 * The default AI profile's connected credential names. Only the `connected`
 * list is read; keys, accounts and every other field stay in the CLI's output.
 */
import { isRecord } from '../../shared/json.ts';
import { runBoat } from '../boat.ts';

export type ConnectedCredentials = {
  get: () => Promise<string[] | null>;
};

export const createConnectedCredentials = (options: { ttlMs: number }): ConnectedCredentials => {
  let names: string[] | null = null;
  let loadedAt = 0;
  let loading: Promise<string[] | null> | null = null;

  const load = async (): Promise<string[] | null> => {
    try {
      const data = await runBoat('ai', ['profiles'], { timeoutMs: 15_000 });
      const profiles = isRecord(data) && Array.isArray(data.profiles) ? data.profiles.filter(isRecord) : [];
      const chosen = profiles.find((profile) => profile.isDefault === true) ?? profiles[0] ?? null;
      names = chosen && Array.isArray(chosen.connected)
        ? chosen.connected.filter((entry): entry is string => typeof entry === 'string')
        : [];
    } catch {
      // Unknown: the panel treats every model as available.
      names = null;
    }
    loadedAt = Date.now();
    return names;
  };

  return {
    get: async () => {
      if (loadedAt > 0 && Date.now() - loadedAt < options.ttlMs) return names;
      if (loading) return loading;
      loading = load().finally(() => {
        loading = null;
      });
      return loading;
    },
  };
};
