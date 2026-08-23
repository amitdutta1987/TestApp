import {useNavigation} from '@react-navigation/native';
import React from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Card} from '@/components/Card';
import {Screen} from '@/components/Screen';
import {APP} from '@/constants/config';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import type {TabScreenProps} from '@/navigation/types';

type Item = {
  glyph: string;
  title: string;
  subtitle: string;
  onPress: () => void;
};

export function MoreScreen() {
  const navigation = useNavigation<TabScreenProps<'More'>['navigation']>();

  const items: Item[] = [
    {
      glyph: '＋',
      title: 'Add a product',
      subtitle: 'Scan or type a barcode, then fill in the details',
      onPress: () => navigation.navigate('ProductForm', {}),
    },
    {
      glyph: '⛶',
      title: 'Scan a barcode',
      subtitle: 'Live camera scan for a quick lookup or sale',
      onPress: () => navigation.navigate('Scanner', {mode: 'lookup'}),
    },
    {
      glyph: '🖼',
      title: 'Read a barcode from a photo',
      subtitle: 'For barcodes that are small, angled or off-centre',
      onPress: () => navigation.navigate('ImageBarcode', {returnTo: 'ProductForm'}),
    },
    {
      glyph: '⇄',
      title: 'Stock history',
      subtitle: 'Every sale, restock, return, damage and adjustment',
      onPress: () => navigation.navigate('InventoryHistory'),
    },
    {
      glyph: '⚙',
      title: 'Settings',
      subtitle: 'Excel export, backup, restore and data management',
      onPress: () => navigation.navigate('Settings'),
    },
  ];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        {items.map(item => (
          <Pressable
            key={item.title}
            onPress={item.onPress}
            style={({pressed}) => [styles.row, pressed && styles.pressed]}>
            <View style={styles.glyphBox}>
              <Text style={styles.glyph}>{item.glyph}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}

        <Card style={styles.about}>
          <Text style={styles.aboutTitle}>{APP.name}</Text>
          <Text style={styles.aboutLine}>Version {APP.version}</Text>
          <Text style={styles.aboutBody}>
            This app works entirely on this phone. Products, sales and stock history live in a
            local database, and photos are kept in the app's private storage. Nothing is uploaded
            and no account is needed.
          </Text>
          <Text style={styles.aboutBody}>
            Keep your data safe by creating a backup from Settings and saving the .zip file
            somewhere off the phone.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.75,
  },
  glyphBox: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    height: 44,
    justifyContent: 'center',
    marginRight: spacing.md,
    width: 44,
  },
  glyph: {
    color: colors.primary,
    fontSize: fontSize.lg,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  rowSubtitle: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginTop: 2,
  },
  chevron: {
    color: colors.textFaint,
    fontSize: fontSize.xl,
    paddingLeft: spacing.sm,
  },
  about: {
    marginTop: spacing.lg,
  },
  aboutTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  aboutLine: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  aboutBody: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.md,
  },
});
