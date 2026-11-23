import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { MorphText } from '@glpecile/norph';

// The site's palette in hex, since native has no oklch(): each hue at L 0.52
// (light) and L 0.8 (dark), at one share of its chroma ceiling.
const HUES = {
  violet: { light: '#8230d8', dark: '#c6b2ec' },
  green: { light: '#267c41', dark: '#6bd987' },
  amber: { light: '#8c5e21', dark: '#edb068' },
  blue: { light: '#2268ba', dark: '#9fc1ec' },
  pink: { light: '#b02978', dark: '#eda4c6' },
};

interface Amount {
  start: number;
  step: number;
  max: number;
  /** Decimal places a shuffle keeps. */
  places: number;
  format: (value: number) => string;
}

const count = new Intl.NumberFormat('en-US');
const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

// Each chip steps through its own values; the first press switches to it.
// A sample with an `amount` is a number that −, +, and Shuffle change.
const SAMPLES: { label: string; hue: { light: string; dark: string }; values?: string[]; amount?: Amount }[] = [
  { label: 'Episode', hue: HUES.violet, values: ['S01E04', 'S01E05', 'S01E06', 'S02E01'] },
  { label: 'Count', hue: HUES.green, amount: { start: 9, step: 1, max: 99_999, places: 0, format: count.format } },
  { label: 'Price', hue: HUES.amber, amount: { start: 1299.99, step: 1, max: 9_999, places: 2, format: price.format } },
  { label: 'Label', hue: HUES.blue, values: ['Show more', 'Show less'] },
  { label: 'Words', hue: HUES.pink, values: ['Mark as watched', 'Remove from watchlist'] },
];
const MAX_LENGTH = 24;

export default function App() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors =
    scheme === 'dark'
      ? { fg: '#f3f3f3', muted: '#a3a3a3', line: '#2e2e2e' }
      : { fg: '#1c1c1c', muted: '#6b6b6b', line: '#e6e6e6' };
  const { width } = useWindowDimensions();
  // The longest text fits on one line: about 0.55 em per glyph at this weight.
  const fontSize = Math.min(48, Math.floor((width - 32) / (MAX_LENGTH * 0.55)));
  const [sample, setSample] = useState(0);
  const [step, setStep] = useState(0);
  const [value, setValue] = useState(0);
  const [typed, setTyped] = useState<string | null>(null);
  const { values, amount, hue } = SAMPLES[sample];
  const text = typed ?? (amount ? amount.format(value) : values![step % values!.length]);
  const tint = hue[scheme];
  const counting = amount != null && typed === null;

  const press = (index: number) => {
    setTyped(null);
    if (index === sample && typed === null) {
      if (amount) setValue(Math.min(amount.max, value + amount.step));
      else setStep(step + 1);
    } else {
      setSample(index);
      setStep(0);
      setValue(SAMPLES[index].amount?.start ?? 0);
    }
  };

  const shuffle = () => {
    if (!amount) return;
    const scale = 10 ** amount.places;
    setValue(Math.round(Math.random() * amount.max * scale) / scale);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.stage, { height: fontSize * 1.5 }]}>
        <MorphText style={[styles.display, { color: tint, fontSize }]}>{text}</MorphText>
      </View>
      <View style={styles.chips}>
        {SAMPLES.map((item, index) => {
          const active = index === sample && typed === null;
          const hue = item.hue[scheme];
          return (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => press(index)}
              style={({ pressed }) => [
                styles.chip,
                { borderColor: active ? hue : colors.line },
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.dot, { backgroundColor: hue }]} />
              <Text style={[styles.chipText, { color: active ? hue : colors.fg }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {/* Keeps its space on text samples, so switching samples never shifts the layout. */}
      <View
        style={[styles.controls, !counting && styles.hidden]}
        aria-hidden={!counting}
      >
        <Control label="−" accessibilityLabel="Minus" color={colors} disabled={!amount || value - amount.step < 0} onPress={() => amount && setValue(value - amount.step)} />
        <Control label="+" accessibilityLabel="Plus" color={colors} disabled={!amount || value + amount.step > amount.max} onPress={() => amount && setValue(value + amount.step)} />
        <Control label="Shuffle" color={colors} onPress={shuffle} />
      </View>
      <TextInput
        value={typed ?? ''}
        onChangeText={setTyped}
        placeholder="Or type anything"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={MAX_LENGTH}
        style={[styles.input, { color: colors.fg, borderColor: colors.line }]}
      />
    </View>
  );
}

function Control({
  label,
  accessibilityLabel,
  color,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  color: { fg: string; line: string };
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        { borderColor: color.line },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.controlText, { color: color.fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24, padding: 16 },
  stage: { justifyContent: 'center', alignItems: 'center', alignSelf: 'stretch' },
  display: { fontWeight: '600', letterSpacing: -0.5, alignSelf: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: 13 },
  pressed: { transform: [{ scale: 0.97 }] },
  controls: { flexDirection: 'row', gap: 8 },
  hidden: { opacity: 0, pointerEvents: 'none' },
  control: {
    minWidth: 44,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  controlText: { fontSize: 16 },
  disabled: { opacity: 0.4 },
  input: {
    width: 240,
    maxWidth: '100%',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: 'center',
  },
});
