/**
 * The table contract, shared by push and pull.
 *
 * Kept in one place so a column added to the app's schema cannot be accepted by
 * push but forgotten by pull, which would leave one device holding data no
 * other device ever sees.
 */

export type MergeStrategy = 'APPEND' | 'LWW';

export interface TableSpec {
  /** Primary key column. */
  pk: string;
  strategy: MergeStrategy;
  /** Column that decides a last-write-wins contest. */
  lwwColumn?: string;
  /** Columns accepted from a client, in insert order. */
  columns: string[];
}

export const TABLES: Record<string, TableSpec> = {
  products: {
    pk: 'id',
    strategy: 'LWW',
    lwwColumn: 'metadata_updated_at',
    /**
     * current_quantity and status are absent by design — they are derived from
     * the ledger, and a client that sent them would be ignored. See schema.sql.
     */
    columns: [
      'id', 'barcode', 'sku', 'name', 'category', 'brand', 'description',
      'color', 'size', 'material', 'supplier', 'rack_location',
      'purchase_price', 'selling_price', 'minimum_stock', 'lifecycle',
      'primary_image', 'created_at', 'updated_at', 'metadata_updated_at',
    ],
  },
  product_images: {
    pk: 'id',
    strategy: 'LWW',
    lwwColumn: 'created_at',
    columns: ['id', 'product_id', 'image_uri', 'is_primary', 'created_at'],
  },
  sales: {
    pk: 'id',
    strategy: 'APPEND',
    columns: ['id', 'sale_number', 'total_amount', 'created_at'],
  },
  sale_items: {
    pk: 'id',
    strategy: 'APPEND',
    columns: [
      'id', 'sale_id', 'product_id', 'barcode', 'product_name',
      'quantity', 'unit_price', 'total_price',
    ],
  },
  inventory_transactions: {
    pk: 'id',
    strategy: 'APPEND',
    columns: [
      'id', 'product_id', 'type', 'quantity', 'quantity_before',
      'quantity_after', 'reference_id', 'notes', 'created_at',
    ],
  },
  app_settings: {
    pk: 'key',
    strategy: 'LWW',
    lwwColumn: 'updated_at',
    columns: ['key', 'value', 'updated_at'],
  },
};

/**
 * Push order. Parents before children: one batch legitimately carries a new
 * product together with the sale that emptied it, and the foreign keys must
 * hold at every step.
 */
export const PUSH_ORDER = [
  'products',
  'product_images',
  'sales',
  'sale_items',
  'inventory_transactions',
  'app_settings',
] as const;

export function isKnownTable(name: string): name is keyof typeof TABLES {
  return Object.prototype.hasOwnProperty.call(TABLES, name);
}
