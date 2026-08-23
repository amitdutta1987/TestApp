import {useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCodeScanner,
  type Code,
  type CameraPosition,
} from 'react-native-vision-camera';
import {Button} from '@/components/Button';
import {SCANNER} from '@/constants/config';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import type {RootScreenProps, ScannerMode} from '@/navigation/types';
import {ProductRepository} from '@/repositories/ProductRepository';
import {fulfilScanRequest} from '@/services/BarcodeScannerService';
import {permissionService} from '@/services/PermissionService';
import type {BarcodeResult} from '@/types';
import {normalizeBarcode, toBarcodeFormat} from '@/utils/barcode';

type Navigation = RootScreenProps<'Scanner'>['navigation'];

const products = new ProductRepository();

/**
 * Live camera scanning (spec §5).
 *
 * Two behaviours matter here:
 *  - After a hit the scanner pauses, so one barcode held in front of the lens
 *    cannot fire the sell flow repeatedly.
 *  - The same code within `duplicateWindowMs` is ignored, which is what stops a
 *    single scan from being counted twice while the navigation animates.
 */
export function ScannerScreen() {
  const navigation = useNavigation<Navigation>();
  const route = useRoute<RootScreenProps<'Scanner'>['route']>();
  const mode: ScannerMode = route.params?.mode ?? 'lookup';
  const isFocused = useIsFocused();

  const [permission, setPermission] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [torch, setTorch] = useState(false);
  const [position, setPosition] = useState<CameraPosition>('back');
  const [paused, setPaused] = useState(false);
  const [feedback, setFeedback] = useState<{tone: 'ok' | 'warn'; text: string} | null>(null);

  const device = useCameraDevice(position);

  const lastCode = useRef<{value: string; at: number} | null>(null);
  const busy = useRef(false);
  /** Set once the screen has handed a result back, so blur does not send null too. */
  const settled = useRef(false);

  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const status = await permissionService.requestCamera();
      if (!cancelled) {
        setPermission(status === 'granted' ? 'granted' : 'denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sweep, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [sweep]);

  // A pending scanFromCamera() promise must always settle, even if the user
  // swipes back rather than pressing Cancel.
  useEffect(() => {
    return navigation.addListener('beforeRemove', () => {
      if (mode === 'request' && !settled.current) {
        settled.current = true;
        fulfilScanRequest(null);
      }
    });
  }, [navigation, mode]);

  const handleDetection = useCallback(
    async (result: BarcodeResult) => {
      if (busy.current) {
        return;
      }
      busy.current = true;
      setPaused(true);
      Vibration.vibrate(40);

      try {
        if (mode === 'request' || mode === 'assign') {
          settled.current = true;
          fulfilScanRequest(result);
          navigation.goBack();
          return;
        }

        const product = await products.findByBarcode(result.value);
        if (product) {
          setFeedback({tone: 'ok', text: product.name});
          navigation.replace('ProductDetail', {productId: product.id});
        } else {
          setFeedback({tone: 'warn', text: 'No product for that barcode'});
          navigation.replace('ScanResult', {barcode: result.value, productId: null});
        }
      } catch {
        setFeedback({tone: 'warn', text: 'Could not look that barcode up. Try again.'});
        busy.current = false;
        setTimeout(() => setPaused(false), SCANNER.pauseAfterScanMs);
      }
    },
    [mode, navigation],
  );

  const onCodeScanned = useCallback(
    (codes: Code[]) => {
      if (paused || busy.current) {
        return;
      }
      for (const code of codes) {
        const value = normalizeBarcode(code.value ?? '');
        if (value.length < 4) {
          continue;
        }
        const now = Date.now();
        const previous = lastCode.current;
        if (previous && previous.value === value && now - previous.at < SCANNER.duplicateWindowMs) {
          continue;
        }
        lastCode.current = {value, at: now};
        void handleDetection({value, format: toBarcodeFormat(code.type)});
        return;
      }
    },
    [paused, handleDetection],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['ean-13', 'ean-8', 'upc-a', 'upc-e', 'code-128', 'code-39', 'code-93', 'itf', 'codabar', 'qr'],
    onCodeScanned,
  });

  const cancel = () => {
    if (mode === 'request' && !settled.current) {
      settled.current = true;
      fulfilScanRequest(null);
    }
    navigation.goBack();
  };

  if (permission === 'checking') {
    return (
      <View style={styles.fallback}>
        <ActivityIndicator color={colors.white} size="large" />
        <Text style={styles.fallbackText}>Preparing the camera…</Text>
      </View>
    );
  }

  if (permission === 'denied') {
    return (
      <SafeAreaView style={styles.fallback}>
        <Text style={styles.fallbackTitle}>Camera permission needed</Text>
        <Text style={styles.fallbackText}>
          Scanning uses the camera on this device only. Nothing is uploaded anywhere.
        </Text>
        <Button
          title="Open settings"
          onPress={() => permissionService.showCameraDeniedDialog()}
          style={styles.fallbackButton}
        />
        <Button title="Go back" variant="ghost" onPress={cancel} style={styles.fallbackButton} />
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={styles.fallback}>
        <Text style={styles.fallbackTitle}>No camera available</Text>
        <Text style={styles.fallbackText}>
          This device reported no usable camera. You can still type barcodes in by hand.
        </Text>
        <Button title="Go back" variant="ghost" onPress={cancel} style={styles.fallbackButton} />
      </SafeAreaView>
    );
  }

  const sweepTranslate = sweep.interpolate({inputRange: [0, 1], outputRange: [0, 150]});

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.black} />
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isFocused && !paused}
        codeScanner={codeScanner}
        torch={torch ? 'on' : 'off'}
        enableZoomGesture
      />

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>
            {mode === 'lookup' ? 'Scan to sell' : 'Scan a barcode'}
          </Text>
          <Text style={styles.subtitle}>Hold the barcode inside the frame</Text>
        </View>

        <View style={styles.frameWrap}>
          <View style={styles.frame}>
            <View style={[styles.corner, styles.topLeft]} />
            <View style={[styles.corner, styles.topRight]} />
            <View style={[styles.corner, styles.bottomLeft]} />
            <View style={[styles.corner, styles.bottomRight]} />
            {!paused ? (
              <Animated.View
                style={[styles.sweep, {transform: [{translateY: sweepTranslate}]}]}
              />
            ) : null}
          </View>
          {feedback ? (
            <View
              style={[
                styles.feedback,
                feedback.tone === 'ok' ? styles.feedbackOk : styles.feedbackWarn,
              ]}>
              <Text style={styles.feedbackText} numberOfLines={1}>
                {feedback.tone === 'ok' ? '✓ ' : '! '}
                {feedback.text}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Toggle torch"
            onPress={() => setTorch(previous => !previous)}
            style={[styles.control, torch && styles.controlActive]}>
            <Text style={styles.controlGlyph}>{torch ? '☀' : '☼'}</Text>
            <Text style={styles.controlLabel}>Torch</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel scanning"
            onPress={cancel}
            style={[styles.control, styles.controlWide]}>
            <Text style={styles.controlLabel}>Cancel</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch camera"
            onPress={() => setPosition(current => (current === 'back' ? 'front' : 'back'))}
            style={styles.control}>
            <Text style={styles.controlGlyph}>⇄</Text>
            <Text style={styles.controlLabel}>Flip</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.black,
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  header: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  title: {
    color: colors.white,
    fontSize: fontSize.xl,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: fontSize.md,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  frameWrap: {
    alignItems: 'center',
  },
  frame: {
    borderRadius: radius.lg,
    height: 190,
    overflow: 'hidden',
    width: '82%',
  },
  corner: {
    borderColor: colors.white,
    height: 34,
    position: 'absolute',
    width: 34,
  },
  topLeft: {borderLeftWidth: 4, borderTopWidth: 4, left: 0, top: 0},
  topRight: {borderRightWidth: 4, borderTopWidth: 4, right: 0, top: 0},
  bottomLeft: {borderBottomWidth: 4, borderLeftWidth: 4, bottom: 0, left: 0},
  bottomRight: {borderBottomWidth: 4, borderRightWidth: 4, bottom: 0, right: 0},
  sweep: {
    backgroundColor: colors.accent,
    height: 2,
    left: 12,
    position: 'absolute',
    right: 12,
    top: 20,
  },
  feedback: {
    borderRadius: radius.pill,
    marginTop: spacing.lg,
    maxWidth: '82%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  feedbackOk: {
    backgroundColor: colors.success,
  },
  feedbackWarn: {
    backgroundColor: colors.warning,
  },
  feedbackText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  control: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.md,
    justifyContent: 'center',
    minWidth: 76,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  controlWide: {
    flex: 1,
  },
  controlActive: {
    backgroundColor: colors.warning,
  },
  controlGlyph: {
    color: colors.white,
    fontSize: 20,
  },
  controlLabel: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginTop: 2,
  },
  fallback: {
    alignItems: 'center',
    backgroundColor: colors.black,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  fallbackTitle: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
    textAlign: 'center',
  },
  fallbackText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: fontSize.md,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  fallbackButton: {
    marginTop: spacing.lg,
    minWidth: 200,
  },
});
