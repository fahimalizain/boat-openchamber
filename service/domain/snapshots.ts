/** Saved snapshots usable with `boat new --from`; only the ready ones. */
import { isRecord, readNumber, readString } from '../../shared/json.ts';
import { runBoat } from '../boat.ts';

export type SavedSnapshot = {
  name: string;
  type: string | null;
  createdAt: string | null;
  sizeBytes: number | null;
};

export const listSavedSnapshots = async (): Promise<SavedSnapshot[]> => {
  const data = await runBoat('snapshots', [], { timeoutMs: 20_000 });
  const rows = isRecord(data) && Array.isArray(data.named) ? data.named : [];

  return rows
    .filter(isRecord)
    .flatMap((row) => {
      const name = readString(row.name);
      if (!name || readString(row.status) !== 'ready') return [];
      return [{
        name,
        type: readString(row.type),
        createdAt: readString(row.createdAt),
        sizeBytes: readNumber(row.sizeBytes),
      }];
    })
    .sort((left, right) => (Date.parse(right.createdAt ?? '') || 0) - (Date.parse(left.createdAt ?? '') || 0));
};
