import {getDriver} from '@/database/database';
import type {SqlDriver, SqlTransaction} from '@/database/driver';
import type {InventoryTransactionType, Sale, SaleItem, SaleResult} from '@/types';
import {localDateKey, nowIso} from '@/utils/date';
import {AppError, InsufficientStockError, wrapDbError} from '@/utils/errors';
import {buildSaleNumber, deviceTagFrom, generateId} from '@/utils/id';
import {assertValidQuantity, deriveStatus} from '@/utils/stock';

export interface StockChangeResult {
  productId: string;
  quantityBefore: number;
  quantityAfter: number;
}

export interface InventoryServiceContract {
  sellProduct(productId: string, quantity: number): Promise<SaleResult>;
  addStock(productId: string, quantity: number, notes?: string): Promise<StockChangeResult>;
}

interface ProductStockRow {
  id: string;
  name: string;
  barcode: string;
  selling_price: number;
  minimum_stock: number;
  current_quantity: number;
}

/**
 * Reads this install's device tag inside the open transaction.
 *
 * sync_control is device-local and never synced, so this is a cheap local read
 * rather than anything the network could delay — which matters, because it sits
 * on the scan-to-sell path.
 */
function loadDeviceTag(tx: SqlTransaction): string | null {
  const result = tx.execute<{value: string}>(
    "SELECT value FROM sync_control WHERE key = 'device_id';",
  );
  return deviceTagFrom(result.rows[0]?.value ?? null);
}

/**
 * Reads the product row inside the open transaction. Doing the read here rather
 * than before BEGIN is the whole point: under BEGIN IMMEDIATE nothing can change
 * the quantity between the check and the write, so on *this* device overselling
 * is impossible. Across devices that were offline it is not preventable at all;
 * src/sync/stock.ts reconciles and reports it instead.
 */
function loadStockRow(tx: SqlTransaction, productId: string): ProductStockRow {
  const result = tx.execute<ProductStockRow>(
    `SELECT id, name, barcode, selling_price, minimum_stock, current_quantity
     FROM products WHERE id = ?;`,
    [productId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError('PRODUCT_NOT_FOUND', 'That product no longer exists.');
  }
  return row;
}

function writeStock(
  tx: SqlTransaction,
  productId: string,
  quantity: number,
  minimumStock: number,
  timestamp: string,
): void {
  tx.execute('UPDATE products SET current_quantity = ?, status = ?, updated_at = ? WHERE id = ?;', [
    quantity,
    deriveStatus(quantity, minimumStock),
    timestamp,
    productId,
  ]);
}

function writeTransaction(
  tx: SqlTransaction,
  args: {
    productId: string;
    type: InventoryTransactionType;
    /** Signed delta: negative for outgoing stock. */
    quantity: number;
    before: number;
    after: number;
    referenceId?: string | null;
    notes?: string | null;
    timestamp: string;
  },
): void {
  tx.execute(
    `INSERT INTO inventory_transactions
       (id, product_id, type, quantity, quantity_before, quantity_after,
        reference_id, notes, created_at)
     VALUES (?,?,?,?,?,?,?,?,?);`,
    [
      generateId('itx'),
      args.productId,
      args.type,
      args.quantity,
      args.before,
      args.after,
      args.referenceId ?? null,
      args.notes ?? null,
      args.timestamp,
    ],
  );
}

export class InventoryService implements InventoryServiceContract {
  constructor(private readonly injectedDriver?: SqlDriver) {}

  /** Resolved per call so an instance created before initDatabase() still works. */
  private get driver(): SqlDriver {
    return this.injectedDriver ?? getDriver();
  }

  /**
   * Sells `quantity` units in one SQLite transaction. Either all four writes
   * land (product, sale, sale_item, inventory_transaction) or none do.
   */
  async sellProduct(productId: string, quantity: number): Promise<SaleResult> {
    assertValidQuantity(quantity, 'Sale quantity');

    try {
      return await this.driver.transaction(tx => {
        const product = loadStockRow(tx, productId);

        if (quantity > product.current_quantity) {
          // Throwing rolls the transaction back; stock is left untouched.
          throw new InsufficientStockError(product.current_quantity, quantity, product.name);
        }

        const timestamp = nowIso();
        const now = new Date(timestamp);
        const quantityAfter = product.current_quantity - quantity;

        // Per-day sequence, read inside the transaction so two rapid sales
        // cannot claim the same sale number. The prefix must use the same local
        // date that buildSaleNumber stamps on: keying the count off the UTC date
        // instead makes the counter restart mid-day in any offset timezone, and
        // the second sale then reuses a sale_number that is UNIQUE.
        //
        // The LIKE also spans sales pulled from other devices, so the counter
        // continues across the merged day rather than restarting per device.
        const datePrefix = `S-${localDateKey(timestamp).replace(/-/g, '')}-`;
        const seqResult = tx.execute<{total: number}>(
          'SELECT COUNT(*) AS total FROM sales WHERE sale_number LIKE ?;',
          [`${datePrefix}%`],
        );
        const sequence = Number(seqResult.rows[0]?.total ?? 0) + 1;

        const saleId = generateId('sal');
        // The device tag is what stops two counters minting the same number for
        // different sales; see buildSaleNumber.
        const saleNumber = buildSaleNumber(now, sequence, loadDeviceTag(tx));
        const unitPrice = product.selling_price;
        const totalPrice = Number((unitPrice * quantity).toFixed(2));

        tx.execute(
          'INSERT INTO sales (id, sale_number, total_amount, created_at) VALUES (?,?,?,?);',
          [saleId, saleNumber, totalPrice, timestamp],
        );

        const saleItemId = generateId('sit');
        tx.execute(
          `INSERT INTO sale_items
             (id, sale_id, product_id, barcode, product_name, quantity, unit_price, total_price)
           VALUES (?,?,?,?,?,?,?,?);`,
          [
            saleItemId,
            saleId,
            productId,
            product.barcode,
            product.name,
            quantity,
            unitPrice,
            totalPrice,
          ],
        );

        writeStock(tx, productId, quantityAfter, product.minimum_stock, timestamp);

        writeTransaction(tx, {
          productId,
          type: 'SALE',
          quantity: -quantity,
          before: product.current_quantity,
          after: quantityAfter,
          referenceId: saleId,
          notes: saleNumber,
          timestamp,
        });

        const sale: Sale = {
          id: saleId,
          saleNumber,
          totalAmount: totalPrice,
          createdAt: timestamp,
        };
        const item: SaleItem = {
          id: saleItemId,
          saleId,
          productId,
          barcode: product.barcode,
          productName: product.name,
          quantity,
          unitPrice,
          totalPrice,
        };

        return {sale, items: [item], remainingStock: {[productId]: quantityAfter}};
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw wrapDbError(error, 'complete the sale');
    }
  }

  async addStock(productId: string, quantity: number, notes?: string): Promise<StockChangeResult> {
    return this.applyDelta(productId, quantity, 'STOCK_IN', notes ?? 'Stock added');
  }

  /** Reverses a sale's effect on stock without deleting the sale record. */
  async recordReturn(
    productId: string,
    quantity: number,
    notes?: string,
  ): Promise<StockChangeResult> {
    return this.applyDelta(productId, quantity, 'RETURN', notes ?? 'Customer return');
  }

  async recordDamage(
    productId: string,
    quantity: number,
    notes?: string,
  ): Promise<StockChangeResult> {
    return this.applyDelta(productId, -quantity, 'DAMAGE', notes ?? 'Damaged / written off');
  }

  /**
   * Sets stock to an absolute counted figure (stock-take). Records the signed
   * difference so the history still reconciles.
   */
  async adjustTo(
    productId: string,
    countedQuantity: number,
    notes?: string,
  ): Promise<StockChangeResult> {
    if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
      throw new AppError('INVALID_QUANTITY', 'Counted quantity must be zero or a whole number.');
    }

    try {
      return await this.driver.transaction(tx => {
        const product = loadStockRow(tx, productId);
        const delta = countedQuantity - product.current_quantity;
        if (delta === 0) {
          return {
            productId,
            quantityBefore: product.current_quantity,
            quantityAfter: product.current_quantity,
          };
        }
        const timestamp = nowIso();
        writeStock(tx, productId, countedQuantity, product.minimum_stock, timestamp);
        writeTransaction(tx, {
          productId,
          type: 'STOCK_ADJUSTMENT',
          quantity: delta,
          before: product.current_quantity,
          after: countedQuantity,
          notes: notes ?? 'Stock count adjustment',
          timestamp,
        });
        return {
          productId,
          quantityBefore: product.current_quantity,
          quantityAfter: countedQuantity,
        };
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw wrapDbError(error, 'adjust the stock');
    }
  }

  private async applyDelta(
    productId: string,
    delta: number,
    type: InventoryTransactionType,
    notes: string,
  ): Promise<StockChangeResult> {
    assertValidQuantity(Math.abs(delta), 'Quantity');

    try {
      return await this.driver.transaction(tx => {
        const product = loadStockRow(tx, productId);
        const quantityAfter = product.current_quantity + delta;

        if (quantityAfter < 0) {
          throw new InsufficientStockError(product.current_quantity, Math.abs(delta), product.name);
        }

        const timestamp = nowIso();
        writeStock(tx, productId, quantityAfter, product.minimum_stock, timestamp);
        writeTransaction(tx, {
          productId,
          type,
          quantity: delta,
          before: product.current_quantity,
          after: quantityAfter,
          notes,
          timestamp,
        });

        return {
          productId,
          quantityBefore: product.current_quantity,
          quantityAfter,
        };
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw wrapDbError(error, 'update the stock');
    }
  }
}

export const inventoryService = new InventoryService();
