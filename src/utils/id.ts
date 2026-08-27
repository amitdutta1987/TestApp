/**
 * Identifiers that stay unique without a coordinator.
 *
 * Row ids are random rather than sequential so they survive a backup restored
 * onto another phone, and so two devices inventing rows offline cannot collide.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChunk(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Time-ordered id: a base-36 timestamp prefix keeps rows roughly insertion-ordered
 * in the index, and the random suffix makes collisions negligible.
 */
export function generateId(prefix = ''): string {
  const timePart = Date.now().toString(36);
  const id = `${timePart}${randomChunk(10)}`;
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Short, human-readable tag identifying which counter rang a sale up.
 *
 * Three hex characters: long enough that a shop running a handful of devices
 * will not collide, short enough to stay readable on a receipt.
 */
export function deviceTagFrom(deviceId: string | null | undefined): string | null {
  if (!deviceId) {
    return null;
  }
  const cleaned = deviceId.replace(/[^a-z0-9]/gi, '');
  if (cleaned.length < 3) {
    return null;
  }
  return cleaned.slice(-3).toUpperCase();
}

/**
 * Human-facing sale reference, e.g. "S-20260823-0007-A3F".
 *
 * The per-day sequence is counted locally, so two devices selling offline can
 * both reach 0007. The device tag is what keeps the number unique — without it
 * the second device's sale is dropped by the UNIQUE index on sale_number, and
 * its sale_items then fail their foreign key on merge.
 *
 * The tag is omitted when there is none, which keeps sale numbers recorded
 * before this existed exactly as they were.
 */
export function buildSaleNumber(
  date: Date,
  sequenceForDay: number,
  deviceTag?: string | null,
): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const base = `S-${y}${m}${d}-${String(sequenceForDay).padStart(4, '0')}`;
  return deviceTag ? `${base}-${deviceTag}` : base;
}
