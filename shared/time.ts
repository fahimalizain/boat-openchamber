/** Relative and absolute times, shared by the panel and the mention text. */

export const remaining = (iso: string | null): string => {
  if (!iso) return '';
  const milliseconds = Date.parse(iso) - Date.now();
  if (!Number.isFinite(milliseconds)) return '';
  if (milliseconds <= 0) return 'stopping';
  const minutes = Math.max(1, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h left` : `${hours}h ${rest}m left`;
};

/** How long ago an epoch-millisecond stamp was, as OpenCode reports times. */
export const timeAgoAt = (at: number): string => {
  if (!Number.isFinite(at) || at <= 0) return '';
  const milliseconds = Date.now() - at;
  if (milliseconds < 60_000) return 'just now';
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};
