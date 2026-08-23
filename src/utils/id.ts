/**
 * Local-only identifiers. There is no server to coordinate with, but ids still
 * need to survive a backup being restored onto a different phone, so they are
 * random rather than sequential.
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

/** Human-facing sale reference, e.g. "S-20260823-0007". */
export function buildSaleNumber(date: Date, sequenceForDay: number): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `S-${y}${m}${d}-${String(sequenceForDay).padStart(4, '0')}`;
}
