import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native';
import { MorphText } from 'norph';

// Each chip steps through its own values; the first press switches to it.
const SAMPLES = [
  { label: 'Episode', values: ['S01E04', 'S01E05', 'S01E06', 'S02E01'] },
  { label: 'Count', values: ['9', '10', '99', '100', '1,000'] },
  { label: 'Price', values: ['$1,299.99', '$999.00', '$12.50'] },
  { label: 'Label', values: ['Show more', 'Show less'] },
  { label: 'Words', values: ['Mark as watched', 'Remove from watchlist'] },
];

export default function App() {
  const dark = useColorScheme() === 'dark';
  const colors = dark
    ? { fg: '#f3f3f3', muted: '#a3a3a3', line: '#2e2e2e', active: '#262626' }
    : { fg: '#1c1c1c', muted: '#6b6b6b', line: '#e6e6e6', active: '#f2f2f2' };
  const [sample, setSample] = useState(0);
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState<string | null>(null);
  const values = SAMPLES[sample].values;
  const text = typed ?? values[step % values.length];

  const press = (index: number) => {
    setTyped(null);
    if (index === sample && typed === null) {
      setStep(step + 1);
    } else {
      setSample(index);
      setStep(0);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.stage}>
        <MorphText style={[styles.display, { color: colors.fg }]}>{text}</MorphText>
      </View>
      <View style={styles.chips}>
        {SAMPLES.map((item, index) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            onPress={() => press(index)}
            style={({ pressed }) => [
              styles.chip,
              { borderColor: colors.line },
              index === sample && typed === null && { backgroundColor: colors.active },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.chipText, { color: colors.fg }]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={typed ?? ''}
        onChangeText={setTyped}
        placeholder="Or type anything"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={24}
        style={[styles.input, { color: colors.fg, borderColor: colors.line }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24, padding: 16 },
  stage: { height: 72, justifyContent: 'center', alignItems: 'center' },
  display: { fontSize: 48, fontWeight: '600', letterSpacing: -0.5, alignSelf: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  chipText: { fontSize: 13 },
  pressed: { transform: [{ scale: 0.97 }] },
  input: {
    width: 240,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: 'center',
  },
});
