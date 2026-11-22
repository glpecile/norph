import type { Segment } from './diff';

export interface Box {
  x: number;
  width: number;
}

/**
 * How one segment moves. `x` is where it starts (enter) or ends (exit), in
 * the root's coordinates. `origin` is set for a group: the offset from the
 * segment's centre to the group's centre, which the scale pivots on.
 */
export type Move =
  | { type: 'stay' }
  | { type: 'enter'; x: number; origin?: number }
  | { type: 'exit'; x: number; origin?: number };

// torph scales a run of this many entering or exiting segments as one block.
const GROUP = 6;

/** Runs of at least `GROUP` consecutive ids that are in `members`. */
function groups(ids: string[], members: Set<string>) {
  const result: string[][] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= GROUP) result.push(run);
    run = [];
  };
  for (const id of ids) {
    if (members.has(id)) run.push(id);
    else flush();
  }
  flush();
  return result;
}

/** The nearest id in `alive` on the preferred side of `index`, else the other side. */
function anchor(index: number, ids: string[], alive: Set<string>, forwardFirst: boolean) {
  const back = () => ids.slice(0, index).findLast((id) => alive.has(id));
  const ahead = () => ids.slice(index + 1).find((id) => alive.has(id));
  return (forwardFirst ? (ahead() ?? back()) : (back() ?? ahead())) ?? null;
}

/** Each group member's offset from its own centre to the group's centre. */
function origins(run: string[], boxes: Map<string, Box>, into: Map<string, number>) {
  const left = Math.min(...run.map((id) => boxes.get(id)!.x));
  const right = Math.max(...run.map((id) => boxes.get(id)!.x + boxes.get(id)!.width));
  for (const id of run) {
    const box = boxes.get(id)!;
    into.set(id, (left + right) / 2 - (box.x + box.width / 2));
  }
}

/**
 * Plans a change from the `before` layout to the `after` one. A new segment
 * starts offset by how far its nearest surviving neighbour moved, so it rides
 * in with it, and a dropped one drifts with its neighbour as it fades.
 */
export function planMoves(
  before: string[],
  after: Segment[],
  previous: Map<string, Box>,
  next: Map<string, Box>,
) {
  const afterIds = after.map((segment) => segment.id);
  const kept = new Set(afterIds);
  const moves = new Map<string, Move>();

  const entering = new Set(afterIds.filter((id) => !previous.has(id)));
  const enterOrigins = new Map<string, number>();
  for (const run of groups(afterIds, entering)) origins(run, next, enterOrigins);
  const known = new Set(afterIds.filter((id) => previous.has(id)));
  afterIds.forEach((id, index) => {
    const box = next.get(id)!;
    if (!entering.has(id)) {
      moves.set(id, { type: 'stay' });
    } else if (enterOrigins.has(id)) {
      moves.set(id, { type: 'enter', x: box.x, origin: enterOrigins.get(id) });
    } else {
      const neighbour = anchor(index, afterIds, known, false);
      const shift = neighbour ? previous.get(neighbour)!.x - next.get(neighbour)!.x : 0;
      moves.set(id, { type: 'enter', x: box.x + shift });
    }
  });

  const exiting = new Set(before.filter((id) => !kept.has(id)));
  const exitOrigins = new Map<string, number>();
  for (const run of groups(before, exiting)) origins(run, previous, exitOrigins);
  const survivors = new Set(before.filter((id) => kept.has(id)));
  before.forEach((id, index) => {
    if (!exiting.has(id)) return;
    const box = previous.get(id)!;
    if (exitOrigins.has(id)) {
      moves.set(id, { type: 'exit', x: box.x, origin: exitOrigins.get(id) });
      return;
    }
    const neighbour = anchor(index, before, survivors, true);
    const shift = neighbour ? next.get(neighbour)!.x - previous.get(neighbour)!.x : 0;
    moves.set(id, { type: 'exit', x: box.x + shift });
  });
  return moves;
}
