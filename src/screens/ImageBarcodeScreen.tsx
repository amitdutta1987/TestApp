import {useNavigation, useRoute} from '@react-navigation/native';
import React, {useState} from 'react';
import {ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {Card} from '@/components/Card';
import {Field} from '@/components/Field';
import {Screen} from '@/components/Screen';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import type {RootScreenProps} from '@/navigation/types';
import {KNOWN_LIMITATIONS, imageBarcodeService} from '@/services/ImageBarcodeService';
import {imagePickerService} from '@/services/ImagePickerService';
import type {ImageScanOutcome, ImageScanStrategy} from '@/types';
import {formatBarcodeForDisplay, normalizeBarcode, validateBarcode} from '@/utils/barcode';
import {toUserMessage} from '@/utils/errors';

const STRATEGY_LABELS: Record<ImageScanStrategy, string> = {
  FULL_IMAGE: 'Whole photo',
  UPSCALED: 'Enlarged photo',
  ROTATED: 'Rotated photo',
  TILED: 'Zoomed sections',
  MANUAL_CROP: 'Your selection',
};

type Stage = 'idle' | 'scanning' | 'found' | 'failed';

/**
 * Spec §7's fallback chain, made visible.
 *
 * Pick a photo → automatic detection ladder → if that fails, crop the barcode
 * by hand and rescan → if that also fails, type the digits. Each step tells the
 * user what was actually tried, so a failure is explainable rather than magic.
 */
export function ImageBarcodeScreen() {
  const navigation = useNavigation<RootScreenProps<'ImageBarcode'>['navigation']>();
  const params = useRoute<RootScreenProps<'ImageBarcode'>['route']>().params;

  const [stage, setStage] = useState<Stage>('idle');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImageScanOutcome | null>(null);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [croppedOnce, setCroppedOnce] = useState(false);

  const runDetection = async (uri: string, viaCrop: boolean) => {
    setImageUri(uri);
    setStage('scanning');
    try {
      const result = await imageBarcodeService.detect(uri);
      setOutcome(
        viaCrop && result.barcode
          ? {...result, strategy: 'MANUAL_CROP', attempts: [...result.attempts, 'MANUAL_CROP']}
          : result,
      );
      setStage(result.barcode ? 'found' : 'failed');
    } catch (error) {
      Alert.alert('Could not read the photo', toUserMessage(error));
      setStage('failed');
    }
  };

  const pick = async (source: 'camera' | 'gallery') => {
    try {
      const picked =
        source === 'camera'
          ? await imagePickerService.takePhoto()
          : await imagePickerService.pickFromGallery();
      if (!picked) {
        return;
      }
      setCroppedOnce(false);
      await runDetection(picked.uri, false);
    } catch (error) {
      Alert.alert('Could not open that photo', toUserMessage(error));
    }
  };

  const cropAndRetry = async () => {
    if (!imageUri) {
      return;
    }
    try {
      const cropped = await imagePickerService.cropForBarcode(imageUri);
      if (!cropped) {
        return;
      }
      setCroppedOnce(true);
      await runDetection(cropped.uri, true);
    } catch (error) {
      Alert.alert('Could not open the crop tool', toUserMessage(error));
    }
  };

  const accept = (barcode: string) => {
    navigation.navigate('ProductForm', {barcode, productId: params?.productId});
  };

  const acceptManual = () => {
    const value = normalizeBarcode(manual);
    const check = validateBarcode(value);
    if (!check.valid) {
      setManualError(check.reason ?? 'Enter a valid barcode.');
      return;
    }
    accept(value);
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {imageUri ? (
          <Image source={{uri: imageUri}} style={styles.preview} resizeMode="contain" />
        ) : (
          <Card style={styles.intro}>
            <Text style={styles.introTitle}>Read a barcode from a photo</Text>
            <Text style={styles.introBody}>
              The barcode does not need to be centred or large. The photo is searched whole, then
              enlarged, then in overlapping zoomed sections, then rotated.
            </Text>
          </Card>
        )}

        {stage === 'idle' ? (
          <View style={styles.pickRow}>
            <Button
              title="Take a photo"
              style={styles.pickButton}
              onPress={() => void pick('camera')}
            />
            <Button
              title="Choose a photo"
              variant="secondary"
              style={styles.pickButton}
              onPress={() => void pick('gallery')}
            />
          </View>
        ) : null}

        {stage === 'scanning' ? (
          <Card style={styles.status}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.statusText}>Searching the photo for a barcode…</Text>
            <Text style={styles.statusHint}>
              Zoomed sections take a moment on large photos.
            </Text>
          </Card>
        ) : null}

        {stage === 'found' && outcome?.barcode ? (
          <Card style={styles.status}>
            <Text style={styles.foundLabel}>Barcode found</Text>
            <Text style={styles.foundValue} selectable>
              {formatBarcodeForDisplay(outcome.barcode.value)}
            </Text>
            <Text style={styles.foundMeta}>
              {outcome.barcode.format.replace('_', '-')}
              {outcome.strategy ? ` · ${STRATEGY_LABELS[outcome.strategy]}` : ''}
            </Text>
            <Button
              title="Use this barcode"
              size="lg"
              fullWidth
              style={styles.accept}
              onPress={() => accept(outcome.barcode!.value)}
            />
            <Button
              title="Not right — try again"
              variant="ghost"
              fullWidth
              style={styles.secondary}
              onPress={() => void cropAndRetry()}
            />
          </Card>
        ) : null}

        {stage === 'failed' ? (
          <Card style={styles.status}>
            <Text style={styles.failedTitle}>No barcode detected</Text>
            <Text style={styles.attempts}>
              Tried: {(outcome?.attempts ?? []).map(item => STRATEGY_LABELS[item]).join(', ') || '—'}
            </Text>

            {!croppedOnce ? (
              <>
                <Text style={styles.failedBody}>
                  Draw a box around just the barcode and it will be rescanned at high magnification.
                </Text>
                <Button
                  title="Select the barcode"
                  size="lg"
                  fullWidth
                  style={styles.accept}
                  onPress={() => void cropAndRetry()}
                />
              </>
            ) : (
              <>
                <Text style={styles.failedBody}>
                  The cropped area could not be decoded either. Common causes:
                </Text>
                {KNOWN_LIMITATIONS.map(limitation => (
                  <Text key={limitation} style={styles.limitation}>
                    • {limitation}
                  </Text>
                ))}
                <Button
                  title="Crop again"
                  variant="secondary"
                  fullWidth
                  style={styles.accept}
                  onPress={() => void cropAndRetry()}
                />
              </>
            )}
          </Card>
        ) : null}

        {stage === 'failed' || stage === 'found' ? (
          <Card style={styles.manualCard}>
            <Text style={styles.manualTitle}>Type the barcode instead</Text>
            <Field
              label="Barcode digits"
              value={manual}
              onChangeText={value => {
                setManual(value);
                setManualError(null);
              }}
              placeholder="e.g. 001234567890"
              autoCapitalize="characters"
              error={manualError}
              hint="Enter every digit, including leading zeros."
            />
            <Button title="Use this barcode" fullWidth onPress={acceptManual} />
          </Card>
        ) : null}

        {imageUri ? (
          <Button
            title="Start over with another photo"
            variant="ghost"
            fullWidth
            style={styles.secondary}
            onPress={() => {
              setImageUri(null);
              setOutcome(null);
              setCroppedOnce(false);
              setStage('idle');
            }}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  intro: {
    marginBottom: spacing.lg,
  },
  introTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  introBody: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  preview: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    height: 260,
    marginBottom: spacing.lg,
    width: '100%',
  },
  pickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pickButton: {
    flex: 1,
  },
  status: {
    alignItems: 'center',
  },
  statusText: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginTop: spacing.md,
  },
  statusHint: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  foundLabel: {
    color: colors.success,
    fontSize: fontSize.sm,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  foundValue: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: spacing.sm,
  },
  foundMeta: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  accept: {
    marginTop: spacing.lg,
  },
  secondary: {
    marginTop: spacing.sm,
  },
  failedTitle: {
    color: colors.danger,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  attempts: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  failedBody: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    lineHeight: 22,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  limitation: {
    alignSelf: 'flex-start',
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  manualCard: {
    marginTop: spacing.lg,
  },
  manualTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
});
