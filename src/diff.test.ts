import { describe, expect, test } from 'bun:test';

import { diffSegments, segmentText } from './diff';
import { planMoves } from './plan';

/** For each new segment, the index of the old segment it keeps, or `null` when it enters. */
function kept(from: string, to: string) {
  const previous = segmentText(from);
  const { segments } = diffSegments(previous, to);
  return segments.map((segment) => {
    const index = previous.findIndex((old) => old.id === segment.id);
    return index === -1 ? null : index;
  });
}

describe('diffSegments', () => {
  test('same text keeps every segment', () => {
    expect(kept('Show more', 'Show more')).toEqual([0, 1, 2]);
  });

  test('an episode step keeps every glyph but the changed one, which fades', () => {
    expect(kept('S01E04', 'S01E05')).toEqual([0, 1, 2, 3, 4, null]);
    expect(diffSegments(segmentText('S01E04'), 'S01E05').segments.at(-1)?.kind).toBeUndefined();
  });

  test('a count matches digits by place value, so a carry rolls every changed digit', () => {
    expect(kept('9', '10')).toEqual([null, null]);
    expect(kept('99', '100')).toEqual([null, null, null]);
    expect(kept('10', '11')).toEqual([0, null]);
    expect(diffSegments(segmentText('9'), '10').segments.map((segment) => segment.kind)).toEqual([
      'digit',
      'digit',
    ]);
  });

  test('a number aligns on the decimal point', () => {
    expect(kept('1.5', '12.5')).toEqual([0, null, 1, 2]);
  });

  test('a swapped word enters whole beside the words it keeps', () => {
    expect(kept('Show more', 'Show less')).toEqual([0, 1, null]);
  });

  test('splits by code point, not UTF-16 unit', () => {
    expect(segmentText('忍🍿').map((segment) => segment.string)).toEqual(['忍', '🍿']);
  });
});

describe('planMoves', () => {
  test('an entering segment rides in with the neighbour before it', () => {
    const box = (x: number) => ({ x, width: 10 });
    const before = segmentText('a b');
    const { segments } = diffSegments(before, 'xa b c');
    const previous = new Map(before.map((segment, index) => [segment.id, box(index * 10)]));
    const next = new Map(segments.map((segment, index) => [segment.id, box(index * 10)]));
    // "b" moves from 20 to 30, so "c" starts 10 short of its slot at 50.
    const moves = planMoves(
      before.map((segment) => segment.id),
      segments,
      previous,
      next,
    );
    const last = segments.at(-1)!;
    expect(moves.get(last.id)).toEqual({ type: 'enter', x: 40 });
  });
});
