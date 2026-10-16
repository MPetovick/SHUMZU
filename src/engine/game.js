// Pure, deterministic game engine. No DOM, no network, no Math.random.
// Both peers run resolveRound() on the same inputs and must reach the same state.

import { makeRng } from './rng.js';
import { hashOf } from './sha256.js';
import {
  VERSION,
  BOARD_SIZE,
  MAX_ROUNDS,
  ACTIONS_PER_ROUND,
  ROCKS,
  PLAYERS,
  other,
  UNITS,
  MILITARY,
  ADVANTAGE,
  INF_HOLD,
  ARQ_STRIKE,
  CAPITAL_DEFENSE,
  FLANK_PER_CELL,
  FLANK_MAX,
  SUPPORT_PER_CELL,
  SUPPORT_MAX,
  BUILDINGS,
  WALL_DEFENSE,
  START_HAND,
  BASE_INCOME_MIN,
  CELLS_PER_PAWN,
  CELLS_PER_SOLDIER,
  beats,
} from './rules.js';

export const DOMINATION_SHARE = 0.65;

const N = BOARD_SIZE;
export const idx = (x, y) => y * N + x;
export const xy = (i) => [i % N, Math.floor(i / N)];
export const mirror = (i) => N * N - 1 - i; // point symmetry through the centre

// Player A starts bottom-left, B top-right. Each player's UI shows its own capital at the bottom.
export const CAPITAL = { A: idx(0, N - 1), B: idx(N - 1, 0) };

export function orthogonal(i) {
  const [x, y] = xy(i);
  const out = [];
  if (x > 0) out.push(idx(x - 1, y));
  if (x < N - 1) out.push(idx(x + 1, y));
  if (y > 0) out.push(idx(x, y - 1));
  if (y < N - 1) out.push(idx(x, y + 1));
  return out;
}

export function distance(a, b) {
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

const playable = (c) => !c.rock && !c.blocked;

// ---------------------------------------------------------------- setup

function connected(cells, from, to) {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const i = queue.shift();
    if (i === to) return true;
    for (const n of orthogonal(i)) {
      if (!seen.has(n) && !cells[n].rock) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}

export function createGame(seed) {
  const cells = Array.from({ length: N * N }, (_, i) => ({
    i,
    rock: false,
    blocked: false,
    owner: null,
    unit: null,
    building: null,
    capital: null,
  }));

  // Rocks in mirrored pairs, away from both capitals, never cutting the board in two.
  const rng = makeRng(seed, 'board');
  let pairs = 0;
  let guard = 0;
  while (pairs < ROCKS / 2 && guard++ < 500) {
    const i = Math.floor(rng() * N * N);
    const j = mirror(i);
    if (i === j || cells[i].rock) continue;
    if (distance(i, CAPITAL.A) < 4 || distance(i, CAPITAL.B) < 4) continue;
    cells[i].rock = cells[j].rock = true;
    if (!connected(cells, CAPITAL.A, CAPITAL.B)) {
      cells[i].rock = cells[j].rock = false;
      continue;
    }
    pairs++;
  }

  for (const p of PLAYERS) {
    const cap = cells[CAPITAL[p]];
    Object.assign(cap, { owner: p, unit: 'inf', capital: p });
    for (const n of orthogonal(CAPITAL[p])) Object.assign(cells[n], { owner: p, unit: 'peon' });
  }

  return {
    version: VERSION,
    seed: String(seed),
    round: 1,
    cells,
    hands: { A: { ...START_HAND }, B: { ...START_HAND } },
    status: 'playing', // 'playing' | 'over'
    winner: null, // 'A' | 'B' | null (draw)
    reason: null,
    history: [], // [{ round, actions: { A, B } }] — enough to replay the whole game
    lastEvents: [],
  };
}

// ---------------------------------------------------------------- queries

export const cellsOf = (state, p) => state.cells.filter((c) => c.owner === p);
export const playableCount = (state) => state.cells.filter(playable).length;

export function score(state, p) {
  const mine = cellsOf(state, p);
  return mine.length + 2 * mine.filter((c) => c.building).length;
}

export function soldiers(state, p) {
  const inHand = MILITARY.reduce((n, u) => n + state.hands[p][u], 0);
  return inHand + cellsOf(state, p).filter((c) => c.unit && c.unit !== 'peon').length;
}

/** Cells of player p connected to its capital through its own cells (supply lines). */
export function suppliedFrom(state, p) {
  const start = CAPITAL[p];
  const linked = new Set();
  if (state.cells[start].owner !== p) return linked;
  const queue = [start];
  linked.add(start);
  while (queue.length) {
    const i = queue.shift();
    for (const n of orthogonal(i)) {
      if (!linked.has(n) && state.cells[n].owner === p) {
        linked.add(n);
        queue.push(n);
      }
    }
  }
  return linked;
}

/** Cells of the rival that would be cut off if p took cell i. */
export function cutValue(state, p, i) {
  const foe = other(p);
  if (state.cells[i].owner !== foe || state.cells[i].capital) return 0;
  const before = state.cells[i].owner;
  state.cells[i].owner = p;
  const linked = suppliedFrom(state, foe);
  state.cells[i].owner = before;
  return cellsOf(state, foe).length - 1 - linked.size;
}

/** Cells where player p may place unit u this round. */
export function reachable(state, p, unit) {
  const own = cellsOf(state, p).map((c) => c.i);
  const ownSet = new Set(own);
  const range = unit === 'cab' ? 2 : 1;
  const out = new Set();

  for (const c of state.cells) {
    if (!playable(c)) continue;
    if (ownSet.has(c.i)) {
      if (c.unit !== unit) out.add(c.i); // repaint your own cell with another unit
      continue;
    }
    if (own.some((o) => distance(o, c.i) <= range)) out.add(c.i);
  }
  return out;
}

export function buildable(state, p) {
  return new Set(
    cellsOf(state, p)
      .filter((c) => !c.capital && !c.building && playable(c))
      .map((c) => c.i)
  );
}

/** Pawns per round: one per three cells, minimum three (Risk). Plus buildings and capital. */
export function income(state, p) {
  const mine = cellsOf(state, p);
  const gain = { peon: Math.max(BASE_INCOME_MIN, Math.floor(mine.length / CELLS_PER_PAWN)), inf: 0, cab: 0, arq: 0 };
  for (const c of mine) {
    if (c.building === 'granja') gain.peon += 1;
    if (c.building === 'cuartel' && c.unit) gain[c.unit] += 1;
  }
  if (mine.some((c) => c.capital === p)) gain[capitalUnit(state.round)] += 1;
  // Territory soldiers rotate through the triangle so nobody gets only one type.
  const soldiers = Math.floor(mine.length / CELLS_PER_SOLDIER);
  for (let k = 0; k < soldiers; k++) gain[capitalUnit(state.round + 1 + k)] += 1;
  return gain;
}

/** The capital trains a different military unit each round: inf, cab, arq, inf... */
export const capitalUnit = (round) => MILITARY[(round - 1) % MILITARY.length];

// ---------------------------------------------------------------- validation

/**
 * actions: [{ type: 'place', cell, unit } | { type: 'build', cell, building }]
 * Checked against the state at the start of the round, for local and remote moves alike.
 */
export function validateActions(state, p, actions) {
  if (!Array.isArray(actions)) return { ok: false, error: 'Jugada mal formada' };
  if (actions.length > ACTIONS_PER_ROUND) return { ok: false, error: `Máximo ${ACTIONS_PER_ROUND} acciones por ronda` };

  const used = { peon: 0, inf: 0, cab: 0, arq: 0 };
  const touched = new Set();

  for (const a of actions) {
    if (!a || !Number.isInteger(a.cell) || a.cell < 0 || a.cell >= N * N) return { ok: false, error: 'Casilla no válida' };
    if (touched.has(a.cell)) return { ok: false, error: 'Solo una acción por casilla' };
    touched.add(a.cell);

    if (a.type === 'place') {
      if (!UNITS[a.unit]) return { ok: false, error: 'Unidad desconocida' };
      if (!reachable(state, p, a.unit).has(a.cell)) return { ok: false, error: 'Esa unidad no llega a esa casilla' };
      used[a.unit] += 1;
    } else if (a.type === 'build') {
      if (!BUILDINGS[a.building]) return { ok: false, error: 'Edificio desconocido' };
      if (!buildable(state, p).has(a.cell)) return { ok: false, error: 'Solo puedes construir en casillas tuyas libres' };
      used.peon += BUILDINGS[a.building].cost;
    } else {
      return { ok: false, error: 'Acción desconocida' };
    }
  }

  for (const [u, n] of Object.entries(used)) {
    if (n > state.hands[p][u]) return { ok: false, error: `No tienes suficientes ${UNITS[u].name.toLowerCase()}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- combat

function flank(start, attacker, cell) {
  const own = orthogonal(cell).filter((n) => start.cells[n].owner === attacker).length;
  return Math.min(FLANK_MAX, Math.max(0, own - 1)) * FLANK_PER_CELL;
}

export function attackPower(start, attacker, unit, vsUnit, cell) {
  return (
    UNITS[unit].power +
    (beats(unit, vsUnit) ? ADVANTAGE : 0) +
    (unit === 'arq' ? ARQ_STRIKE : 0) +
    flank(start, attacker, cell)
  );
}

function support(start, cell) {
  const owner = start.cells[cell].owner;
  if (!owner) return 0;
  // Same shape as flanking: neighbours beyond the first count. A one-cell-wide corridor
  // gets +1, solid ground gets +2, so thin supply lines can be cut.
  const own = orthogonal(cell).filter((n) => start.cells[n].owner === owner).length;
  return Math.min(SUPPORT_MAX, Math.max(0, own - 1)) * SUPPORT_PER_CELL;
}

export function defensePower(start, unit, vsUnit, cell) {
  const c = start.cells[cell];
  return (
    UNITS[unit].power +
    (beats(unit, vsUnit) ? ADVANTAGE : 0) +
    (unit === 'inf' ? INF_HOLD : 0) +
    (c.building === 'muralla' ? WALL_DEFENSE : 0) +
    (c.capital ? CAPITAL_DEFENSE : 0) +
    support(start, cell)
  );
}

/** Breakdown shown in the UI so every result can be checked by hand. */
export function explainDefense(start, unit, vsUnit, cell) {
  const c = start.cells[cell];
  return {
    base: UNITS[unit].power,
    advantage: beats(unit, vsUnit) ? ADVANTAGE : 0,
    hold: unit === 'inf' ? INF_HOLD : 0,
    wall: c.building === 'muralla' ? WALL_DEFENSE : 0,
    capital: c.capital ? CAPITAL_DEFENSE : 0,
    support: support(start, cell),
  };
}

export function explainAttack(start, attacker, unit, vsUnit, cell) {
  return {
    base: UNITS[unit].power,
    advantage: beats(unit, vsUnit) ? ADVANTAGE : 0,
    strike: unit === 'arq' ? ARQ_STRIKE : 0,
    flank: flank(start, attacker, cell),
  };
}

function take(cell, p, unit) {
  Object.assign(cell, { owner: p, unit, building: null });
}

/**
 * Resolve one round. All moves happen at once, against the start-of-round board
 * (orders are simultaneous, as in Diplomacy). Returns a new state; input is untouched.
 */
export function resolveRound(state, actionsByPlayer) {
  if (state.status !== 'playing') throw new Error('La partida ha terminado');
  for (const p of PLAYERS) {
    const v = validateActions(state, p, actionsByPlayer[p]);
    if (!v.ok) throw new Error(`Jugada inválida de ${p}: ${v.error}`);
  }

  const start = state;
  const next = structuredClone(state);
  const events = [];

  // Pay for everything up front.
  const placements = new Map(); // cell -> { A?: unit, B?: unit }
  const builds = [];
  for (const p of PLAYERS) {
    for (const a of actionsByPlayer[p]) {
      if (a.type === 'place') {
        next.hands[p][a.unit] -= 1;
        if (!placements.has(a.cell)) placements.set(a.cell, {});
        placements.get(a.cell)[p] = a.unit;
      } else {
        next.hands[p].peon -= BUILDINGS[a.building].cost;
        builds.push({ p, ...a });
      }
    }
  }

  const captured = { A: 0, B: 0 };

  for (const [i, by] of [...placements.entries()].sort((a, b) => a[0] - b[0])) {
    const before = start.cells[i];
    const cell = next.cells[i];
    const owner = before.owner;

    // An owner who places on its own cell swaps the garrison; the old unit goes back to hand.
    for (const p of PLAYERS) {
      if (by[p] && owner === p && before.unit) next.hands[p][before.unit] += 1;
    }

    if (by.A && by.B) {
      // Both players chose the same cell this round.
      if (by.A === by.B) {
        if (before.capital) {
          const holder = before.capital;
          take(cell, holder, by[holder]);
          cell.capital = holder;
          events.push({ cell: i, kind: 'hold', by: holder, unit: by[holder], vs: by[other(holder)], note: 'capital' });
        } else {
          Object.assign(cell, { owner: null, unit: null, building: null, blocked: true });
          events.push({ cell: i, kind: 'black', unit: by.A });
        }
        continue;
      }

      if (owner) {
        const def = owner;
        const att = other(owner);
        const pa = attackPower(start, att, by[att], by[def], i);
        const pd = defensePower(start, by[def], by[att], i);
        if (pa > pd) {
          take(cell, att, by[att]);
          captured[att] += 1;
          events.push({ cell: i, kind: 'capture', by: att, unit: by[att], vs: by[def], power: [pa, pd] });
        } else {
          cell.unit = by[def];
          events.push({ cell: i, kind: 'hold', by: def, unit: by[def], vs: by[att], power: [pa, pd] });
        }
      } else {
        const pA = attackPower(start, 'A', by.A, by.B, i);
        const pB = attackPower(start, 'B', by.B, by.A, i);
        if (pA === pB) {
          events.push({ cell: i, kind: 'bounce', units: { A: by.A, B: by.B }, power: [pA, pB] });
        } else {
          const w = pA > pB ? 'A' : 'B';
          take(cell, w, by[w]);
          events.push({ cell: i, kind: 'conquer', by: w, unit: by[w], vs: by[other(w)], power: w === 'A' ? [pA, pB] : [pB, pA] });
        }
      }
      continue;
    }

    const p = by.A ? 'A' : 'B';
    const unit = by[p];
    if (owner === p) {
      cell.unit = unit;
      events.push({ cell: i, kind: 'repaint', by: p, unit });
    } else if (!owner) {
      take(cell, p, unit);
      events.push({ cell: i, kind: 'conquer', by: p, unit });
    } else {
      const pa = attackPower(start, p, unit, before.unit, i);
      const pd = defensePower(start, before.unit, unit, i);
      if (pa > pd) {
        take(cell, p, unit);
        captured[p] += 1;
        events.push({ cell: i, kind: 'capture', by: p, unit, vs: before.unit, power: [pa, pd] });
      } else {
        events.push({ cell: i, kind: 'repel', by: p, unit, vs: before.unit, defender: owner, power: [pa, pd] });
      }
    }
  }

  for (const b of builds) {
    const cell = next.cells[b.cell];
    if (cell.owner === b.p && !cell.building && !cell.blocked) {
      cell.building = b.building;
      events.push({ cell: b.cell, kind: 'build', by: b.p, building: b.building });
    } else {
      events.push({ cell: b.cell, kind: 'build-lost', by: b.p, building: b.building });
    }
  }

  // Loot: capturing enemy ground earns one extra military unit (Risk cards, simplified).
  for (const p of PLAYERS) {
    if (captured[p] > 0) {
      const rng = makeRng(state.seed, state.round, p, 'loot');
      const u = MILITARY[Math.floor(rng() * MILITARY.length)];
      next.hands[p][u] += 1;
      events.push({ kind: 'loot', by: p, unit: u });
    }
  }

  // Supply lines: cells cut off from their capital are abandoned and turn neutral.
  for (const p of PLAYERS) {
    if (next.cells[CAPITAL[p]].owner !== p) continue; // the game ends below anyway
    const linked = suppliedFrom(next, p);
    for (const c of next.cells) {
      if (c.owner === p && !linked.has(c.i)) {
        events.push({ cell: c.i, kind: 'cutoff', by: p, unit: c.unit, building: c.building });
        Object.assign(c, { owner: null, unit: null, building: null });
      }
    }
  }

  next.history.push({ round: state.round, actions: structuredClone(actionsByPlayer) });
  decideOutcome(next, events);

  if (next.status === 'playing') {
    for (const p of PLAYERS) {
      const gain = income(next, p);
      for (const [u, n] of Object.entries(gain)) next.hands[p][u] += n;
      events.push({ kind: 'income', by: p, gain });
    }
    next.round += 1;
  }

  next.lastEvents = events;
  return next;
}

function decideOutcome(next, events) {
  const lostCapital = PLAYERS.filter((p) => next.cells[CAPITAL[p]].owner !== p);
  const total = playableCount(next);

  const end = (winner, reason) => {
    next.status = 'over';
    next.winner = winner;
    next.reason = reason;
    events.push({ kind: 'end', winner, reason });
  };

  // Points, then cells, then soldiers (in hand and on the board). Only then a draw.
  const byPoints = (reason) => {
    const keys = (p) => [score(next, p), cellsOf(next, p).length, soldiers(next, p)];
    const a = keys('A');
    const b = keys('B');
    for (let k = 0; k < a.length; k++) {
      if (a[k] !== b[k]) return end(a[k] > b[k] ? 'A' : 'B', reason);
    }
    end(null, reason);
  };

  if (lostCapital.length === 2) return byPoints('capitals');
  if (lostCapital.length === 1) return end(other(lostCapital[0]), 'capital');
  for (const p of PLAYERS) {
    if (cellsOf(next, p).length >= Math.ceil(total * DOMINATION_SHARE)) return end(p, 'domination');
  }
  if (next.round >= MAX_ROUNDS) return byPoints('rounds');
}

/** Hash of everything that matters. Peers compare it after each round. */
export function stateHash(state) {
  return hashOf({
    v: state.version,
    seed: state.seed,
    round: state.round,
    cells: state.cells.map((c) => [c.owner, c.unit, c.building, c.blocked ? 1 : 0, c.rock ? 1 : 0, c.capital]),
    hands: state.hands,
    status: state.status,
    winner: state.winner,
  });
}

/** Rebuild a game from its seed and the list of rounds. Used for reconnection and audits. */
export function replay(seed, history) {
  let s = createGame(seed);
  for (const h of history) s = resolveRound(s, h.actions);
  return s;
}
