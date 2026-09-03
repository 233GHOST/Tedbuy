import React from 'react';
import { Keyboard, TouchableWithoutFeedback, View, ViewStyle } from 'react-native';

/** Tapping anywhere that isn't itself an interactive control (a TextInput,
 * a button, etc.) dismisses the open keyboard — applied once here at the
 * app root (covers every regular screen) and individually inside each
 * <Modal> that has its own TextInput, since a Modal renders in its own
 * native root and isn't covered by the app-root wrapper. */
export function DismissKeyboardView({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={[{ flex: 1 }, style]}>{children}</View>
    </TouchableWithoutFeedback>
  );
}
