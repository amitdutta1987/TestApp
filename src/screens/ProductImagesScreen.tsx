import {useRoute} from '@react-navigation/native';
import React, {useCallback, useState} from 'react';
import {Alert, Image, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {EmptyState, ErrorState, LoadingState} from '@/components/EmptyState';
import {Screen} from '@/components/Screen';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import {useAsyncData} from '@/hooks/useAsyncData';
import type {RootScreenProps} from '@/navigation/types';
import {ProductRepository} from '@/repositories/ProductRepository';
import {imagePickerService} from '@/services/ImagePickerService';
import {imageStorageService, toDisplayUri} from '@/services/ImageStorageService';
import type {Product, ProductImage} from '@/types';
import {toUserMessage} from '@/utils/errors';

const products = new ProductRepository();

interface Data {
  product: Product;
  images: ProductImage[];
}

export function ProductImagesScreen() {
  const {productId} = useRoute<RootScreenProps<'ProductImages'>['route']>().params;
  const [working, setWorking] = useState(false);

  const load = useCallback(async (): Promise<Data> => {
    const [product, images] = await Promise.all([
      products.requireById(productId),
      products.listImages(productId),
    ]);
    return {product, images};
  }, [productId]);

  const {data, loading, error, reload} = useAsyncData<Data>(load, [productId]);

  const addPhoto = async (source: 'camera' | 'gallery') => {
    setWorking(true);
    try {
      const picked =
        source === 'camera'
          ? await imagePickerService.takePhoto()
          : await imagePickerService.pickFromGallery();
      if (!picked) {
        return;
      }
      // Copy into app-private storage first: the picker's temp file can be
      // reclaimed at any time, and only a relative path belongs in the database.
      const storedPath = await imageStorageService.saveImage(picked.uri);
      await products.addImage(productId, storedPath);
      await imagePickerService.cleanTempFiles();
      await reload();
    } catch (caught) {
      Alert.alert('Could not add that photo', toUserMessage(caught));
    } finally {
      setWorking(false);
    }
  };

  const makePrimary = async (image: ProductImage) => {
    setWorking(true);
    try {
      await products.setPrimaryImage(productId, image.id);
      await reload();
    } catch (caught) {
      Alert.alert('Could not update the photo', toUserMessage(caught));
    } finally {
      setWorking(false);
    }
  };

  const remove = (image: ProductImage) => {
    Alert.alert('Remove this photo?', 'The image file is deleted from this device.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setWorking(true);
            try {
              const removedPath = await products.removeImage(productId, image.id);
              if (removedPath) {
                await imageStorageService.deleteImage(removedPath);
              }
              await reload();
            } catch (caught) {
              Alert.alert('Could not remove the photo', toUserMessage(caught));
            } finally {
              setWorking(false);
            }
          })();
        },
      },
    ]);
  };

  if (loading && !data) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'That product was not found.'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.productName} numberOfLines={2}>
          {data.product.name}
        </Text>
        <Text style={styles.hint}>
          The first photo is used as the product's main image. Photos are stored on this phone
          only and are included in backups.
        </Text>

        <View style={styles.pickRow}>
          <Button
            title="Take a photo"
            style={styles.pickButton}
            disabled={working}
            onPress={() => void addPhoto('camera')}
          />
          <Button
            title="Choose a photo"
            variant="secondary"
            style={styles.pickButton}
            disabled={working}
            onPress={() => void addPhoto('gallery')}
          />
        </View>

        {data.images.length === 0 ? (
          <EmptyState
            title="No photos yet"
            message="Add a photo so this product is easy to recognise in the inventory list."
          />
        ) : (
          data.images.map(image => (
            <View key={image.id} style={styles.card}>
              <Image
                source={{uri: toDisplayUri(image.imageUri) ?? undefined}}
                style={styles.photo}
                resizeMode="cover"
              />
              <View style={styles.cardFooter}>
                {image.isPrimary ? (
                  <View style={styles.primaryBadge}>
                    <Text style={styles.primaryBadgeText}>MAIN PHOTO</Text>
                  </View>
                ) : (
                  <Pressable
                    disabled={working}
                    onPress={() => void makePrimary(image)}
                    style={({pressed}) => [styles.link, pressed && styles.pressed]}>
                    <Text style={styles.linkText}>Set as main</Text>
                  </Pressable>
                )}
                <Pressable
                  disabled={working}
                  onPress={() => remove(image)}
                  style={({pressed}) => [styles.link, pressed && styles.pressed]}>
                  <Text style={[styles.linkText, styles.removeText]}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  productName: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  pickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    marginTop: spacing.lg,
  },
  pickButton: {
    flex: 1,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  photo: {
    backgroundColor: colors.surfaceAlt,
    height: 220,
    width: '100%',
  },
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryBadge: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  primaryBadgeText: {
    color: colors.success,
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  link: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  linkText: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  removeText: {
    color: colors.danger,
  },
});
