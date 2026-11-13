/**
 * The last sandbox, provider and model per project, kept in device storage when
 * the host allows it and in memory otherwise.
 */
import type { GuestStorageOptions, JsonValue } from '@openchamber/sdk';

import { isRecord, readString } from '../shared/json.ts';

export type Preferences = {
  sandboxId: string | null;
  provider: string | null;
  model: string | null;
  reasoning: string | null;
};

export type PreferencesStorage = {
  get: (key: string, options?: GuestStorageOptions) => Promise<JsonValue | undefined>;
  set: (key: string, value: JsonValue, options?: GuestStorageOptions) => Promise<void>;
};

export type PreferenceStore = {
  get: (directory: string | null) => Promise<Preferences | null>;
  save: (directory: string | null, preferences: Preferences) => Promise<void>;
};

const slug = (directory: string): string => {
  const text = directory.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return text || 'root';
};

/** FNV-1a, so two folders that slug the same stay apart. */
const hash = (text: string): string => {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
};

export const preferenceKey = (directory: string | null): string => (
  directory ? `boat.prefs.${slug(directory)}.${hash(directory)}` : 'boat.prefs.global'
);

export const readPreferences = (value: unknown): Preferences | null => {
  if (!isRecord(value)) return null;
  return {
    sandboxId: readString(value.sandboxId),
    provider: readString(value.provider),
    model: readString(value.model),
    reasoning: readString(value.reasoning),
  };
};

const serialize = (preferences: Preferences): JsonValue => ({
  sandboxId: preferences.sandboxId,
  provider: preferences.provider,
  model: preferences.model,
  reasoning: preferences.reasoning,
});

export const createPreferences = (options: {
  storage: PreferencesStorage | null;
  device: boolean;
}): PreferenceStore => {
  const memory = new Map<string, Preferences>();
  const scope: GuestStorageOptions = { scope: 'device' };
  let useDevice = options.device && options.storage !== null;

  const fromMemory = (key: string): Preferences | null => memory.get(key) ?? null;

  return {
    get: async (directory) => {
      const key = preferenceKey(directory);
      if (!useDevice || !options.storage) return fromMemory(key);
      try {
        return readPreferences(await options.storage.get(key, scope)) ?? fromMemory(key);
      } catch {
        // An older host refuses device storage; memory keeps this session usable.
        useDevice = false;
        return fromMemory(key);
      }
    },
    save: async (directory, preferences) => {
      const key = preferenceKey(directory);
      memory.set(key, preferences);
      if (!useDevice || !options.storage) return;
      try {
        await options.storage.set(key, serialize(preferences), scope);
      } catch {
        useDevice = false;
      }
    },
  };
};
