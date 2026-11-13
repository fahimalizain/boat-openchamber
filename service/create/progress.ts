/** One line of `boat new` / `boat fork --wait` output, flat or wrapped. */
import { isRecord, readString } from '../../shared/json.ts';
import { readBoatLine } from '../boat.ts';

export type CreateLine = {
  sandboxId: string | null;
  ready: boolean;
  failure: string | null;
};

export const parseCreateLine = (value: unknown): CreateLine | null => {
  const line = readBoatLine(value);
  if (!line) return null;
  const record = line.value;
  const event = readString(record.event) ?? line.event;
  const nested = isRecord(record.error) ? record.error : null;

  return {
    sandboxId: readString(record.id) ?? readString(record.sandboxId),
    ready: event === 'ready',
    failure: event === 'error'
      ? readString(nested?.message) ?? readString(record.error) ?? readString(record.message) ?? 'The create failed.'
      : null,
  };
};
