/** Plan and wallet limits, only as far as the status section needs them. */
import { isRecord, readNumber, readString } from '../../shared/json.ts';
import { runBoat } from '../boat.ts';

export type PlanLimits = {
  canStart: boolean;
  blockedReason: string | null;
  active: number | null;
  maxActive: number | null;
};

export const readLimits = async (): Promise<PlanLimits> => {
  const data = await runBoat('limits', [], { timeoutMs: 15_000 });
  const record = isRecord(data) ? data : {};
  return {
    canStart: record.canStart !== false,
    blockedReason: readString(record.blockedReason) ?? readString(record.startBlockedReason),
    active: readNumber(record.activeSandboxes),
    maxActive: readNumber(record.maxActiveSandboxes),
  };
};
