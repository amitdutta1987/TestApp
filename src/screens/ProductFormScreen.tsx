import {useNavigation, useRoute} from '@react-navigation/native';
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {ErrorState, LoadingState} from '@/components/EmptyState';
import {Field} from '@/components/Field';
import {Screen} from '@/components/Screen';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import {useAsyncData} from '@/hooks/useAsyncData';
import type {RootScreenProps} from '@/navigation/types';
import {ProductRepository} from '@/repositories/ProductRepository';
import {barcodeScannerService} from '@/services/BarcodeScannerService';
import {imagePickerService} from '@/services/ImagePickerService';
import {imageStorageService, toDisplayUri} from '@/services/ImageStorageService';
import type {NewProductInput, Product} from '@/types';
import {normalizeBarcode, validateBarcode} from '@/utils/barcode';
import {DuplicateBarcodeError, toUserMessage} from '@/utils/errors';
import {parseNumericInput} from '@/utils/stock';

const products = new ProductRepository();

interface FormState {
  barcode: string;
  name: string;
  sku: string;
  category: string;
  brand: string;
  description: string;
  color: string;
  size: string;
  material: string;
  supplier: string;
  rackLocation: string;
  purchasePrice: string;
  sellingPrice: string;
  minimumStock: string;
  initialQuantity: string;
}

const EMPTY: FormState = {
  barcode: '',
  name: '',
  sku: '',
  category: '',
  brand: '',
  description: '',
  color: '',
  size: '',
  material: '',
  supplier: '',
  rackLocation: '',
  purchasePrice: '',
  sellingPrice: '',
  minimumStock: '5',
  initialQuantity: '0',
};

function fromProduct(product: Product): FormState {
  return {
    barcode: product.barcode,
    name: product.name,
    sku: product.sku ?? '',
    category: product.category ?? '',
    brand: product.brand ?? '',
    description: product.description ?? '',
    color: product.color ?? '',
    size: product.size ?? '',
    material: product.material ?? '',
    supplier: product.supplier ?? '',
    rackLocation: product.rackLocation ?? '',
    purchasePrice: product.purchasePrice === null ? '' : String(product.purchasePrice),
    sellingPrice: String(product.sellingPrice),
    minimumStock: String(product.minimumStock),
    initialQuantity: String(product.currentQuantity),
  };
}

export function ProductFormScreen() {
  const navigation = useNavigation<RootScreenProps<'ProductForm'>['navigation']>();
  const route = useRoute<RootScreenProps<'ProductForm'>['route']>();
  const productId = route.params?.productId;
  const isEdit = Boolean(productId);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [images, setImages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const load = useCallback(async () => {
    if (!productId) {
      return null;
    }
    return products.requireById(productId);
  }, [productId]);

  const {data: existing, loading, error, reload} = useAsyncData<Product | null>(load, [productId]);

  useEffect(() => {
    navigation.setOptions({title: isEdit ? 'Edit product' : 'New product'});
  }, [navigation, isEdit]);

  useEffect(() => {
    if (existing && !hydrated) {
      setForm(fromProduct(existing));
      setHydrated(true);
    }
  }, [existing, hydrated]);

  // A barcode arriving from the scanner or the photo pipeline comes back as a
  // route param, so it has to flow into the form after mount.
  useEffect(() => {
    const incoming = route.params?.barcode;
    if (incoming) {
      setForm(previous => ({...previous, barcode: incoming}));
    }
  }, [route.params?.barcode]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm(previous => ({...previous, [key]: value}));
    setErrors(previous => ({...previous, [key]: undefined}));
  };

  if (isEdit && loading && !existing) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (isEdit && error) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const scanBarcode = async () => {
    const result = await barcodeScannerService.scanFromCamera();
    if (result) {
      set('barcode', result.value);
    }
  };

  const addPhoto = async (source: 'camera' | 'gallery') => {
    try {
      const picked =
        source === 'camera'
          ? await imagePickerService.takePhoto()
          : await imagePickerService.pickFromGallery();
      if (!picked) {
        return;
      }
      const stored = await imageStorageService.saveImage(picked.uri);
      setImages(previous => [...previous, stored]);
      await imagePickerService.cleanTempFiles();
    } catch (caught) {
      Alert.alert('Photo not added', toUserMessage(caught));
    }
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof FormState, string>> = {};

    const barcode = normalizeBarcode(form.barcode);
    const barcodeCheck = validateBarcode(barcode);
    if (!barcodeCheck.valid) {
      next.barcode = barcodeCheck.reason ?? 'Enter a valid barcode.';
    }

    if (form.name.trim() === '') {
      next.name = 'Product name is required.';
    }

    const selling = parseNumericInput(form.sellingPrice);
    if (selling === null || selling < 0) {
      next.sellingPrice = 'Enter a selling price of zero or more.';
    }

    if (form.purchasePrice.trim() !== '') {
      const purchase = parseNumericInput(form.purchasePrice);
      if (purchase === null || purchase < 0) {
        next.purchasePrice = 'Enter a valid purchase price.';
      }
    }

    if (!isEdit) {
      const quantity = parseNumericInput(form.initialQuantity);
      if (quantity === null || quantity < 0 || !Number.isInteger(quantity)) {
        next.initialQuantity = 'Enter a whole number of units.';
      }
    }

    const minimum = parseNumericInput(form.minimumStock);
    if (minimum === null || minimum < 0 || !Number.isInteger(minimum)) {
      next.minimumStock = 'Enter a whole number.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) {
      return;
    }
    setSaving(true);
    try {
      if (isEdit && productId) {
        await products.update(productId, {
          barcode: normalizeBarcode(form.barcode),
          name: form.name.trim(),
          sku: form.sku,
          category: form.category,
          brand: form.brand,
          description: form.description,
          color: form.color,
          size: form.size,
          material: form.material,
          supplier: form.supplier,
          rackLocation: form.rackLocation,
          purchasePrice:
            form.purchasePrice.trim() === '' ? null : parseNumericInput(form.purchasePrice),
          sellingPrice: parseNumericInput(form.sellingPrice) ?? 0,
          minimumStock: parseNumericInput(form.minimumStock) ?? 0,
        });
        navigation.goBack();
        return;
      }

      const input: NewProductInput = {
        barcode: normalizeBarcode(form.barcode),
        name: form.name.trim(),
        sellingPrice: parseNumericInput(form.sellingPrice) ?? 0,
        initialQuantity: parseNumericInput(form.initialQuantity) ?? 0,
        sku: form.sku,
        category: form.category,
        brand: form.brand,
        description: form.description,
        color: form.color,
        size: form.size,
        material: form.material,
        supplier: form.supplier,
        rackLocation: form.rackLocation,
        purchasePrice:
          form.purchasePrice.trim() === '' ? null : parseNumericInput(form.purchasePrice),
        minimumStock: parseNumericInput(form.minimumStock) ?? 0,
        images,
        primaryImage: images[0] ?? null,
      };

      const created = await products.create(input);
      navigation.replace('ProductDetail', {productId: created.id});
    } catch (caught) {
      // Spec §9: a duplicate barcode is not an error to shout about — it is an
      // offer to open the product that already has it.
      if (caught instanceof DuplicateBarcodeError) {
        Alert.alert(
          'Product already exists',
          `"${caught.existingName}" already uses the barcode ${caught.barcode}.`,
          [
            {text: 'Cancel', style: 'cancel'},
            {
              text: 'Open product',
              onPress: () =>
                navigation.replace('ProductDetail', {productId: caught.existingProductId}),
            },
          ],
        );
      } else {
        Alert.alert('Could not save', toUserMessage(caught));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Field
          label="Barcode"
          value={form.barcode}
          onChangeText={value => set('barcode', value)}
          placeholder="e.g. 001234567890"
          keyboardType="default"
          autoCapitalize="characters"
          required
          error={errors.barcode}
          hint="Stored exactly as entered — leading zeros are preserved."
        />

        <View style={styles.barcodeActions}>
          <Button
            title="Scan with camera"
            variant="secondary"
            size="sm"
            style={styles.barcodeAction}
            onPress={() => void scanBarcode()}
          />
          <Button
            title="Read from photo"
            variant="secondary"
            size="sm"
            style={styles.barcodeAction}
            onPress={() => navigation.navigate('ImageBarcode', {returnTo: 'ProductForm', productId})}
          />
        </View>

        <Field
          label="Product name"
          value={form.name}
          onChangeText={value => set('name', value)}
          placeholder="e.g. Cotton kurta, blue"
          required
          error={errors.name}
          style={styles.spaced}
        />

        <View style={styles.row}>
          <Field
            label="Selling price"
            value={form.sellingPrice}
            onChangeText={value => set('sellingPrice', value)}
            keyboardType="decimal-pad"
            placeholder="0.00"
            required
            error={errors.sellingPrice}
            style={styles.half}
          />
          <Field
            label="Purchase price"
            value={form.purchasePrice}
            onChangeText={value => set('purchasePrice', value)}
            keyboardType="decimal-pad"
            placeholder="Optional"
            error={errors.purchasePrice}
            style={styles.half}
          />
        </View>

        <View style={styles.row}>
          {!isEdit ? (
            <Field
              label="Opening stock"
              value={form.initialQuantity}
              onChangeText={value => set('initialQuantity', value)}
              keyboardType="number-pad"
              error={errors.initialQuantity}
              style={styles.half}
            />
          ) : null}
          <Field
            label="Low-stock alert at"
            value={form.minimumStock}
            onChangeText={value => set('minimumStock', value)}
            keyboardType="number-pad"
            error={errors.minimumStock}
            style={styles.half}
          />
        </View>

        {isEdit ? (
          <Text style={styles.stockNote}>
            Stock is changed through Sell, Add stock and Adjust so every movement is recorded.
          </Text>
        ) : null}

        <Text style={styles.sectionTitle}>Optional details</Text>

        <View style={styles.row}>
          <Field
            label="SKU"
            value={form.sku}
            onChangeText={value => set('sku', value)}
            autoCapitalize="characters"
            style={styles.half}
          />
          <Field
            label="Category"
            value={form.category}
            onChangeText={value => set('category', value)}
            style={styles.half}
          />
        </View>

        <View style={styles.row}>
          <Field
            label="Brand"
            value={form.brand}
            onChangeText={value => set('brand', value)}
            style={styles.half}
          />
          <Field
            label="Supplier"
            value={form.supplier}
            onChangeText={value => set('supplier', value)}
            style={styles.half}
          />
        </View>

        <View style={styles.row}>
          <Field
            label="Colour"
            value={form.color}
            onChangeText={value => set('color', value)}
            style={styles.half}
          />
          <Field
            label="Size"
            value={form.size}
            onChangeText={value => set('size', value)}
            style={styles.half}
          />
        </View>

        <View style={styles.row}>
          <Field
            label="Material"
            value={form.material}
            onChangeText={value => set('material', value)}
            style={styles.half}
          />
          <Field
            label="Rack / shelf"
            value={form.rackLocation}
            onChangeText={value => set('rackLocation', value)}
            autoCapitalize="characters"
            style={styles.half}
          />
        </View>

        <Field
          label="Description"
          value={form.description}
          onChangeText={value => set('description', value)}
          multiline
        />

        {!isEdit ? (
          <>
            <Text style={styles.sectionTitle}>Photos</Text>
            <View style={styles.thumbRow}>
              {images.map(path => (
                <Pressable
                  key={path}
                  onPress={() =>
                    Alert.alert('Remove photo?', '', [
                      {text: 'Cancel', style: 'cancel'},
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => {
                          setImages(previous => previous.filter(item => item !== path));
                          void imageStorageService.deleteImage(path);
                        },
                      },
                    ])
                  }>
                  <Image
                    source={{uri: toDisplayUri(path) ?? undefined}}
                    style={styles.thumb}
                    resizeMode="cover"
                  />
                </Pressable>
              ))}
            </View>
            <View style={styles.row}>
              <Button
                title="Take photo"
                variant="secondary"
                size="sm"
                style={styles.half}
                onPress={() => void addPhoto('camera')}
              />
              <Button
                title="Choose photo"
                variant="secondary"
                size="sm"
                style={styles.half}
                onPress={() => void addPhoto('gallery')}
              />
            </View>
          </>
        ) : (
          <Button
            title="Manage photos"
            variant="ghost"
            fullWidth
            style={styles.spaced}
            onPress={() =>
              productId ? navigation.navigate('ProductImages', {productId}) : undefined
            }
          />
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={isEdit ? 'Save changes' : 'Save product'}
          size="lg"
          fullWidth
          loading={saving}
          onPress={() => void save()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  barcodeActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    marginTop: -spacing.sm,
  },
  barcodeAction: {
    flex: 1,
  },
  spaced: {
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  half: {
    flex: 1,
  },
  stockNote: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginBottom: spacing.lg,
    marginTop: -spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.md,
    marginTop: spacing.md,
  },
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  thumb: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    height: 76,
    width: 76,
  },
  footer: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.lg,
  },
});
