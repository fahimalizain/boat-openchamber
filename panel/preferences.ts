/**
 * The last sandbox, OpenCode agent, model, reasoning variant and tab per
 * project, kept in device storage when the host allows it and in memory
 * otherwise.
 */
import type { GuestStorageOptions, JsonValue } from '@openchamber/sdk';

import { isRecord, readString } from '../shared/json.ts';
import { isPanelTab, type PanelTab } from './tab.ts';

export type ModelChoice = {
  id: string;
  providerID: string;
};

export type Preferences = {
  sandboxId: string | null;
  agent: string | null;
  model: ModelChoice | null;
  variant: string | null;
  tab: PanelTab | null;
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

const readModel = (value: unknown): ModelChoice | null => {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const providerID = readString(value.providerID);
  return id && providerID ? { id, providerID } : null;
};

export const readPreferences = (value: unknown): Preferences | null => {
  if (!isRecord(value)) return null;
  const tab = readString(value.tab);
  return {
    sandboxId: readString(value.sandboxId),
    agent: readString(value.agent),
    model: readModel(value.model),
    variant: readString(value.variant),
    tab: tab && isPanelTab(tab) ? tab : null,
  };
};

const serialize = (preferences: Preferences): JsonValue => ({
  sandboxId: preferences.sandboxId,
  agent: preferences.agent,
  model: preferences.model ? { id: preferences.model.id, providerID: preferences.model.providerID } : null,
  variant: preferences.variant,
  tab: preferences.tab,
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
