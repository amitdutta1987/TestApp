import type {
  InventoryTransaction,
  InventoryTransactionType,
  InventoryTransactionWithProduct,
  Product,
  ProductImage,
  ProductLifecycle,
  Sale,
  SaleItem,
  StockStatus,
} from '@/types';

/** Raw SQLite row shapes. Kept next to the mappers so drift is obvious. */
export interface ProductRow {
  id: string;
  barcode: string;
  sku: string | null;
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
  color: string | null;
  size: string | null;
  material: string | null;
  supplier: string | null;
  rack_location: string | null;
  purchase_price: number | null;
  selling_price: number;
  minimum_stock: number;
  current_quantity: number;
  status: string;
  lifecycle: string;
  primary_image: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductImageRow {
  id: string;
  product_id: string;
  image_uri: string;
  is_primary: number;
  created_at: string;
}

export interface SaleRow {
  id: string;
  sale_number: string;
  total_amount: number;
  created_at: string;
}

export interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string;
  barcode: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

export interface InventoryTransactionRow {
  id: string;
  product_id: string;
  type: string;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference_id: string | null;
  notes: string | null;
  created_at: string;
}

export function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    barcode: row.barcode,
    sku: row.sku,
    name: row.name,
    category: row.category,
    brand: row.brand,
    description: row.description,
    color: row.color,
    size: row.size,
    material: row.material,
    supplier: row.supplier,
    rackLocation: row.rack_location,
    purchasePrice: row.purchase_price,
    sellingPrice: row.selling_price,
    minimumStock: row.minimum_stock,
    currentQuantity: row.current_quantity,
    status: row.status as StockStatus,
    lifecycle: row.lifecycle as ProductLifecycle,
    primaryImage: row.primary_image,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapProductImage(row: ProductImageRow): ProductImage {
  return {
    id: row.id,
    productId: row.product_id,
    imageUri: row.image_uri,
    isPrimary: row.is_primary === 1,
    createdAt: row.created_at,
  };
}

export function mapSale(row: SaleRow): Sale {
  return {
    id: row.id,
    saleNumber: row.sale_number,
    totalAmount: row.total_amount,
    createdAt: row.created_at,
  };
}

export function mapSaleItem(row: SaleItemRow): SaleItem {
  return {
    id: row.id,
    saleId: row.sale_id,
    productId: row.product_id,
    barcode: row.barcode,
    productName: row.product_name,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    totalPrice: row.total_price,
  };
}

export function mapInventoryTransaction(row: InventoryTransactionRow): InventoryTransaction {
  return {
    id: row.id,
    productId: row.product_id,
    type: row.type as InventoryTransactionType,
    quantity: row.quantity,
    quantityBefore: row.quantity_before,
    quantityAfter: row.quantity_after,
    referenceId: row.reference_id,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export function mapInventoryTransactionWithProduct(
  row: InventoryTransactionRow & {product_name: string; barcode: string},
): InventoryTransactionWithProduct {
  return {
    ...mapInventoryTransaction(row),
    productName: row.product_name,
    barcode: row.barcode,
  };
}
