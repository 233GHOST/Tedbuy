import { Text, TextInput } from 'react-native';
import { fonts } from './theme';

/**
 * Applies Plus Jakarta Sans as the default font for every Text/TextInput,
 * so screens get the same typeface as web (src/index.css) without needing
 * fontFamily set on each individual style. Call once, before first render.
 */
export function applyGlobalFont() {
  const TextAny = Text as any;
  const TextInputAny = TextInput as any;
  TextAny.defaultProps = TextAny.defaultProps || {};
  TextAny.defaultProps.style = [{ fontFamily: fonts.medium }, TextAny.defaultProps.style];
  TextInputAny.defaultProps = TextInputAny.defaultProps || {};
  TextInputAny.defaultProps.style = [{ fontFamily: fonts.medium }, TextInputAny.defaultProps.style];
}
