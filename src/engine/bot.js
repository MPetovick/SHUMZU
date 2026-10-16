// Heuristic bot. It only sees the public start-of-round board, never the
// opponent's planned moves, so it plays under the same rules as a human.

import { makeRng } from './rng.js';
import { BUILDINGS, MILITARY, ACTIONS_PER_ROUND, UNIT_KEYS, other } from './rules.js';
import {
  CAPITAL,
  cellsOf,
  orthogonal,
  reachable,
  buildable,
  attackPower,
  defensePower,
  validateActions,
  distance,
  cutValue,
} from './game.js';



const MIND_GAME_RATE = 0.15;

/**
 * Levels:
 *  - 'normal': varied play. Simulations showed a predictable "best move" bot loses to
 *    a varied one, because simultaneous orders punish predictability.
 *  - 'facil': every other round plays random legal moves.
 */
export function botActions(state, p, { level = 'normal' } = {}) {
  const rng = makeRng(state.seed, state.round, p, 'bot', level);
  if (level === 'facil' && rng() < 0.5) return randomActions(state, p, 'facil');
  const foe = other(p);
  const hand = { ...state.hands[p] };
  const foeHand = state.hands[foe];
  const foeCap = CAPITAL[foe];
  const candidates = [];
  const jitter = () => rng() * 6;

  const borderOf = (i) => orthogonal(i).some((n) => state.cells[n].owner === foe);
  const foeReach = Object.fromEntries(MILITARY.map((u) => [u, foeHand[u] > 0 ? reachable(state, foe, u) : new Set()]));

  /** Rival units that could take cell i if it were garrisoned by `garrison`. */
  const threats = (garrison, i) =>
    MILITARY.filter(
      (t) => foeReach[t].has(i) && attackPower(state, foe, t, garrison, i) > defensePower(state, garrison, t, i)
    );

  for (const unit of UNIT_KEYS) {
    if (hand[unit] <= 0) continue;
    for (const i of reachable(state, p, unit)) {
      const c = state.cells[i];
      if (c.owner === foe) {
        const pa = attackPower(state, p, unit, c.unit, i);
        const pd = defensePower(state, c.unit, unit, i);
        if (pa > pd) {
          let s = 12 + (pa - pd);
          if (c.capital) s += 60;
          if (c.building) s += 6;
          s += cutValue(state, p, i) * 3; // cutting supply lines is worth a lot
          candidates.push({ s: s + jitter(), a: { type: 'place', cell: i, unit } });
        }
      } else if (!c.owner) {
        // Expand: pawns for quiet ground, soldiers where the rival can contest it.
        const contested = borderOf(i) || orthogonal(i).some((n) => state.cells[n].owner === foe);
        let s = unit === 'peon' ? 6 : contested ? 5 : 1;
        if (contested && unit === 'peon') s -= 4;
        s += (14 - distance(i, foeCap)) * 0.25;
        candidates.push({ s: s + jitter(), a: { type: 'place', cell: i, unit } });
      } else if (c.owner === p && unit !== 'peon') {
        const threatsNow = threats(c.unit, i);
        if (!threatsNow.length) continue;
        // Defending only pays off for the capital or a key junction (simulated).
        const cut = cutValue(state, foe, i);
        if (!c.capital && cut < 3 && rng() > MIND_GAME_RATE) continue;
        const value = 9 + (c.capital ? 30 : 0) + (c.building ? 4 : 0) + cut * 3;
        const threatsAfter = threats(unit, i);
        if (threatsAfter.length === 0) {
          candidates.push({ s: value + jitter(), a: { type: 'place', cell: i, unit } });
        } else if (!c.capital && threatsNow.includes(unit)) {
          // Mind game: expect the rival to attack with `unit` and place the same one.
          // If the guess is right, the cell turns black and nobody gets it.
          candidates.push({ s: value - 2 + jitter(), a: { type: 'place', cell: i, unit } });
        }
      }
    }
  }

  // Buildings: farms inside, walls on the border, barracks where a soldier stands.
  for (const i of buildable(state, p)) {
    const c = state.cells[i];
    const border = borderOf(i);
    const nearCap = distance(i, CAPITAL[p]) <= 2;
    if (!border) candidates.push({ s: 4 + jitter(), a: { type: 'build', cell: i, building: 'granja' } });
    if (!border && c.unit !== 'peon') candidates.push({ s: 5 + jitter(), a: { type: 'build', cell: i, building: 'cuartel' } });
    if (border && nearCap) candidates.push({ s: 6 + jitter(), a: { type: 'build', cell: i, building: 'muralla' } });
  }

  candidates.sort((x, y) => y.s - x.s);

  const chosen = [];
  const usedCells = new Set();
  const pawnReserve = 0;

  for (const { a } of candidates) {
    if (chosen.length >= ACTIONS_PER_ROUND) break;
    if (usedCells.has(a.cell)) continue;
    if (a.type === 'place') {
      if (hand[a.unit] <= 0) continue;
      hand[a.unit] -= 1;
    } else {
      const cost = BUILDINGS[a.building].cost;
      if (hand.peon - cost < pawnReserve) continue;
      hand.peon -= cost;
    }
    usedCells.add(a.cell);
    chosen.push(a);
  }

  // Safety net: never hand the engine something it would reject.
  return validateActions(state, p, chosen).ok ? chosen : [];
}

/** Uniformly random legal moves, used only to check that strategy matters. */
export function randomActions(state, p, seedSalt = 'rand') {
  const rng = makeRng(state.seed, state.round, p, seedSalt);
  const hand = { ...state.hands[p] };
  const chosen = [];
  const used = new Set();
  for (let tries = 0; tries < 40 && chosen.length < ACTIONS_PER_ROUND; tries++) {
    const unit = UNIT_KEYS[Math.floor(rng() * UNIT_KEYS.length)];
    if (hand[unit] <= 0) continue;
    const opts = [...reachable(state, p, unit)].filter((i) => !used.has(i));
    if (!opts.length) continue;
    const cell = opts[Math.floor(rng() * opts.length)];
    hand[unit] -= 1;
    used.add(cell);
    chosen.push({ type: 'place', cell, unit });
  }
  return validateActions(state, p, chosen).ok ? chosen : [];
}

export { cellsOf };
