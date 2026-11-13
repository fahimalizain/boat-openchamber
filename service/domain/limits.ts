/** Plan and wallet limits, as far as the section, the create form and mentions need them. */
import { isRecord, readNumber, readString } from '../../shared/json.ts';
import { SANDBOX_SIZES, type SandboxSize } from '../../shared/types.ts';
import { runBoat } from '../boat.ts';

export type PlanSize = {
  id: SandboxSize;
  available: boolean;
  reason: string | null;
};

export type PlanLimits = {
  canStart: boolean;
  blockedReason: string | null;
  active: number | null;
  maxActive: number | null;
  /** The plan's cap on an auto-stop lifetime. */
  autoStopMaxHours: number;
  sizes: PlanSize[];
};

const MAX_TTL_HOURS = 720;
const TRIAL_TTL_HOURS = 2;

const autoStopHoursOf = (record: Record<string, unknown>): number => {
  const gift = isRecord(record.giftLimit) ? record.giftLimit : null;
  const giftSeconds = readNumber(gift?.maxTtlSeconds);
  if (giftSeconds !== null && giftSeconds > 0) return Math.max(1, Math.floor(giftSeconds / 3_600));
  if (readString(record.billingStatus) === 'trialing' || readString(record.accessTier) === 'trial') {
    return TRIAL_TTL_HOURS;
  }
  return MAX_TTL_HOURS;
};

const sizesOf = (record: Record<string, unknown>): PlanSize[] => {
  const rows = Array.isArray(record.machineTypes) ? record.machineTypes.filter(isRecord) : [];
  return SANDBOX_SIZES.map((id): PlanSize => {
    const row = rows.find((entry) => readString(entry.type) === id);
    if (!row) return { id, available: true, reason: null };
    const available = row.available === true;
    return { id, available, reason: available ? null : readString(row.reason) };
  });
};

export const readLimits = async (): Promise<PlanLimits> => {
  const data = await runBoat('limits', [], { timeoutMs: 15_000 });
  const record = isRecord(data) ? data : {};
  return {
    canStart: record.canStart !== false,
    blockedReason: readString(record.blockedReason) ?? readString(record.startBlockedReason),
    active: readNumber(record.activeSandboxes),
    maxActive: readNumber(record.maxActiveSandboxes),
    autoStopMaxHours: autoStopHoursOf(record),
    sizes: sizesOf(record),
  };
};
