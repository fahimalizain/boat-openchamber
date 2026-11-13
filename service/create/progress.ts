/** One line of `boat new` / `boat fork --wait` output. */
import { isRecord, readString } from '../../shared/json.ts';

export type CreateLine = {
  sandboxId: string | null;
  ready: boolean;
  failure: string | null;
};

export const parseCreateLine = (value: unknown): CreateLine | null => {
  if (!isRecord(value)) return null;
  const event = readString(value.event);
  const nested = isRecord(value.error) ? value.error : null;

  return {
    sandboxId: readString(value.id) ?? readString(value.sandboxId),
    ready: event === 'ready',
    failure: event === 'error'
      ? readString(nested?.message) ?? readString(value.error) ?? readString(value.message) ?? 'The create failed.'
      : null,
  };
};
