import type {DashboardStats, Product} from '@/types';
import {todayRange} from '@/utils/date';
import {wrapDbError} from '@/utils/errors';
import {BaseRepository} from './BaseRepository';
import {mapProduct, type ProductRow} from './mappers';

export class StatsRepository extends BaseRepository {

  /**
   * One aggregate pass over products plus one over today's sale items. Both are
   * index-backed, so the dashboard stays fast as the catalogue grows.
   */
  async dashboard(now = new Date()): Promise<DashboardStats> {
    try {
      const productResult = await this.driver.execute<{
        total_products: number | null;
        total_units: number | null;
        low_stock: number | null;
        sold_out: number | null;
        value_cost: number | null;
        value_retail: number | null;
      }>(
        `SELECT COUNT(*) AS total_products,
                COALESCE(SUM(current_quantity), 0) AS total_units,
                COALESCE(SUM(CASE WHEN status = 'LOW_STOCK' THEN 1 ELSE 0 END), 0) AS low_stock,
                COALESCE(SUM(CASE WHEN status = 'SOLD_OUT' THEN 1 ELSE 0 END), 0) AS sold_out,
                COALESCE(SUM(current_quantity * COALESCE(purchase_price, 0)), 0) AS value_cost,
                COALESCE(SUM(current_quantity * selling_price), 0) AS value_retail
         FROM products
         WHERE lifecycle = 'ACTIVE';`,
      );

      const range = todayRange(now);
      const salesResult = await this.driver.execute<{
        items_sold: number | null;
        revenue: number | null;
      }>(
        `SELECT COALESCE(SUM(i.quantity), 0) AS items_sold,
                COALESCE(SUM(i.total_price), 0) AS revenue
         FROM sale_items i
         JOIN sales s ON s.id = i.sale_id
         WHERE s.created_at BETWEEN ? AND ?;`,
        [range.from, range.to],
      );

      const p = productResult.rows[0];
      const s = salesResult.rows[0];

      return {
        totalProducts: Number(p?.total_products ?? 0),
        totalUnits: Number(p?.total_units ?? 0),
        lowStockCount: Number(p?.low_stock ?? 0),
        soldOutCount: Number(p?.sold_out ?? 0),
        todayItemsSold: Number(s?.items_sold ?? 0),
        todayRevenue: Number(s?.revenue ?? 0),
        inventoryValueAtCost: Number(p?.value_cost ?? 0),
        inventoryValueAtRetail: Number(p?.value_retail ?? 0),
      };
    } catch (error) {
      throw wrapDbError(error, 'calculate the dashboard figures');
    }
  }

  /** Shortcut used by the dashboard's "needs attention" strip. */
  async lowStockProducts(limit = 10): Promise<Product[]> {
    const result = await this.driver.execute<ProductRow>(
      `SELECT id, barcode, sku, name, category, brand, description, color, size, material,
              supplier, rack_location, purchase_price, selling_price, minimum_stock,
              current_quantity, status, lifecycle, primary_image, created_at, updated_at
       FROM products
       WHERE lifecycle = 'ACTIVE' AND status IN ('LOW_STOCK','SOLD_OUT')
       ORDER BY current_quantity ASC, name COLLATE NOCASE ASC
       LIMIT ?;`,
      [limit],
    );
    return result.rows.map(mapProduct);
  }

  async tableCounts(): Promise<Record<string, number>> {
    const tables = [
      'products',
      'product_images',
      'sales',
      'sale_items',
      'inventory_transactions',
    ] as const;
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const result = await this.driver.execute<{total: number}>(
        `SELECT COUNT(*) AS total FROM ${table};`,
      );
      counts[table] = Number(result.rows[0]?.total ?? 0);
    }
    return counts;
  }
}
