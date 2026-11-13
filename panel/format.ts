/** Text helpers the panel shows: time left, time ago, a local clock. */

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

export const timeAgo = (iso: string | null): string => {
  if (!iso) return '';
  const milliseconds = Date.now() - Date.parse(iso);
  if (!Number.isFinite(milliseconds) || milliseconds < 60_000) return 'just now';
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

export const clock = (iso: string | null): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const messageOf = (failure: unknown): string => (
  failure instanceof Error && failure.message ? failure.message : 'Boat did not answer.'
);
