// Ported from torph 0.1.3 (MIT, Lochie Axon): `segmentText`, `diffSegments`
// and `segmentNumber`, without `cursorIndex`. Newlines are not supported: the
// component renders one line.

export type SegmentKind = 'digit' | 'symbol';

/**
 * One rendered node. A segment whose `id` survives a text change keeps its
 * node and slides; a new `id` enters and a dropped one exits. Only characters
 * of a number carry a `kind`, and only they roll.
 */
export interface Segment {
  id: string;
  string: string;
  kind?: SegmentKind;
}

export interface Diff {
  segments: Segment[];
  /**
   * Old single-segment words that the diff morphs character by character.
   * Before measuring, the previous layout replaces each with these pieces.
   */
  splits: Map<string, Segment[]>;
}

const NBSP = ' ';
const SEPARATORS = `.,'${NBSP}   `;
const LEADING = '+-−(#';
const TRAILING = `%.,!?:;)"'”’`;
const CURRENCY = /\p{Sc}/u;
const NUMBER_KEY = '\0#';
// Above this many fuzzy word pairs, unmatched words enter fresh.
const MAX_FUZZY_PAIRS = 2500;
const MAX_WORD_PAIRS = 1e6;
const MIN_SIMILARITY = 0.4;
// Integer parts this far apart in length don't share digits.
const MAX_DIGIT_GAP = 3;

let freshCount = 0;
const freshId = () => `\0n${freshCount++}`;

const isDigit = (char: string) => char >= '0' && char <= '9';
const hasDigit = (text: string) => Array.from(text).some(isDigit);
const kindOf = (char: string): SegmentKind => (isDigit(char) ? 'digit' : 'symbol');
const affix = (char: string, list: string) => list.includes(char) || CURRENCY.test(char);

/** The text without digits and digit separators, so `S01E04` and `S01E05` compare equal. */
const letters = (text: string) =>
  Array.from(text)
    .filter((char) => !isDigit(char) && !SEPARATORS.includes(char))
    .join('');

/** Index pairs of a longest common subsequence, in order. */
export function lcs<T>(a: T[], b: T[]): [number[], number[]] {
  const suffix = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      suffix[i][j] =
        a[i] === b[j] ? suffix[i + 1][j + 1] + 1 : Math.max(suffix[i + 1][j], suffix[i][j + 1]);
    }
  }
  const from: number[] = [];
  const to: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      from.push(i++);
      to.push(j++);
    } else if (suffix[i + 1][j] >= suffix[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return [from, to];
}

/** A number with optional sign, currency, and trailing punctuation: `-$1,234.50`, `42%`. */
export function isNumericWord(word: string) {
  let start = 0;
  let end = word.length;
  while (start < end && affix(word[start], LEADING)) start++;
  while (end > start && affix(word[end - 1], TRAILING)) end--;
  if (start >= end || !isDigit(word[start]) || !isDigit(word[end - 1])) return false;
  for (let i = start; i < end; i++) {
    if (!isDigit(word[i]) && !SEPARATORS.includes(word[i])) return false;
  }
  return true;
}

const separatorCache = new Map<string, string>();
export function decimalSeparator(locale: string) {
  let separator = separatorCache.get(locale);
  if (separator) return separator;
  separator = '.';
  try {
    separator =
      new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')
        ?.value ?? '.';
  } catch {}
  separatorCache.set(locale, separator);
  return separator;
}

function idAllocator() {
  const used = new Set<string>();
  return {
    reserve: (id: string) => void used.add(id),
    has: (id: string) => used.has(id),
    take(id: string) {
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
      let n = 1;
      while (used.has(`${id}~${n}`)) n++;
      used.add(`${id}~${n}`);
      return `${id}~${n}`;
    },
  };
}

/**
 * Maps each new character index to the old index it keeps, matching digits
 * by place value: the integer part right-aligned on the decimal separator,
 * the fraction left-aligned after it.
 */
function matchNumber(old: string[], next: string[], decimal: string) {
  const matches = new Map<number, number>();
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start] && !isDigit(old[start])) {
    matches.set(start, start);
    start++;
  }
  let oldEnd = old.length;
  let nextEnd = next.length;
  while (
    oldEnd > start &&
    nextEnd > start &&
    old[oldEnd - 1] === next[nextEnd - 1] &&
    !isDigit(old[oldEnd - 1])
  ) {
    matches.set(nextEnd - 1, oldEnd - 1);
    oldEnd--;
    nextEnd--;
  }
  const pointIn = (chars: string[], end: number) => {
    for (let i = end - 1; i >= start; i--) if (chars[i] === decimal) return i;
    return end;
  };
  const oldPoint = pointIn(old, oldEnd);
  const nextPoint = pointIn(next, nextEnd);

  const digitsIn = (chars: string[], from: number, to: number) => {
    const positions: number[] = [];
    for (let i = from; i < to; i++) if (isDigit(chars[i])) positions.push(i);
    return positions;
  };
  const oldDigits = digitsIn(old, start, oldPoint).length;
  const nextDigits = digitsIn(next, start, nextPoint).length;
  if (oldDigits > 0 && nextDigits > 0 && Math.abs(oldDigits - nextDigits) >= MAX_DIGIT_GAP) {
    return matches;
  }

  const matchSymbol = (o: number, n: number) => {
    if (!isDigit(old[o]) && old[o] === next[n]) matches.set(n, o);
  };
  /** Returns whether an unequal-length integer part shared any digit. */
  const matchDigits = (o0: number, o1: number, n0: number, n1: number, integer: boolean) => {
    const from = digitsIn(old, o0, o1);
    const to = digitsIn(next, n0, n1);
    if (from.length === to.length || !integer) {
      for (let i = 0; i < Math.min(from.length, to.length); i++) {
        if (old[from[i]] === next[to[i]]) matches.set(to[i], from[i]);
      }
      return false;
    }
    const [a, b] = lcs(
      from.map((i) => old[i]).reverse(),
      to.map((i) => next[i]).reverse(),
    );
    for (let i = 0; i < a.length; i++) {
      matches.set(to[to.length - 1 - b[i]], from[from.length - 1 - a[i]]);
    }
    return a.length > 0;
  };

  if (!matchDigits(start, oldPoint, start, nextPoint, true)) {
    for (let h = 1; oldPoint - h >= start && nextPoint - h >= start; h++) {
      matchSymbol(oldPoint - h, nextPoint - h);
    }
  }
  if (oldPoint < oldEnd && nextPoint < nextEnd) {
    matches.set(nextPoint, oldPoint);
    for (let h = 1; oldPoint + h < oldEnd && nextPoint + h < nextEnd; h++) {
      matchSymbol(oldPoint + h, nextPoint + h);
    }
    matchDigits(oldPoint + 1, oldEnd, nextPoint + 1, nextEnd, false);
  }
  return matches;
}

/** One kinded segment per character of a numeric word, keeping ids from `previous` by place value. */
export function segmentNumber(text: string, previous?: Segment[], decimal = '.'): Segment[] {
  const chars = text.split('');
  const toSegment = (char: string, id: string): Segment => ({
    id,
    string: char === ' ' ? NBSP : char,
    kind: kindOf(char),
  });
  if (!previous || previous.length === 0) return chars.map((char) => toSegment(char, freshId()));
  const matches = matchNumber(
    previous.map((segment) => (segment.string === NBSP ? ' ' : segment.string)),
    chars,
    decimal,
  );
  const used = new Set(Array.from(matches.values(), (index) => previous[index].id));
  return chars.map((char, index) => {
    const kept = matches.get(index);
    if (kept !== undefined) return toSegment(char, previous[kept].id);
    let id = freshId();
    while (used.has(id)) id = freshId();
    used.add(id);
    return toSegment(char, id);
  });
}

interface Word {
  word: string;
  segments: Segment[];
}

function words(segments: Segment[]): Word[] {
  const result: Word[] = [];
  let current: Segment[] = [];
  const flush = () => {
    if (current.length === 0) return;
    result.push({ word: current.map((segment) => segment.string).join(''), segments: current });
    current = [];
  };
  for (const segment of segments) {
    if (segment.string === NBSP) flush();
    else current.push(segment);
  }
  flush();
  return result;
}

/**
 * First render: one segment per word when the text has spaces, else per
 * character, with numeric words split into kinded characters. A repeated
 * string takes its offset as id, so `0` and `0-4` stay apart.
 */
export function segmentText(text: string): Segment[] {
  const wordMode = text.includes(' ');
  const ids = idAllocator();
  const parts = wordMode ? text.split(' ') : Array.from(text);
  const segments: Segment[] = [];
  let offset = 0;
  parts.forEach((part, index) => {
    if (wordMode && index > 0) {
      segments.push({ id: ids.take(`space-${offset}`), string: NBSP });
      offset += 1;
    }
    if (part.length > 0) {
      segments.push({ id: ids.take(ids.has(part) ? `${part}-${offset}` : part), string: part });
    }
    offset += part.length;
  });
  return splitNumbers(segments);
}

function splitNumbers(segments: Segment[]) {
  const result: Segment[] = [];
  let current: Segment[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const word = current.map((segment) => segment.string).join('');
    result.push(...(isNumericWord(word) ? segmentNumber(word) : current));
    current = [];
  };
  for (const segment of segments) {
    if (segment.string === NBSP) {
      flush();
      result.push(segment);
    } else {
      current.push(segment);
    }
  }
  flush();
  return result;
}

/** Splits a one-segment word into characters with derived ids, recording the split. */
function splitWord(word: Word, splits: Map<string, Segment[]>): Segment[] {
  if (word.segments.length !== 1 || Array.from(word.word).length <= 1) return word.segments;
  const [segment] = word.segments;
  const pieces = Array.from(word.word).map((string, index) => ({ id: `${segment.id}:${index}`, string }));
  splits.set(segment.id, pieces);
  return pieces;
}

function lcsRatio(a: string, b: string) {
  if (a.length === 0 || b.length === 0) return 0;
  return lcs(a.split(''), b.split(''))[0].length / Math.max(a.length, b.length);
}

const similarity = (a: string, b: string) =>
  (hasDigit(a) || hasDigit(b)) && letters(a) === letters(b) ? 1 : lcsRatio(a, b);

/** For each index, how many matched indices come before it. */
function rankBefore(length: number, matched: Set<number>) {
  const ranks: number[] = [];
  let rank = 0;
  for (let i = 0; i < length; i++) {
    ranks.push(rank);
    if (matched.has(i)) rank++;
  }
  return ranks;
}

type WordPlan =
  | { mode: 'fresh' }
  | { mode: 'reuse' | 'number' | 'morph'; from: number };

/**
 * Re-segments `text` against the segments on screen. Words pair up by LCS,
 * then by exact match, then by similarity at the same position. A kept word
 * keeps its segments, a number keeps digits by place value, a similar word
 * morphs per character, and the rest enter fresh.
 */
export function diffSegments(previous: Segment[], text: string, locale = 'en'): Diff {
  if (previous.length === 0) return { segments: segmentText(text), splits: new Map() };
  const oldWords = words(previous);
  const key = (word: string) => (isNumericWord(word) ? NUMBER_KEY : word);
  const anyDigits = hasDigit(text) || oldWords.some((word) => hasDigit(word.word));
  if (oldWords.length <= 1 && !text.includes(' ') && !anyDigits) {
    return { segments: segmentText(text), splits: new Map() };
  }

  const newWords: string[] = [];
  const gaps: number[] = [];
  let gap = 0;
  for (const part of text.split(/( )/)) {
    if (part === ' ') {
      gap++;
    } else if (part.length > 0) {
      gaps.push(gap);
      newWords.push(part);
      gap = 0;
    }
  }
  const trailingGap = gap;
  const old = oldWords.map((word) => word.word);
  if (old.length * newWords.length > MAX_WORD_PAIRS) {
    return { segments: segmentText(text), splits: new Map() };
  }

  const [oldMatched, newMatched] = lcs(old.map(key), newWords.map(key));
  const exact = new Map<number, number>();
  newMatched.forEach((n, i) => exact.set(n, oldMatched[i]));
  let oldLeft = old.map((_, i) => i).filter((i) => !oldMatched.includes(i));
  let newLeft = newWords.map((_, i) => i).filter((i) => !newMatched.includes(i));
  const taken = new Set<number>();
  for (const n of newLeft) {
    const o = oldLeft.find((o) => !taken.has(o) && key(newWords[n]) === key(old[o]));
    if (o !== undefined) {
      exact.set(n, o);
      taken.add(o);
    }
  }
  oldLeft = oldLeft.filter((o) => !taken.has(o));
  newLeft = newLeft.filter((n) => !exact.has(n));

  const fuzzy = new Map<number, number>();
  const oldRank = rankBefore(old.length, new Set(oldMatched));
  const newRank = rankBefore(newWords.length, new Set(newMatched));
  if (oldLeft.length * newLeft.length <= MAX_FUZZY_PAIRS) {
    const used = new Set<number>();
    for (const n of newLeft) {
      let best = -1;
      let bestScore = MIN_SIMILARITY;
      for (const o of oldLeft) {
        if (used.has(o) || oldRank[o] !== newRank[n]) continue;
        const score = similarity(old[o], newWords[n]);
        if (score > bestScore) {
          bestScore = score;
          best = o;
        }
      }
      if (best >= 0) {
        fuzzy.set(n, best);
        used.add(best);
      }
    }
  }

  const plans = newWords.map((word, n): WordPlan => {
    const kept = exact.get(n);
    const from = kept ?? fuzzy.get(n);
    if (from === undefined) return { mode: 'fresh' };
    if (isNumericWord(word)) return { mode: 'number', from };
    return { mode: kept !== undefined ? 'reuse' : 'morph', from };
  });

  const ids = idAllocator();
  for (const plan of plans) {
    if (plan.mode === 'fresh') continue;
    const word = oldWords[plan.from];
    if (plan.mode !== 'reuse' && word.segments.length === 1) {
      for (let i = 0; i < Array.from(word.word).length; i++) ids.reserve(`${word.segments[0].id}:${i}`);
    } else {
      for (const segment of word.segments) ids.reserve(segment.id);
    }
  }

  const segments: Segment[] = [];
  const splits = new Map<string, Segment[]>();
  const decimal = decimalSeparator(locale);
  let offset = 0;
  const pushSpaces = (count: number) => {
    for (let i = 0; i < count; i++) {
      segments.push({ id: ids.take(`space-${offset}`), string: NBSP });
      offset++;
    }
  };
  newWords.forEach((word, n) => {
    pushSpaces(gaps[n]);
    const plan = plans[n];
    switch (plan.mode) {
      case 'reuse':
        segments.push(...oldWords[plan.from].segments);
        break;
      case 'number': {
        const pieces = splitWord(oldWords[plan.from], splits).map((segment) => ({
          ...segment,
          kind: segment.kind ?? kindOf(segment.string),
        }));
        segments.push(...segmentNumber(word, pieces, decimal));
        break;
      }
      case 'morph': {
        const from = oldWords[plan.from];
        const pieces = splitWord(from, splits);
        const chars = Array.from(word);
        const [a, b] = lcs(Array.from(from.word), chars);
        const kept = new Map<number, Segment>();
        b.forEach((to, i) => {
          if (pieces[a[i]]) kept.set(to, pieces[a[i]]);
        });
        chars.forEach((string, i) => {
          segments.push({ id: kept.get(i)?.id ?? ids.take(`${word}~${i}`), string });
        });
        break;
      }
      case 'fresh':
        if (isNumericWord(word)) segments.push(...segmentNumber(word));
        else segments.push({ id: ids.take(word), string: word });
        break;
    }
    offset += word.length;
  });
  pushSpaces(trailingGap);
  return { segments, splits };
}
