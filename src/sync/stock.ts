import type {SqlTransaction} from '@/database/driver';
import {deriveStatus} from '@/utils/stock';

/**
 * A product whose ledger sums to less stock than zero.
 *
 * This is the unavoidable cost of selling offline on more than one device: if
 * two counters are both offline and each sells the last unit, both sales are
 * legitimately recorded and the merged ledger is short. Nothing can prevent it
 * after the fact — the sales really happened — so the app surfaces it instead
 * of hiding it behind a clamp.
 */
export interface StockDiscrepancy {
  productId: string;
  productName: string;
  /** The true ledger sum: negative by definition. */
  ledgerQuantity: number;
}

interface LedgerRow {
  ledger: number | null;
  minimum_stock: number;
  name: string;
}

/**
 * Recomputes current_quantity and status from the inventory ledger.
 *
 * Stock is never synced as a value, only as the signed movements that produced
 * it. Two devices each selling one unit offline would, under last-write-wins on
 * a quantity column, lose one of the sales outright; summing an append-only
 * ledger cannot. That makes stock a conflict-free counter and this function the
 * only place the cached column is written after a merge.
 *
 * Must be called with sync_control.applying = '1', so the UPDATE it issues is
 * not mistaken for a user edit and pushed back to the server. Every device
 * derives the same number from the same ledger; there is nothing to send.
 */
export function recomputeDerivedStock(
  tx: SqlTransaction,
  productIds: readonly string[],
): StockDiscrepancy[] {
  const discrepancies: StockDiscrepancy[] = [];

  for (const productId of productIds) {
    const result = tx.execute<LedgerRow>(
      `SELECT (SELECT COALESCE(SUM(quantity), 0) FROM inventory_transactions t
                WHERE t.product_id = p.id) AS ledger,
              p.minimum_stock, p.name
         FROM products p WHERE p.id = ?;`,
      [productId],
    );
    const row = result.rows[0];
    if (!row) {
      // The ledger can arrive before the product it refers to; the next sync
      // pass recomputes once the product row lands.
      continue;
    }

    const ledger = Number(row.ledger ?? 0);
    if (ledger < 0) {
      discrepancies.push({
        productId,
        productName: row.name,
        ledgerQuantity: ledger,
      });
    }

    // The column has a CHECK (current_quantity >= 0), and a negative would abort
    // the whole merge transaction. Clamping keeps the database valid; the
    // discrepancy above is what keeps the shopkeeper informed.
    const stored = Math.max(ledger, 0);
    tx.execute('UPDATE products SET current_quantity = ?, status = ? WHERE id = ?;', [
      stored,
      deriveStatus(stored, Number(row.minimum_stock)),
      productId,
    ]);
  }

  return discrepancies;
}
