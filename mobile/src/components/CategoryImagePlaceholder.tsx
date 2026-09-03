import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { ImageOff } from 'lucide-react-native';
import { getCategoryPlaceholderColor } from '../utils/productImage';

/** Rendered instead of an <Image> whenever resolveProductImageUri() finds no
 * real photo or video-poster to show — an honest, category-tinted "no photo
 * yet" box, never a random unrelated stock photo (see productImage.ts). */
export function CategoryImagePlaceholder({
  category,
  style,
  iconSize = 22,
}: {
  category?: string;
  style?: ViewStyle;
  iconSize?: number;
}) {
  const color = getCategoryPlaceholderColor(category);
  return (
    <View style={[styles.box, { backgroundColor: `${color}1A`, borderColor: `${color}40` }, style]}>
      <ImageOff size={iconSize} color={color} strokeWidth={1.8} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
