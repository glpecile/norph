import { type ReactNode, useRef, useState } from 'react';
import {
  type LayoutRectangle,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from 'react-native';
import Animated, {
  Easing,
  makeMutable,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { diffSegments, type Segment, segmentText } from './diff';
import { type Box, planMoves } from './plan';

export { diffSegments, segmentText, type Segment } from './diff';

// `className` reaches the core components when the app resolves it (Uniwind
// redirects `react-native` imports to components that read it). Elsewhere it
// is ignored. Declared here, not in a .d.ts, so it loads with every import.
declare module 'react-native' {
  interface TextProps {
    className?: string;
  }
  interface ViewProps {
    className?: string;
  }
}

export interface MorphTextProps {
  /** The current text. A change morphs in place. */
  children: string | number;
  /**
   * Classes for the text (font, size, color) and the outer box (margins,
   * alignment). Works where `Text` resolves `className`, as with Uniwind.
   */
  className?: string;
  /** Same split as `className`: text styles reach every glyph, the rest the outer box. */
  style?: StyleProp<TextStyle>;
  /** Line cap, as on `Text`. Setting it opts out of the morph. */
  numberOfLines?: number;
}

// torph's defaults.
const DURATION = 400;
const EASE = Easing.bezier(0.19, 1, 0.22, 1);
const EMPTY: Segment = { id: 'empty', string: '​' };

const glide = (to: number) => withTiming(to, { duration: DURATION, easing: EASE });
/** A linear fade over `share` of the duration, after `delay` of it. */
const fade = (to: number, share: number, delay = 0) => {
  const timing = withTiming(to, { duration: DURATION * share, easing: Easing.linear });
  return delay > 0 ? withDelay(DURATION * delay, timing) : timing;
};

interface Glyph {
  /** React key: unique per node, while `id` can return before its old node finishes exiting. */
  key: number;
  id: string;
  string: string;
  /** A character of a number: it rolls in a clipped slot instead of fading in place. */
  rolls: boolean;
  width: number;
  exiting: boolean;
  x: SharedValue<number>;
  scale: SharedValue<number>;
  opacity: SharedValue<number>;
  /** Group scale pivot, as an offset from the glyph's centre. */
  origin: SharedValue<number>;
  rollY: SharedValue<number>;
  rollOpacity: SharedValue<number>;
}

interface Motion {
  glyphs: Glyph[];
  width: SharedValue<number>;
  height: number;
}

interface Measures {
  text: string;
  done: boolean;
  before: Map<string, LayoutRectangle>;
  after: Map<string, LayoutRectangle>;
}

let glyphKey = 0;
const newGlyph = (segment: Segment, width: number, x: number, from: Partial<Record<'scale' | 'opacity' | 'rollY' | 'rollOpacity', number>> = {}): Glyph => ({
  key: glyphKey++,
  id: segment.id,
  string: segment.string,
  rolls: segment.kind != null,
  width,
  exiting: false,
  x: makeMutable(x),
  scale: makeMutable(from.scale ?? 1),
  opacity: makeMutable(from.opacity ?? 1),
  origin: makeMutable(0),
  rollY: makeMutable(from.rollY ?? 0),
  rollOpacity: makeMutable(from.rollOpacity ?? 1),
});

const widthOf = (boxes: Map<string, Box>) =>
  Math.max(0, ...Array.from(boxes.values(), (box) => box.x + box.width));

/**
 * Text that morphs into its next value, as torph does on the web: segments
 * the old and new text share slide to their new places, new ones enter,
 * dropped ones exit, digits of a number roll by place value, and the box
 * animates its width. The first render, reduced motion, and `numberOfLines`
 * render plain `Text`, and so does the text at rest once a morph ends.
 *
 * Runs one line that never wraps: at rest, text too long for its box ends in
 * an ellipsis. While it moves, the text sits at the start edge, so
 * shrink-wrap it (`alignSelf`) when alignment matters.
 */
export function MorphText({ children, className, style, numberOfLines }: MorphTextProps) {
  const text = String(children);
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(() => ({ text, segments: segmentText(text) }));
  const [motion, setMotion] = useState<Motion | null>(null);
  const measures = useRef<Measures | null>(null);
  const generation = useRef(0);

  if (reduceMotion || numberOfLines != null) {
    if (shown.text !== text) {
      setShown({ text, segments: segmentText(text) });
      setMotion(null);
    }
    return (
      <Text className={className} style={style} numberOfLines={numberOfLines}>
        {text}
      </Text>
    );
  }

  const pending = shown.text !== text;
  const diff = pending ? diffSegments(shown.segments, text) : null;
  const before = diff
    ? shown.segments.flatMap((segment) => diff.splits.get(segment.id) ?? [segment])
    : [];
  const after = diff ? (diff.segments.length > 0 ? diff.segments : [EMPTY]) : [];

  const settle = (done: number) => {
    if (generation.current === done) setMotion(null);
  };

  const start = ({ before: previous, after: next }: Measures) => {
    const moves = planMoves(
      before.map((segment) => segment.id),
      after,
      previous,
      next,
    );
    const live = new Map(motion?.glyphs.filter((glyph) => !glyph.exiting).map((glyph) => [glyph.id, glyph]));
    const height = Math.max(0, ...Array.from(next.values(), (box) => box.height));
    // Exits sit under the live glyphs. Exits already underway keep going; the
    // morph ends before they could show.
    const glyphs: Glyph[] = motion?.glyphs.filter((glyph) => glyph.exiting) ?? [];

    for (const segment of before) {
      const move = moves.get(segment.id);
      if (move?.type !== 'exit') continue;
      const box = previous.get(segment.id)!;
      const glyph = { ...(live.get(segment.id) ?? newGlyph(segment, box.width, box.x)), exiting: true };
      if (move.origin != null) {
        glyph.origin.set(move.origin);
        glyph.scale.set(glide(0.8));
        glyph.opacity.set(fade(0, 0.45));
      } else if (glyph.rolls) {
        glyph.x.set(glide(move.x));
        glyph.rollY.set(glide(height));
        glyph.rollOpacity.set(fade(0, 0.45));
      } else {
        glyph.x.set(glide(move.x));
        glyph.scale.set(glide(0.95));
        glyph.opacity.set(fade(0, 0.25));
      }
      glyphs.push(glyph);
    }

    for (const segment of after) {
      const box = next.get(segment.id)!;
      const move = moves.get(segment.id)!;
      const prior = live.get(segment.id);
      if (move.type === 'stay') {
        const glyph = prior
          ? { ...prior, width: box.width }
          : newGlyph(segment, box.width, previous.get(segment.id)!.x);
        glyph.x.set(glide(box.x));
        if (!glyph.rolls) {
          glyph.scale.set(glide(1));
          glyph.opacity.set(fade(1, 0.25));
        }
        glyphs.push(glyph);
      } else if (move.type === 'enter' && move.origin != null) {
        const glyph = newGlyph(segment, box.width, box.x, { scale: 0.8, opacity: 0 });
        glyph.origin.set(move.origin);
        glyph.scale.set(glide(1));
        glyph.opacity.set(fade(1, 0.35));
        glyphs.push(glyph);
      } else if (segment.kind) {
        // Digits drop in from above, symbols rise from below.
        const rollY = segment.kind === 'digit' ? -height : height;
        const glyph = newGlyph(segment, box.width, move.x, { rollY, rollOpacity: 0 });
        glyph.x.set(glide(box.x));
        glyph.rollY.set(glide(0));
        glyph.rollOpacity.set(fade(1, 0.25));
        glyphs.push(glyph);
      } else {
        const glyph = newGlyph(segment, box.width, move.x, { scale: 0.95, opacity: 0 });
        glyph.x.set(glide(box.x));
        glyph.scale.set(glide(1));
        glyph.opacity.set(fade(1, 0.5, 0.25));
        glyphs.push(glyph);
      }
    }

    const width = motion?.width ?? makeMutable(widthOf(previous));
    const from = width.get();
    const to = diff!.segments.length === 0 ? from : widthOf(next);
    width.set(from === 0 ? to : glide(to));
    const done = ++generation.current;
    const clock = makeMutable(0);
    clock.set(
      withTiming(1, { duration: DURATION }, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(settle, done);
      }),
    );
    setMotion({ glyphs, width, height });
    setShown({ text, segments: after });
  };

  const measure = (row: 'before' | 'after', id: string, layout: LayoutRectangle) => {
    if (measures.current?.text !== text) {
      measures.current = { text, done: false, before: new Map(), after: new Map() };
    }
    const current = measures.current;
    current[row].set(id, layout);
    if (!current.done && current.before.size === before.length && current.after.size === after.length) {
      current.done = true;
      start(current);
    }
  };

  // One line at rest too, so a morph never unwraps the text. While the glyphs
  // move, the same text is the reader, so the box keeps its baseline.
  const label = (
    <Text className={className} style={[style, RESET, motion && styles.reader]} numberOfLines={1}>
      {shown.text}
    </Text>
  );

  return (
    <View className={className} style={style}>
      {motion ? (
        <Sizer width={motion.width} height={motion.height}>
          {label}
          {motion.glyphs.map((glyph) => (
            <GlyphView
              key={glyph.key}
              glyph={glyph}
              height={motion.height}
              className={className}
              style={style}
            />
          ))}
        </Sizer>
      ) : label}
      {pending ? (
        <View key={text} style={styles.measure} aria-hidden>
          {(['before', 'after'] as const).map((row) => (
            <View key={row} style={styles.row}>
              {(row === 'before' ? before : after).map((segment) => (
                <Text
                  key={segment.id}
                  className={className}
                  style={[style, RESET]}
                  onLayout={(event) => measure(row, segment.id, event.nativeEvent.layout)}
                >
                  {segment.string}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Sizer({ width, height, children }: { width: SharedValue<number>; height: number; children: ReactNode }) {
  const animated = useAnimatedStyle(() => ({ width: width.value }));
  return (
    <Animated.View style={[{ height }, animated]}>
      {children}
    </Animated.View>
  );
}

function GlyphView({
  glyph: { x, scale, opacity, origin, rollY, rollOpacity, rolls, width, string },
  height,
  className,
  style,
}: {
  glyph: Glyph;
  height: number;
  className?: string;
  style?: StyleProp<TextStyle>;
}) {
  const outer = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value + origin.value * (1 - scale.value) }, { scale: scale.value }],
  }));
  const inner = useAnimatedStyle(() => ({
    opacity: rollOpacity.value,
    transform: [{ translateY: rollY.value }],
  }));
  return (
    // One spare point of width, so rounding never wraps the glyph.
    <Animated.View aria-hidden style={[styles.glyph, { width: width + 1, height }, rolls && styles.slot, outer]}>
      <Animated.View style={inner}>
        <Text className={className} style={[style, RESET]}>
          {string}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The outer box owns margins and padding, so the glyphs inside drop them.
 * Longhands, because a class's `marginTop` beats a `margin` shorthand.
 */
const RESET: TextStyle = {
  marginTop: 0,
  marginBottom: 0,
  marginLeft: 0,
  marginRight: 0,
  marginStart: 0,
  marginEnd: 0,
  marginHorizontal: 0,
  marginVertical: 0,
  paddingTop: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  paddingRight: 0,
  paddingStart: 0,
  paddingEnd: 0,
  paddingHorizontal: 0,
  paddingVertical: 0,
};

const styles = StyleSheet.create({
  glyph: { position: 'absolute', left: 0, top: 0 },
  // A rolling digit slides a full line, so its slot clips it.
  slot: { overflow: 'hidden' },
  // The whole string once, unseen, while the glyphs move. Screen readers read
  // it, and it is the box's only text in the layout flow, so it gives the box
  // the baseline the text at rest has. Not `transparent`: Android reads that
  // value as no color and draws the text in the default one. A shadow and an
  // underline keep their own color, so they go too.
  reader: { color: '#00000001', textShadowRadius: 0, textShadowOffset: { width: 0, height: 0 }, textDecorationLine: 'none' },
  // Lays both rows out unconstrained and unseen; the wide row never wraps a word.
  measure: { position: 'absolute', width: 0, height: 0, overflow: 'hidden' },
  row: { position: 'absolute', top: 0, left: 0, width: 10000, flexDirection: 'row', alignItems: 'flex-start' },
});
