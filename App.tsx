import {NavigationContainer} from '@react-navigation/native';
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, Image, StatusBar, StyleSheet, Text, View} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Button} from '@/components/Button';
import {APP} from '@/constants/config';
import {colors, fontSize, spacing} from '@/constants/theme';
import {initDatabase} from '@/database/database';
import {RootNavigator} from '@/navigation/RootNavigator';
import {navigationRef} from '@/navigation/navigationRef';
import {ensureStorageDirs} from '@/services/ImageStorageService';
import {syncEngine} from '@/sync/SyncEngine';
import {toUserMessage} from '@/utils/errors';

type Boot = {status: 'loading'} | {status: 'ready'} | {status: 'failed'; message: string};

/**
 * Nothing renders until SQLite is open and migrated. Repositories resolve the
 * driver lazily, but a screen that queried before this finished would still see
 * an empty app, so the gate is explicit.
 */
export default function App() {
  const [boot, setBoot] = useState<Boot>({status: 'loading'});

  const start = useCallback(async () => {
    setBoot({status: 'loading'});
    try {
      await initDatabase();
      await ensureStorageDirs();
      setBoot({status: 'ready'});
      /**
       * Started after the gate opens, never awaited. Sync is a background
       * convenience; blocking the counter on a network round-trip would defeat
       * the point of keeping SQLite as the working store. start() is a no-op
       * when no sync server is configured.
       */
      syncEngine.start();
    } catch (error) {
      setBoot({status: 'failed', message: toUserMessage(error)});
    }
  }, []);

  useEffect(() => {
    void start();
    return () => syncEngine.stop();
  }, [start]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {/*
          Android 15+ enforces edge-to-edge and ignores StatusBar's
          backgroundColor entirely — the bar is transparent and shows whatever
          view sits behind it, which is the root below. The prop is kept for
          Android 14 and older, where it still applies. Dark icons, because that
          strip is now the cream body colour rather than the maroon header.
        */}
        <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
        {boot.status === 'ready' ? (
          <NavigationContainer ref={navigationRef}>
            <RootNavigator />
          </NavigationContainer>
        ) : (
          <View style={styles.centre}>
            {boot.status === 'loading' ? (
              <>
                <Image
                  source={require('@/assets/logo.png')}
                  style={styles.logo}
                  // The artwork is already a disc with a transparent surround;
                  // the radius here only guards against a non-square render.
                  accessibilityLabel={`${APP.name} logo`}
                />
                <Text style={styles.title}>{APP.name}</Text>
                <Text style={styles.tagline}>{APP.tagline}</Text>
                <ActivityIndicator color={colors.primary} size="large" style={styles.spinner} />
              </>
            ) : (
              <>
                <Text style={styles.errorTitle}>The app could not start</Text>
                <Text style={styles.errorBody}>{boot.message}</Text>
                <Button title="Try again" style={styles.retry} onPress={() => void start()} />
              </>
            )}
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    // Painted, not left transparent: this is what shows through the status bar
    // on edge-to-edge Android, so the strip above the header reads as body
    // rather than as a white band.
    backgroundColor: colors.background,
    flex: 1,
  },
  centre: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  logo: {
    borderRadius: 64,
    height: 128,
    width: 128,
  },
  title: {
    color: colors.primary,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: spacing.lg,
  },
  tagline: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    letterSpacing: 2,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
  },
  spinner: {
    marginTop: spacing.xl,
  },
  errorTitle: {
    color: colors.danger,
    fontSize: fontSize.lg,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorBody: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    lineHeight: 22,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  retry: {
    marginTop: spacing.xl,
  },
});
