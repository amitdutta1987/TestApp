import type {SqlValue} from '@/database/driver';
import type {
  DateRange,
  InventoryTransaction,
  InventoryTransactionType,
  InventoryTransactionWithProduct,
  Page,
} from '@/types';
import {wrapDbError} from '@/utils/errors';
import {BaseRepository} from './BaseRepository';
import {
  mapInventoryTransaction,
  mapInventoryTransactionWithProduct,
  type InventoryTransactionRow,
} from './mappers';

const TX_COLUMNS = `
  id, product_id, type, quantity, quantity_before, quantity_after,
  reference_id, notes, created_at
`;

export class InventoryRepository extends BaseRepository {

  /** Audit trail for one product, newest first. */
  async listForProduct(
    productId: string,
    limit = 50,
    offset = 0,
  ): Promise<Page<InventoryTransaction>> {
    try {
      const countResult = await this.driver.execute<{total: number}>(
        'SELECT COUNT(*) AS total FROM inventory_transactions WHERE product_id = ?;',
        [productId],
      );
      const total = Number(countResult.rows[0]?.total ?? 0);

      const result = await this.driver.execute<InventoryTransactionRow>(
        `SELECT ${TX_COLUMNS} FROM inventory_transactions
         WHERE product_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ? OFFSET ?;`,
        [productId, limit, offset],
      );

      return {
        items: result.rows.map(mapInventoryTransaction),
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total,
      };
    } catch (error) {
      throw wrapDbError(error, 'load the stock history');
    }
  }

  async listAll(
    options: {range?: DateRange | null; type?: InventoryTransactionType | null} = {},
    limit = 50,
    offset = 0,
  ): Promise<Page<InventoryTransactionWithProduct>> {
    const where: string[] = [];
    const params: SqlValue[] = [];

    if (options.range) {
      where.push('t.created_at BETWEEN ? AND ?');
      params.push(options.range.from, options.range.to);
    }
    if (options.type) {
      where.push('t.type = ?');
      params.push(options.type);
    }
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    try {
      const countResult = await this.driver.execute<{total: number}>(
        `SELECT COUNT(*) AS total FROM inventory_transactions t ${whereSql};`,
        params,
      );
      const total = Number(countResult.rows[0]?.total ?? 0);

      const result = await this.driver.execute<
        InventoryTransactionRow & {product_name: string; barcode: string}
      >(
        `SELECT t.id, t.product_id, t.type, t.quantity, t.quantity_before, t.quantity_after,
                t.reference_id, t.notes, t.created_at,
                p.name AS product_name, p.barcode AS barcode
         FROM inventory_transactions t
         JOIN products p ON p.id = t.product_id
         ${whereSql}
         ORDER BY t.created_at DESC, t.rowid DESC
         LIMIT ? OFFSET ?;`,
        [...params, limit, offset],
      );

      return {
        items: result.rows.map(mapInventoryTransactionWithProduct),
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total,
      };
    } catch (error) {
      throw wrapDbError(error, 'load inventory transactions');
    }
  }

  /** Unpaginated feed for the Excel export. */
  async listAllForExport(): Promise<InventoryTransactionWithProduct[]> {
    const result = await this.driver.execute<
      InventoryTransactionRow & {product_name: string; barcode: string}
    >(
      `SELECT t.id, t.product_id, t.type, t.quantity, t.quantity_before, t.quantity_after,
              t.reference_id, t.notes, t.created_at,
              p.name AS product_name, p.barcode AS barcode
       FROM inventory_transactions t
       JOIN products p ON p.id = t.product_id
       ORDER BY t.created_at ASC;`,
    );
    return result.rows.map(mapInventoryTransactionWithProduct);
  }

  async count(): Promise<number> {
    const result = await this.driver.execute<{total: number}>(
      'SELECT COUNT(*) AS total FROM inventory_transactions;',
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}
