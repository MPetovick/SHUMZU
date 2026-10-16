import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, newRoomCode, normalizeRoomCode } from '../src/net/session.js';
import { loopbackPair } from '../src/net/transports.js';
import { stateHash } from '../src/engine/game.js';
import { botActions } from '../src/engine/bot.js';

const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const once = (s, ev) => new Promise((r) => s.on(ev, r));

async function pair() {
  const [ta, tb] = loopbackPair();
  const a = new Session({ role: 'A', transport: ta });
  const b = new Session({ role: 'B', transport: tb });
  await Promise.all([once(a, 'start'), once(b, 'start')]);
  return { a, b, ta, tb };
}

test('both peers agree on the same seed and board', async () => {
  const { a, b } = await pair();
  assert.equal(a.state.seed, b.state.seed);
  assert.equal(stateHash(a.state), stateHash(b.state));
});

test('a full game stays in sync round after round', async () => {
  const { a, b } = await pair();
  const errors = [];
  a.on('error', (e) => errors.push(e));
  b.on('error', (e) => errors.push(e));
  let verified = 0;
  a.on('verified', () => verified++);

  while (!a.over && !b.over) {
    const ra = once(a, 'round');
    const rb = once(b, 'round');
    a.submit(botActions(a.state, 'A'));
    await wait(1);
    b.submit(botActions(b.state, 'B', { level: 'facil' }));
    await Promise.all([ra, rb]);
    await wait(1);
    assert.equal(stateHash(a.state), stateHash(b.state));
  }
  assert.deepEqual(errors, []);
  assert.equal(a.state.status, 'over');
  assert.ok(verified >= a.state.history.length - 1);
});

test('moves stay hidden until both have committed', async () => {
  const { a, b, tb } = await pair();
  const seen = [];
  tb.onMessage((m) => seen.push(m.t));
  a.submit([]);
  await wait(10);
  assert.ok(seen.includes('commit'));
  assert.ok(!seen.includes('reveal'), 'A must not reveal before B commits');
  b.submit([]);
  await wait(10);
  assert.ok(seen.includes('reveal'));
});

test('a peer that changes its moves after committing is caught', async () => {
  const { a, b, ta } = await pair();
  const errors = [];
  b.on('error', (e) => errors.push(e.code));
  // Tamper: A commits one thing and reveals another.
  const realSend = ta.send;
  ta.send = (m) => realSend(m.t === 'reveal' ? { ...m, actions: [{ type: 'place', cell: 0, unit: 'peon' }] } : m);
  a.submit([]);
  b.submit([]);
  await wait(20);
  assert.deepEqual(errors, ['cheat']);
});

test('an illegal revealed move is caught even with a valid commit', async () => {
  const { a, b, ta } = await pair();
  const errors = [];
  b.on('error', (e) => errors.push(e.code));
  // Bypass local validation by sending a hand-made commit and reveal.
  const { hashOf } = await import('../src/engine/sha256.js');
  const bad = [{ type: 'place', cell: 7, unit: 'inf' }]; // B's capital, out of reach
  const salt = 'x';
  ta.send({ t: 'commit', round: 1, hash: hashOf({ round: 1, actions: bad, salt }) });
  b.submit([]);
  await wait(10);
  ta.send({ t: 'reveal', round: 1, actions: bad, salt });
  await wait(10);
  assert.deepEqual(errors, ['cheat']);
});

test('local validation refuses illegal moves', async () => {
  const { a } = await pair();
  assert.throws(() => a.submit([{ type: 'place', cell: 7, unit: 'inf' }]));
});

test('resigning ends the game for both', async () => {
  const { a, b } = await pair();
  const ended = once(b, 'ended');
  a.resign();
  const e = await ended;
  assert.equal(e.winner, 'B');
});

test('a reconnecting guest rebuilds the game from the host history', async () => {
  const { a, b } = await pair();
  for (let r = 0; r < 3; r++) {
    const done = Promise.all([once(a, 'round'), once(b, 'round')]);
    a.submit(botActions(a.state, 'A'));
    b.submit(botActions(b.state, 'B'));
    await done;
  }
  // Simulate the guest losing its state and reconnecting on a fresh link.
  b.state = null;
  const [ta2, tb2] = loopbackPair();
  const resynced = once(b, 'resync');
  a.attach(ta2);
  b.attach(tb2);
  await resynced;
  await wait(5);
  assert.equal(stateHash(a.state), stateHash(b.state));
  assert.equal(b.state.round, 4);
});

test('room codes avoid ambiguous characters', () => {
  for (let i = 0; i < 50; i++) assert.match(newRoomCode(), /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(normalizeRoomCode(' ab-c d9x '), 'ABCD9');
});
