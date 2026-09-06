import React from 'react';
import { Pressable, StyleProp, ViewStyle } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

interface BackButtonProps {
  onPress: () => void;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

/** The one back-button design used everywhere in the app — a plain bold
 * arrow, nothing else. Every screen used to build its own version: a dark
 * "← Back" pill with a border, a grey "Back to Marketplace" text link, or
 * an icon-only ChevronLeft — three different looks for the same action.
 * This replaces all of them. */
export function BackButton({ onPress, color = '#0f172a', size = 26, style }: BackButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={[{ width: 34, height: 34, alignItems: 'flex-start', justifyContent: 'center' }, style]}
    >
      <ArrowLeft size={size} color={color} strokeWidth={2.75} />
    </Pressable>
  );
}
