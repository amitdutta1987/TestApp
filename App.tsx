import {NavigationContainer} from '@react-navigation/native';
import React, {useCallback, useEffect, useState} from 'react';
import {ActivityIndicator, StatusBar, StyleSheet, Text, View} from 'react-native';
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
        <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />
        {boot.status === 'ready' ? (
          <NavigationContainer ref={navigationRef}>
            <RootNavigator />
          </NavigationContainer>
        ) : (
          <View style={styles.centre}>
            {boot.status === 'loading' ? (
              <>
                <Text style={styles.title}>{APP.name}</Text>
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
    flex: 1,
  },
  centre: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  title: {
    color: colors.primary,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    letterSpacing: 1,
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
