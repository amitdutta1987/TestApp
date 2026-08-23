import type {SqlValue} from '@/database/driver';
import type {DateRange, Page, Sale, SaleItem, SaleWithItems} from '@/types';
import {localDateKey} from '@/utils/date';
import {wrapDbError} from '@/utils/errors';
import {BaseRepository} from './BaseRepository';
import {mapSale, mapSaleItem, type SaleItemRow, type SaleRow} from './mappers';

export interface SaleItemWithSale extends SaleItem {
  saleNumber: string;
  createdAt: string;
}

export class SalesRepository extends BaseRepository {

  async listSales(range: DateRange | null, limit = 30, offset = 0): Promise<Page<Sale>> {
    const where = range ? 'WHERE created_at BETWEEN ? AND ?' : '';
    const params: SqlValue[] = range ? [range.from, range.to] : [];

    try {
      const countResult = await this.driver.execute<{total: number}>(
        `SELECT COUNT(*) AS total FROM sales ${where};`,
        params,
      );
      const total = Number(countResult.rows[0]?.total ?? 0);

      const result = await this.driver.execute<SaleRow>(
        `SELECT id, sale_number, total_amount, created_at FROM sales ${where}
         ORDER BY created_at DESC, rowid DESC
         LIMIT ? OFFSET ?;`,
        [...params, limit, offset],
      );

      return {
        items: result.rows.map(mapSale),
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total,
      };
    } catch (error) {
      throw wrapDbError(error, 'load sales');
    }
  }

  /**
   * Line-level feed. The sales screen shows one row per item (product, qty,
   * price) rather than per receipt, which is what a single-counter shop wants.
   */
  async listSaleItems(
    range: DateRange | null,
    limit = 30,
    offset = 0,
  ): Promise<Page<SaleItemWithSale>> {
    const where = range ? 'WHERE s.created_at BETWEEN ? AND ?' : '';
    const params: SqlValue[] = range ? [range.from, range.to] : [];

    try {
      const countResult = await this.driver.execute<{total: number}>(
        `SELECT COUNT(*) AS total FROM sale_items i JOIN sales s ON s.id = i.sale_id ${where};`,
        params,
      );
      const total = Number(countResult.rows[0]?.total ?? 0);

      const result = await this.driver.execute<
        SaleItemRow & {sale_number: string; created_at: string}
      >(
        `SELECT i.id, i.sale_id, i.product_id, i.barcode, i.product_name,
                i.quantity, i.unit_price, i.total_price,
                s.sale_number, s.created_at
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         ${where}
         ORDER BY s.created_at DESC, s.rowid DESC
         LIMIT ? OFFSET ?;`,
        [...params, limit, offset],
      );

      return {
        items: result.rows.map(row => ({
          ...mapSaleItem(row),
          saleNumber: row.sale_number,
          createdAt: row.created_at,
        })),
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total,
      };
    } catch (error) {
      throw wrapDbError(error, 'load sale items');
    }
  }

  async findSaleWithItems(saleId: string): Promise<SaleWithItems | null> {
    const saleResult = await this.driver.execute<SaleRow>(
      'SELECT id, sale_number, total_amount, created_at FROM sales WHERE id = ?;',
      [saleId],
    );
    const saleRow = saleResult.rows[0];
    if (!saleRow) {
      return null;
    }
    const itemResult = await this.driver.execute<SaleItemRow>(
      `SELECT id, sale_id, product_id, barcode, product_name, quantity, unit_price, total_price
       FROM sale_items WHERE sale_id = ?;`,
      [saleId],
    );
    return {...mapSale(saleRow), items: itemResult.rows.map(mapSaleItem)};
  }

  async summaryForRange(range: DateRange): Promise<{itemsSold: number; revenue: number}> {
    const result = await this.driver.execute<{items_sold: number | null; revenue: number | null}>(
      `SELECT COALESCE(SUM(i.quantity), 0) AS items_sold,
              COALESCE(SUM(i.total_price), 0) AS revenue
       FROM sale_items i
       JOIN sales s ON s.id = i.sale_id
       WHERE s.created_at BETWEEN ? AND ?;`,
      [range.from, range.to],
    );
    const row = result.rows[0];
    return {
      itemsSold: Number(row?.items_sold ?? 0),
      revenue: Number(row?.revenue ?? 0),
    };
  }

  /**
   * Next sequence number for the local day. Sale numbers are per-day counters
   * (S-YYYYMMDD-NNNN), and there is only one device, so a MAX+1 is sufficient.
   */
  async nextSequenceForDay(date: Date): Promise<number> {
    const key = localDateKey(date.toISOString());
    const prefix = `S-${key.replace(/-/g, '')}-`;
    const result = await this.driver.execute<{total: number}>(
      'SELECT COUNT(*) AS total FROM sales WHERE sale_number LIKE ?;',
      [`${prefix}%`],
    );
    return Number(result.rows[0]?.total ?? 0) + 1;
  }

  async listAllForExport(): Promise<SaleItemWithSale[]> {
    const result = await this.driver.execute<
      SaleItemRow & {sale_number: string; created_at: string}
    >(
      `SELECT i.id, i.sale_id, i.product_id, i.barcode, i.product_name,
              i.quantity, i.unit_price, i.total_price,
              s.sale_number, s.created_at
       FROM sale_items i
       JOIN sales s ON s.id = i.sale_id
       ORDER BY s.created_at ASC;`,
    );
    return result.rows.map(row => ({
      ...mapSaleItem(row),
      saleNumber: row.sale_number,
      createdAt: row.created_at,
    }));
  }

  async count(): Promise<number> {
    const result = await this.driver.execute<{total: number}>(
      'SELECT COUNT(*) AS total FROM sales;',
    );
    return Number(result.rows[0]?.total ?? 0);
  }
}
