import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256, canonical } from '../src/engine/sha256.js';
import {
  createGame,
  resolveRound,
  validateActions,
  reachable,
  stateHash,
  replay,
  idx,
  mirror,
  CAPITAL,
  cellsOf,
  attackPower,
  defensePower,
  suppliedFrom,
} from '../src/engine/game.js';
import { botActions, randomActions } from '../src/engine/bot.js';
import { BUILDINGS, START_HAND } from '../src/engine/rules.js';

/** Put the board into a known shape for a test. */
function setCell(s, i, props) {
  Object.assign(s.cells[i], { rock: false, blocked: false, owner: null, unit: null, building: null, capital: null }, props);
}

test('sha256 matches node:crypto, including padding edge cases', () => {
  for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'ñ ♞']) {
    assert.equal(sha256(s), createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('canonical JSON ignores key order', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }), canonical({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

test('the board is the same for the same seed and point-symmetric', () => {
  const a = createGame('s1');
  const b = createGame('s1');
  assert.equal(stateHash(a), stateHash(b));
  for (const c of a.cells) assert.equal(c.rock, a.cells[mirror(c.i)].rock);
  assert.equal(a.cells.filter((c) => c.rock).length, 6);
});

test('both capitals start with an infantry garrison and two pawns', () => {
  const s = createGame('s2');
  for (const p of ['A', 'B']) {
    assert.equal(s.cells[CAPITAL[p]].unit, 'inf');
    assert.equal(cellsOf(s, p).length, 3);
  }
  assert.deepEqual(s.hands.A, START_HAND);
});

test('only adjacent cells are reachable, cavalry reaches two', () => {
  const s = createGame('s3');
  const pawn = reachable(s, 'A', 'peon');
  const cav = reachable(s, 'A', 'cab');
  assert.ok(cav.size > pawn.size);
  assert.ok(!pawn.has(CAPITAL.B));
});

test('validation rejects too many actions, duplicates and missing units', () => {
  const s = createGame('s4');
  const [n1] = [...reachable(s, 'A', 'peon')];
  assert.equal(validateActions(s, 'A', [{ type: 'place', cell: n1, unit: 'peon' }, { type: 'place', cell: n1, unit: 'inf' }]).ok, false);
  const four = [...reachable(s, 'A', 'peon')].slice(0, 4).map((cell) => ({ type: 'place', cell, unit: 'peon' }));
  assert.equal(validateActions(s, 'A', four).ok, false);
  s.hands.A.cab = 0;
  assert.equal(validateActions(s, 'A', [{ type: 'place', cell: n1, unit: 'cab' }]).ok, false);
  assert.equal(validateActions(s, 'A', [{ type: 'place', cell: CAPITAL.B, unit: 'inf' }]).ok, false);
});

test('same unit on the same cell by both players turns it black', () => {
  const s = createGame('s5');
  const target = idx(3, 4);
  setCell(s, idx(2, 4), { owner: 'A', unit: 'peon' });
  setCell(s, idx(4, 4), { owner: 'B', unit: 'peon' });
  setCell(s, target, {});
  // Keep the helper cells connected to the capitals so supply lines don't drop them.
  for (let x = 0; x <= 2; x++) setCell(s, idx(x, 4), { owner: 'A', unit: 'peon' });
  for (let y = 5; y <= 7; y++) setCell(s, idx(0, y), { owner: 'A', unit: y === 7 ? 'inf' : 'peon', capital: y === 7 ? 'A' : null });
  for (let x = 4; x <= 7; x++) setCell(s, idx(x, 4), { owner: 'B', unit: 'peon' });
  for (let y = 0; y <= 3; y++) setCell(s, idx(7, y), { owner: 'B', unit: y === 0 ? 'inf' : 'peon', capital: y === 0 ? 'B' : null });

  const next = resolveRound(s, {
    A: [{ type: 'place', cell: target, unit: 'peon' }],
    B: [{ type: 'place', cell: target, unit: 'peon' }],
  });
  assert.equal(next.cells[target].blocked, true);
  assert.equal(next.cells[target].owner, null);
  assert.ok(next.lastEvents.some((e) => e.kind === 'black'));
  assert.equal(reachable(next, 'A', 'peon').has(target), false);
});

test('the triangle is a bonus: arqueros beat a lone infantry garrison', () => {
  const s = createGame('s6');
  const i = idx(3, 3);
  setCell(s, i, { owner: 'B', unit: 'inf' });
  // Attack power: 2 base + 2 advantage + 1 strike = 5. Defence: 2 + 1 hold = 3 (no friendly neighbours).
  assert.equal(attackPower(s, 'A', 'arq', 'inf', i), 5);
  assert.equal(defensePower(s, 'inf', 'arq', i), 3);
  assert.ok(defensePower(s, 'inf', 'cab', i) > attackPower(s, 'A', 'cab', 'inf', i));
});

test('a wall and friendly support raise defence', () => {
  const s = createGame('s7');
  const i = idx(3, 3);
  setCell(s, i, { owner: 'B', unit: 'cab' });
  const bare = defensePower(s, 'cab', 'inf', i);
  s.cells[i].building = 'muralla';
  setCell(s, idx(4, 3), { owner: 'B', unit: 'peon' });
  assert.equal(defensePower(s, 'cab', 'inf', i), bare + 2, 'one neighbour gives no support yet');
  setCell(s, idx(2, 3), { owner: 'B', unit: 'peon' });
  assert.equal(defensePower(s, 'cab', 'inf', i), bare + 2 + 1, 'two neighbours give +1');
});

test('defender wins ties (Risk)', () => {
  const s = createGame('s8');
  const i = CAPITAL.B;
  const next = resolveRound(s, { A: [], B: [] });
  assert.equal(next.cells[i].owner, 'B');
});

test('cells cut off from the capital turn neutral', () => {
  const s = createGame('s9');
  for (const c of s.cells) setCell(s, c.i, { rock: c.rock });
  setCell(s, CAPITAL.A, { owner: 'A', unit: 'inf', capital: 'A' });
  setCell(s, CAPITAL.B, { owner: 'B', unit: 'inf', capital: 'B' });
  // B owns a chain 7,0 -> 7,1 -> 7,2 -> 6,2. A captures 7,1, cutting 7,2 and 6,2.
  setCell(s, idx(7, 1), { owner: 'B', unit: 'peon' });
  setCell(s, idx(7, 2), { owner: 'B', unit: 'peon' });
  setCell(s, idx(6, 2), { owner: 'B', unit: 'peon' });
  setCell(s, idx(6, 1), { owner: 'A', unit: 'peon' });
  setCell(s, idx(6, 0), { owner: 'A', unit: 'peon' });
  // Give A a supply line to its capital via the top row and left column (owned, not rocks).
  for (let x = 0; x <= 5; x++) setCell(s, idx(x, 0), { owner: 'A', unit: 'peon' });
  for (let y = 0; y <= 6; y++) setCell(s, idx(0, y), { owner: 'A', unit: 'peon' });
  assert.equal(suppliedFrom(s, 'A').has(idx(6, 1)), true);

  // Archers 2 + 1 strike = 3 > corridor pawn 1 + support 1 = 2.
  const next = resolveRound(s, { A: [{ type: 'place', cell: idx(7, 1), unit: 'arq' }], B: [] });
  assert.equal(next.cells[idx(7, 1)].owner, 'A');
  assert.equal(next.cells[idx(7, 2)].owner, null);
  assert.equal(next.cells[idx(6, 2)].owner, null);
  assert.ok(next.lastEvents.filter((e) => e.kind === 'cutoff').length === 2);
});

test('buildings cost pawns and produce income', () => {
  const s = createGame('s10');
  const [cell] = cellsOf(s, 'A').filter((c) => !c.capital).map((c) => c.i);
  const pawns = s.hands.A.peon;
  const next = resolveRound(s, { A: [{ type: 'build', cell, building: 'granja' }], B: [] });
  assert.equal(next.cells[cell].building, 'granja');
  // Paid 2, then income: max(3, 3 cells / 3) = 3, +1 from the farm.
  assert.equal(next.hands.A.peon, pawns - BUILDINGS.granja.cost + 3 + 1);
});

test('capturing the rival capital wins the game', () => {
  const s = createGame('s11');
  setCell(s, CAPITAL.B, { owner: 'B', unit: 'peon', capital: 'B' });
  setCell(s, idx(6, 0), { owner: 'A', unit: 'peon' });
  setCell(s, idx(7, 1), { owner: 'A', unit: 'peon' });
  // A needs supply: connect 6,0 to the A capital along the top row and left column.
  for (let x = 0; x <= 5; x++) setCell(s, idx(x, 0), { owner: 'A', unit: 'peon' });
  for (let y = 0; y <= 6; y++) setCell(s, idx(0, y), { owner: 'A', unit: 'peon' });
  // Archers: 2 + 1 strike + 1 flank (two A neighbours) = 4 > pawn 1 + capital 2 = 3.
  const next = resolveRound(s, { A: [{ type: 'place', cell: CAPITAL.B, unit: 'arq' }], B: [] });
  assert.equal(next.status, 'over');
  assert.equal(next.winner, 'A');
  assert.equal(next.reason, 'capital');
});

test('resolution is pure and replayable from the history', () => {
  let s = createGame('s12');
  const s0 = stateHash(s);
  for (let r = 0; r < 8 && s.status === 'playing'; r++) {
    const before = stateHash(s);
    const next = resolveRound(s, { A: botActions(s, 'A'), B: randomActions(s, 'B') });
    assert.equal(stateHash(s), before, 'input state must not change');
    s = next;
  }
  assert.notEqual(stateHash(s), s0);
  assert.equal(stateHash(replay('s12', s.history)), stateHash(s));
});

test('invalid moves are rejected by the engine', () => {
  const s = createGame('s13');
  assert.throws(() => resolveRound(s, { A: [{ type: 'place', cell: CAPITAL.B, unit: 'inf' }], B: [] }));
});

test('bot moves are always legal', () => {
  for (const seed of ['b1', 'b2', 'b3']) {
    let s = createGame(seed);
    while (s.status === 'playing') {
      for (const p of ['A', 'B']) assert.equal(validateActions(s, p, botActions(s, p)).ok, true);
      s = resolveRound(s, { A: botActions(s, 'A'), B: botActions(s, 'B', { level: 'facil' }) });
    }
    assert.ok(['capital', 'domination', 'rounds', 'capitals'].includes(s.reason));
  }
});
