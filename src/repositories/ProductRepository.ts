import type {SqlTransaction, SqlValue} from '@/database/driver';
import type {
  NewProductInput,
  Page,
  Product,
  ProductFilter,
  ProductImage,
  ProductUpdateInput,
} from '@/types';
import {normalizeBarcode, validateBarcode} from '@/utils/barcode';
import {nowIso} from '@/utils/date';
import {AppError, DuplicateBarcodeError, wrapDbError} from '@/utils/errors';
import {generateId} from '@/utils/id';
import {assertValidPrice, deriveStatus} from '@/utils/stock';
import {BaseRepository} from './BaseRepository';
import {
  mapProduct,
  mapProductImage,
  type ProductImageRow,
  type ProductRow,
} from './mappers';

const PRODUCT_COLUMNS = `
  id, barcode, sku, name, category, brand, description, color, size, material,
  supplier, rack_location, purchase_price, selling_price, minimum_stock,
  current_quantity, status, lifecycle, primary_image, created_at, updated_at
`;

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export class ProductRepository extends BaseRepository {

  /**
   * The hot path for the whole app: scan a barcode, get a product.
   * Exact match on a UNIQUE index — no LIKE, no scan.
   */
  async findByBarcode(barcode: string): Promise<Product | null> {
    const value = normalizeBarcode(barcode);
    if (value === '') {
      return null;
    }
    try {
      const result = await this.driver.execute<ProductRow>(
        `SELECT ${PRODUCT_COLUMNS} FROM products WHERE barcode = ? LIMIT 1;`,
        [value],
      );
      const row = result.rows[0];
      return row ? mapProduct(row) : null;
    } catch (error) {
      throw wrapDbError(error, 'look up that barcode');
    }
  }

  async findById(id: string): Promise<Product | null> {
    try {
      const result = await this.driver.execute<ProductRow>(
        `SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ? LIMIT 1;`,
        [id],
      );
      const row = result.rows[0];
      return row ? mapProduct(row) : null;
    } catch (error) {
      throw wrapDbError(error, 'load that product');
    }
  }

  async requireById(id: string): Promise<Product> {
    const product = await this.findById(id);
    if (!product) {
      throw new AppError('PRODUCT_NOT_FOUND', 'That product no longer exists.');
    }
    return product;
  }

  /**
   * Paginated so a 5,000-product catalogue never lands in memory at once.
   * Returns the total alongside the page so the list can show a count without
   * a second round trip.
   */
  async list(
    filter: ProductFilter = {},
    limit = 30,
    offset = 0,
  ): Promise<Page<Product>> {
    const where: string[] = [];
    const params: SqlValue[] = [];

    if (!filter.includeInactive) {
      where.push("lifecycle = 'ACTIVE'");
    }
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.category) {
      where.push('category = ?');
      params.push(filter.category);
    }

    const search = filter.search?.trim();
    if (search) {
      // A scanned or typed barcode should hit the unique index exactly rather
      // than degrade into a LIKE scan, so it gets its own equality branch.
      where.push('(barcode = ? OR name LIKE ? OR sku LIKE ? OR barcode LIKE ?)');
      const like = `%${search}%`;
      params.push(normalizeBarcode(search), like, like, like);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    try {
      const countResult = await this.driver.execute<{total: number}>(
        `SELECT COUNT(*) AS total FROM products ${whereSql};`,
        params,
      );
      const total = Number(countResult.rows[0]?.total ?? 0);

      const result = await this.driver.execute<ProductRow>(
        `SELECT ${PRODUCT_COLUMNS} FROM products ${whereSql}
         ORDER BY name COLLATE NOCASE ASC
         LIMIT ? OFFSET ?;`,
        [...params, limit, offset],
      );

      return {
        items: result.rows.map(mapProduct),
        total,
        limit,
        offset,
        hasMore: offset + result.rows.length < total,
      };
    } catch (error) {
      throw wrapDbError(error, 'load the inventory list');
    }
  }

  async listCategories(): Promise<string[]> {
    try {
      const result = await this.driver.execute<{category: string}>(
        `SELECT DISTINCT category FROM products
         WHERE category IS NOT NULL AND TRIM(category) <> ''
         ORDER BY category COLLATE NOCASE ASC;`,
      );
      return result.rows.map(row => row.category);
    } catch (error) {
      throw wrapDbError(error, 'load categories');
    }
  }

  /**
   * Creates the product and its opening INITIAL_STOCK transaction in one
   * transaction, so a product can never exist without an audit trail.
   */
  async create(input: NewProductInput): Promise<Product> {
    const barcode = normalizeBarcode(input.barcode);
    const validation = validateBarcode(barcode);
    if (!validation.valid) {
      throw new AppError('INVALID_BARCODE', validation.reason ?? 'That barcode is not valid.');
    }

    const name = input.name.trim();
    if (name === '') {
      throw new AppError('VALIDATION_ERROR', 'Product name is required.');
    }
    assertValidPrice(input.sellingPrice, 'Selling price');
    if (input.purchasePrice !== null && input.purchasePrice !== undefined) {
      assertValidPrice(input.purchasePrice, 'Purchase price');
    }

    const quantity = Math.floor(input.initialQuantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new AppError('INVALID_QUANTITY', 'Initial quantity cannot be negative.');
    }

    const existing = await this.findByBarcode(barcode);
    if (existing) {
      throw new DuplicateBarcodeError(barcode, existing.id, existing.name);
    }

    const minimumStock = Math.max(0, Math.floor(input.minimumStock ?? 0));
    const id = generateId('prd');
    const timestamp = nowIso();
    const status = deriveStatus(quantity, minimumStock);
    const images = input.images ?? [];
    const primaryImage = input.primaryImage ?? images[0] ?? null;

    try {
      await this.driver.transaction(tx => {
        tx.execute(
          `INSERT INTO products (
             id, barcode, sku, name, category, brand, description, color, size, material,
             supplier, rack_location, purchase_price, selling_price, minimum_stock,
             current_quantity, status, lifecycle, primary_image, created_at, updated_at,
             metadata_updated_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ACTIVE', ?,?,?,?);`,
          [
            id,
            barcode,
            trimOrNull(input.sku),
            name,
            trimOrNull(input.category),
            trimOrNull(input.brand),
            trimOrNull(input.description),
            trimOrNull(input.color),
            trimOrNull(input.size),
            trimOrNull(input.material),
            trimOrNull(input.supplier),
            trimOrNull(input.rackLocation),
            input.purchasePrice ?? null,
            input.sellingPrice,
            minimumStock,
            quantity,
            status,
            primaryImage,
            timestamp,
            timestamp,
            // Sync compares this, not updated_at, to decide whose edit wins.
            timestamp,
          ],
        );

        images.forEach((uri, index) => {
          tx.execute(
            `INSERT INTO product_images (id, product_id, image_uri, is_primary, created_at)
             VALUES (?,?,?,?,?);`,
            [generateId('img'), id, uri, uri === primaryImage && index === 0 ? 1 : 0, timestamp],
          );
        });

        if (quantity > 0) {
          tx.execute(
            `INSERT INTO inventory_transactions
               (id, product_id, type, quantity, quantity_before, quantity_after,
                reference_id, notes, created_at)
             VALUES (?,?,'INITIAL_STOCK',?,0,?,NULL,?,?);`,
            [generateId('itx'), id, quantity, quantity, 'Opening stock', timestamp],
          );
        }
      });
    } catch (error) {
      throw wrapDbError(error, 'save the product');
    }

    return this.requireById(id);
  }

  async update(id: string, patch: ProductUpdateInput): Promise<Product> {
    const current = await this.requireById(id);

    const assignments: string[] = [];
    const params: SqlValue[] = [];

    const push = (column: string, value: SqlValue) => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (patch.barcode !== undefined) {
      const barcode = normalizeBarcode(patch.barcode);
      const validation = validateBarcode(barcode);
      if (!validation.valid) {
        throw new AppError('INVALID_BARCODE', validation.reason ?? 'That barcode is not valid.');
      }
      if (barcode !== current.barcode) {
        const clash = await this.findByBarcode(barcode);
        if (clash) {
          throw new DuplicateBarcodeError(barcode, clash.id, clash.name);
        }
      }
      push('barcode', barcode);
    }

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name === '') {
        throw new AppError('VALIDATION_ERROR', 'Product name is required.');
      }
      push('name', name);
    }

    if (patch.sellingPrice !== undefined) {
      assertValidPrice(patch.sellingPrice, 'Selling price');
      push('selling_price', patch.sellingPrice);
    }

    if (patch.purchasePrice !== undefined) {
      if (patch.purchasePrice !== null) {
        assertValidPrice(patch.purchasePrice, 'Purchase price');
      }
      push('purchase_price', patch.purchasePrice);
    }

    // Changing the low-stock threshold can flip the status without any stock
    // movement, so recompute it here rather than waiting for the next sale.
    if (patch.minimumStock !== undefined) {
      const minimumStock = Math.max(0, Math.floor(patch.minimumStock));
      push('minimum_stock', minimumStock);
      push('status', deriveStatus(current.currentQuantity, minimumStock));
    }

    const textFields: Array<[keyof ProductUpdateInput, string]> = [
      ['sku', 'sku'],
      ['category', 'category'],
      ['brand', 'brand'],
      ['description', 'description'],
      ['color', 'color'],
      ['size', 'size'],
      ['material', 'material'],
      ['supplier', 'supplier'],
      ['rackLocation', 'rack_location'],
      ['primaryImage', 'primary_image'],
    ];
    for (const [key, column] of textFields) {
      const value = patch[key];
      if (value !== undefined) {
        push(column, trimOrNull(value as string | null));
      }
    }

    if (assignments.length === 0) {
      return current;
    }

    push('updated_at', nowIso());
    /**
     * metadata_updated_at is deliberately NOT set here. A trigger owns it —
     * see buildMetadataClockTrigger. Setting it at each write site is what
     * broke deactivate(), reactivate() and the primary-image writes.
     */
    params.push(id);

    try {
      await this.driver.execute(
        `UPDATE products SET ${assignments.join(', ')} WHERE id = ?;`,
        params,
      );
    } catch (error) {
      throw wrapDbError(error, 'update the product');
    }

    return this.requireById(id);
  }

  /**
   * Soft delete. Sale history references products, so rows are never removed
   * for a product that has ever been sold.
   */
  async deactivate(id: string): Promise<void> {
    try {
      await this.driver.execute(
        "UPDATE products SET lifecycle = 'INACTIVE', updated_at = ? WHERE id = ?;",
        [nowIso(), id],
      );
    } catch (error) {
      throw wrapDbError(error, 'deactivate the product');
    }
  }

  async reactivate(id: string): Promise<void> {
    try {
      await this.driver.execute(
        "UPDATE products SET lifecycle = 'ACTIVE', updated_at = ? WHERE id = ?;",
        [nowIso(), id],
      );
    } catch (error) {
      throw wrapDbError(error, 'reactivate the product');
    }
  }

  async hasSales(id: string): Promise<boolean> {
    const result = await this.driver.execute<{total: number}>(
      'SELECT COUNT(*) AS total FROM sale_items WHERE product_id = ?;',
      [id],
    );
    return Number(result.rows[0]?.total ?? 0) > 0;
  }

  /**
   * Hard delete, allowed only when the product was never sold. Returns the image
   * paths so the caller can remove the files — SQLite cannot do that for us.
   */
  async deletePermanently(id: string): Promise<string[]> {
    if (await this.hasSales(id)) {
      throw new AppError(
        'VALIDATION_ERROR',
        'This product appears in sales history and cannot be deleted. Deactivate it instead.',
      );
    }
    const images = await this.listImages(id);
    const product = await this.findById(id);
    try {
      await this.driver.execute('DELETE FROM products WHERE id = ?;', [id]);
    } catch (error) {
      throw wrapDbError(error, 'delete the product');
    }
    const paths = images.map(image => image.imageUri);
    if (product?.primaryImage && !paths.includes(product.primaryImage)) {
      paths.push(product.primaryImage);
    }
    return paths;
  }

  async listImages(productId: string): Promise<ProductImage[]> {
    const result = await this.driver.execute<ProductImageRow>(
      `SELECT id, product_id, image_uri, is_primary, created_at
       FROM product_images WHERE product_id = ?
       ORDER BY is_primary DESC, created_at ASC;`,
      [productId],
    );
    return result.rows.map(mapProductImage);
  }

  async addImage(productId: string, imageUri: string, makePrimary = false): Promise<ProductImage> {
    const id = generateId('img');
    const timestamp = nowIso();
    const existing = await this.listImages(productId);
    const shouldBePrimary = makePrimary || existing.length === 0;

    try {
      await this.driver.transaction(tx => {
        if (shouldBePrimary) {
          tx.execute('UPDATE product_images SET is_primary = 0 WHERE product_id = ?;', [productId]);
        }
        tx.execute(
          `INSERT INTO product_images (id, product_id, image_uri, is_primary, created_at)
           VALUES (?,?,?,?,?);`,
          [id, productId, imageUri, shouldBePrimary ? 1 : 0, timestamp],
        );
        if (shouldBePrimary) {
          tx.execute('UPDATE products SET primary_image = ?, updated_at = ? WHERE id = ?;', [
            imageUri,
            timestamp,
            productId,
          ]);
        }
      });
    } catch (error) {
      throw wrapDbError(error, 'attach the image');
    }

    return {id, productId, imageUri, isPrimary: shouldBePrimary, createdAt: timestamp};
  }

  async setPrimaryImage(productId: string, imageId: string): Promise<void> {
    const images = await this.listImages(productId);
    const target = images.find(image => image.id === imageId);
    if (!target) {
      throw new AppError('VALIDATION_ERROR', 'That image is no longer attached to this product.');
    }
    const timestamp = nowIso();
    await this.driver.transaction(tx => {
      tx.execute('UPDATE product_images SET is_primary = 0 WHERE product_id = ?;', [productId]);
      tx.execute('UPDATE product_images SET is_primary = 1 WHERE id = ?;', [imageId]);
      tx.execute('UPDATE products SET primary_image = ?, updated_at = ? WHERE id = ?;', [
        target.imageUri,
        timestamp,
        productId,
      ]);
    });
  }

  /** Returns the removed file path so the caller can delete it from disk. */
  async removeImage(productId: string, imageId: string): Promise<string | null> {
    const images = await this.listImages(productId);
    const target = images.find(image => image.id === imageId);
    if (!target) {
      return null;
    }
    const remaining = images.filter(image => image.id !== imageId);
    const nextPrimary = target.isPrimary ? remaining[0] ?? null : null;
    const timestamp = nowIso();

    await this.driver.transaction(tx => {
      tx.execute('DELETE FROM product_images WHERE id = ?;', [imageId]);
      if (target.isPrimary) {
        if (nextPrimary) {
          tx.execute('UPDATE product_images SET is_primary = 1 WHERE id = ?;', [nextPrimary.id]);
        }
        tx.execute('UPDATE products SET primary_image = ?, updated_at = ? WHERE id = ?;', [
          nextPrimary?.imageUri ?? null,
          timestamp,
          productId,
        ]);
      }
    });

    return target.imageUri;
  }

  /** Every image path referenced anywhere — used to build the backup archive. */
  async listAllImagePaths(): Promise<string[]> {
    const result = await this.driver.execute<{image_uri: string}>(
      `SELECT image_uri FROM product_images
       UNION
       SELECT primary_image AS image_uri FROM products WHERE primary_image IS NOT NULL;`,
    );
    return result.rows.map(row => row.image_uri).filter(Boolean);
  }

  async listAll(): Promise<Product[]> {
    const result = await this.driver.execute<ProductRow>(
      `SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY created_at ASC;`,
    );
    return result.rows.map(mapProduct);
  }
}

/**
 * Recomputes and writes products.status from the current quantity. Called from
 * inside inventory transactions, so it takes an open tx rather than the driver.
 */
export function syncProductStatus(
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
