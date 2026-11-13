/** Guards and small readers used by the service and the panel. */

export const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const readString = (value: unknown): string | null => (
  typeof value === 'string' && value.trim().length > 0 ? value : null
);

export const readNumber = (value: unknown): number | null => (
  typeof value === 'number' && Number.isFinite(value) ? value : null
);

export const clip = (text: string, max: number): string => (
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`
);
