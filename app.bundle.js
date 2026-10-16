(() => {
  // src/engine/rules.js
  var VERSION = "0.0.1";
  var BOARD_SIZE = 8;
  var MAX_ROUNDS = 20;
  var ACTIONS_PER_ROUND = 3;
  var ROCKS = 6;
  var PLAYERS = ["A", "B"];
  var other = (p) => p === "A" ? "B" : "A";
  var UNITS = {
    peon: { name: "Pe\xF3n", short: "Pe\xF3n", glyph: "\u265F", power: 1, beats: null, note: "Barato. Expande y paga edificios." },
    inf: { name: "Infanter\xEDa", short: "Infant.", glyph: "\u265C", power: 2, beats: "cab", note: "+1 al defender una casilla." },
    cab: { name: "Caballer\xEDa", short: "Caball.", glyph: "\u265E", power: 2, beats: "arq", note: "Llega a dos casillas de distancia." },
    arq: { name: "Arqueros", short: "Arquer.", glyph: "\u265D", power: 2, beats: "inf", note: "+1 al atacar." }
  };
  var UNIT_KEYS = Object.keys(UNITS);
  var MILITARY = ["inf", "cab", "arq"];
  var ADVANTAGE = 2;
  var INF_HOLD = 1;
  var ARQ_STRIKE = 1;
  var CAPITAL_DEFENSE = 2;
  var FLANK_PER_CELL = 1;
  var FLANK_MAX = 2;
  var SUPPORT_PER_CELL = 1;
  var SUPPORT_MAX = 2;
  var BUILDINGS = {
    granja: { name: "Granja", glyph: "\u274B", cost: 2, note: "+1 pe\xF3n cada ronda." },
    cuartel: { name: "Cuartel", glyph: "\u2691", cost: 3, note: "+1 unidad del tipo que guarnece la casilla cada ronda." },
    muralla: { name: "Muralla", glyph: "\u25A6", cost: 3, note: "+2 a la defensa de la casilla." }
  };
  var BUILDING_KEYS = Object.keys(BUILDINGS);
  var WALL_DEFENSE = 2;
  var START_HAND = { peon: 4, inf: 2, cab: 2, arq: 2 };
  var BASE_INCOME_MIN = 3;
  var CELLS_PER_PAWN = 3;
  var CELLS_PER_SOLDIER = 5;
  function beats(a, b) {
    return Boolean(a && b && UNITS[a].beats === b);
  }

  // src/engine/rng.js
  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeRng(...parts) {
    return mulberry32(hashString(parts.join("|")));
  }
  function randomHex(bytes = 16) {
    const arr = new Uint8Array(bytes);
    globalThis.crypto.getRandomValues(arr);
    return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // src/engine/sha256.js
  var K = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var rotr = (x, n) => x >>> n | x << 32 - n;
  function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const bitLen = bytes.length * 8;
    const padded = new Uint8Array(bytes.length + 9 + 63 >> 6 << 6);
    padded.set(bytes);
    padded[bytes.length] = 128;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 4, bitLen >>> 0);
    view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
    const H = new Uint32Array([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    const W = new Uint32Array(64);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ W[i - 15] >>> 3;
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ W[i - 2] >>> 10;
        W[i] = W[i - 16] + s0 + W[i - 7] + s1 >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = e & f ^ ~e & g;
        const t1 = h + S1 + ch + K[i] + W[i] >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = a & b ^ a & c ^ b & c;
        const t2 = S0 + maj >>> 0;
        h = g;
        g = f;
        f = e;
        e = d + t1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = t1 + t2 >>> 0;
      }
      H[0] = H[0] + a >>> 0;
      H[1] = H[1] + b >>> 0;
      H[2] = H[2] + c >>> 0;
      H[3] = H[3] + d >>> 0;
      H[4] = H[4] + e >>> 0;
      H[5] = H[5] + f >>> 0;
      H[6] = H[6] + g >>> 0;
      H[7] = H[7] + h >>> 0;
    }
    return [...H].map((x) => x.toString(16).padStart(8, "0")).join("");
  }
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  var hashOf = (value) => sha256(canonical(value));

  // src/engine/game.js
  var DOMINATION_SHARE = 0.65;
  var N = BOARD_SIZE;
  var idx = (x, y) => y * N + x;
  var xy = (i) => [i % N, Math.floor(i / N)];
  var mirror = (i) => N * N - 1 - i;
  var CAPITAL = { A: idx(0, N - 1), B: idx(N - 1, 0) };
  function orthogonal(i) {
    const [x, y] = xy(i);
    const out = [];
    if (x > 0) out.push(idx(x - 1, y));
    if (x < N - 1) out.push(idx(x + 1, y));
    if (y > 0) out.push(idx(x, y - 1));
    if (y < N - 1) out.push(idx(x, y + 1));
    return out;
  }
  function distance(a, b) {
    const [ax, ay] = xy(a);
    const [bx, by] = xy(b);
    return Math.abs(ax - bx) + Math.abs(ay - by);
  }
  var playable = (c) => !c.rock && !c.blocked;
  function connected(cells, from, to) {
    const seen = /* @__PURE__ */ new Set([from]);
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
  function createGame(seed) {
    const cells = Array.from({ length: N * N }, (_, i) => ({
      i,
      rock: false,
      blocked: false,
      owner: null,
      unit: null,
      building: null,
      capital: null
    }));
    const rng = makeRng(seed, "board");
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
      Object.assign(cap, { owner: p, unit: "inf", capital: p });
      for (const n of orthogonal(CAPITAL[p])) Object.assign(cells[n], { owner: p, unit: "peon" });
    }
    return {
      version: VERSION,
      seed: String(seed),
      round: 1,
      cells,
      hands: { A: { ...START_HAND }, B: { ...START_HAND } },
      status: "playing",
      // 'playing' | 'over'
      winner: null,
      // 'A' | 'B' | null (draw)
      reason: null,
      history: [],
      // [{ round, actions: { A, B } }] — enough to replay the whole game
      lastEvents: []
    };
  }
  var cellsOf = (state, p) => state.cells.filter((c) => c.owner === p);
  var playableCount = (state) => state.cells.filter(playable).length;
  function score(state, p) {
    const mine = cellsOf(state, p);
    return mine.length + 2 * mine.filter((c) => c.building).length;
  }
  function soldiers(state, p) {
    const inHand = MILITARY.reduce((n, u) => n + state.hands[p][u], 0);
    return inHand + cellsOf(state, p).filter((c) => c.unit && c.unit !== "peon").length;
  }
  function suppliedFrom(state, p) {
    const start = CAPITAL[p];
    const linked = /* @__PURE__ */ new Set();
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
  function cutValue(state, p, i) {
    const foe = other(p);
    if (state.cells[i].owner !== foe || state.cells[i].capital) return 0;
    const before = state.cells[i].owner;
    state.cells[i].owner = p;
    const linked = suppliedFrom(state, foe);
    state.cells[i].owner = before;
    return cellsOf(state, foe).length - 1 - linked.size;
  }
  function reachable(state, p, unit) {
    const own = cellsOf(state, p).map((c) => c.i);
    const ownSet = new Set(own);
    const range = unit === "cab" ? 2 : 1;
    const out = /* @__PURE__ */ new Set();
    for (const c of state.cells) {
      if (!playable(c)) continue;
      if (ownSet.has(c.i)) {
        if (c.unit !== unit) out.add(c.i);
        continue;
      }
      if (own.some((o) => distance(o, c.i) <= range)) out.add(c.i);
    }
    return out;
  }
  function buildable(state, p) {
    return new Set(
      cellsOf(state, p).filter((c) => !c.capital && !c.building && playable(c)).map((c) => c.i)
    );
  }
  function income(state, p) {
    const mine = cellsOf(state, p);
    const gain = { peon: Math.max(BASE_INCOME_MIN, Math.floor(mine.length / CELLS_PER_PAWN)), inf: 0, cab: 0, arq: 0 };
    for (const c of mine) {
      if (c.building === "granja") gain.peon += 1;
      if (c.building === "cuartel" && c.unit) gain[c.unit] += 1;
    }
    if (mine.some((c) => c.capital === p)) gain[capitalUnit(state.round)] += 1;
    const soldiers2 = Math.floor(mine.length / CELLS_PER_SOLDIER);
    for (let k = 0; k < soldiers2; k++) gain[capitalUnit(state.round + 1 + k)] += 1;
    return gain;
  }
  var capitalUnit = (round) => MILITARY[(round - 1) % MILITARY.length];
  function validateActions(state, p, actions) {
    if (!Array.isArray(actions)) return { ok: false, error: "Jugada mal formada" };
    if (actions.length > ACTIONS_PER_ROUND) return { ok: false, error: `M\xE1ximo ${ACTIONS_PER_ROUND} acciones por ronda` };
    const used = { peon: 0, inf: 0, cab: 0, arq: 0 };
    const touched = /* @__PURE__ */ new Set();
    for (const a of actions) {
      if (!a || !Number.isInteger(a.cell) || a.cell < 0 || a.cell >= N * N) return { ok: false, error: "Casilla no v\xE1lida" };
      if (touched.has(a.cell)) return { ok: false, error: "Solo una acci\xF3n por casilla" };
      touched.add(a.cell);
      if (a.type === "place") {
        if (!UNITS[a.unit]) return { ok: false, error: "Unidad desconocida" };
        if (!reachable(state, p, a.unit).has(a.cell)) return { ok: false, error: "Esa unidad no llega a esa casilla" };
        used[a.unit] += 1;
      } else if (a.type === "build") {
        if (!BUILDINGS[a.building]) return { ok: false, error: "Edificio desconocido" };
        if (!buildable(state, p).has(a.cell)) return { ok: false, error: "Solo puedes construir en casillas tuyas libres" };
        used.peon += BUILDINGS[a.building].cost;
      } else {
        return { ok: false, error: "Acci\xF3n desconocida" };
      }
    }
    for (const [u, n] of Object.entries(used)) {
      if (n > state.hands[p][u]) return { ok: false, error: `No tienes suficientes ${UNITS[u].name.toLowerCase()}` };
    }
    return { ok: true };
  }
  function flank(start, attacker, cell) {
    const own = orthogonal(cell).filter((n) => start.cells[n].owner === attacker).length;
    return Math.min(FLANK_MAX, Math.max(0, own - 1)) * FLANK_PER_CELL;
  }
  function attackPower(start, attacker, unit, vsUnit, cell) {
    return UNITS[unit].power + (beats(unit, vsUnit) ? ADVANTAGE : 0) + (unit === "arq" ? ARQ_STRIKE : 0) + flank(start, attacker, cell);
  }
  function support(start, cell) {
    const owner = start.cells[cell].owner;
    if (!owner) return 0;
    const own = orthogonal(cell).filter((n) => start.cells[n].owner === owner).length;
    return Math.min(SUPPORT_MAX, Math.max(0, own - 1)) * SUPPORT_PER_CELL;
  }
  function defensePower(start, unit, vsUnit, cell) {
    const c = start.cells[cell];
    return UNITS[unit].power + (beats(unit, vsUnit) ? ADVANTAGE : 0) + (unit === "inf" ? INF_HOLD : 0) + (c.building === "muralla" ? WALL_DEFENSE : 0) + (c.capital ? CAPITAL_DEFENSE : 0) + support(start, cell);
  }
  function explainDefense(start, unit, vsUnit, cell) {
    const c = start.cells[cell];
    return {
      base: UNITS[unit].power,
      advantage: beats(unit, vsUnit) ? ADVANTAGE : 0,
      hold: unit === "inf" ? INF_HOLD : 0,
      wall: c.building === "muralla" ? WALL_DEFENSE : 0,
      capital: c.capital ? CAPITAL_DEFENSE : 0,
      support: support(start, cell)
    };
  }
  function explainAttack(start, attacker, unit, vsUnit, cell) {
    return {
      base: UNITS[unit].power,
      advantage: beats(unit, vsUnit) ? ADVANTAGE : 0,
      strike: unit === "arq" ? ARQ_STRIKE : 0,
      flank: flank(start, attacker, cell)
    };
  }
  function take(cell, p, unit) {
    Object.assign(cell, { owner: p, unit, building: null });
  }
  function resolveRound(state, actionsByPlayer) {
    if (state.status !== "playing") throw new Error("La partida ha terminado");
    for (const p of PLAYERS) {
      const v = validateActions(state, p, actionsByPlayer[p]);
      if (!v.ok) throw new Error(`Jugada inv\xE1lida de ${p}: ${v.error}`);
    }
    const start = state;
    const next = structuredClone(state);
    const events = [];
    const placements = /* @__PURE__ */ new Map();
    const builds = [];
    for (const p of PLAYERS) {
      for (const a of actionsByPlayer[p]) {
        if (a.type === "place") {
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
      for (const p2 of PLAYERS) {
        if (by[p2] && owner === p2 && before.unit) next.hands[p2][before.unit] += 1;
      }
      if (by.A && by.B) {
        if (by.A === by.B) {
          if (before.capital) {
            const holder = before.capital;
            take(cell, holder, by[holder]);
            cell.capital = holder;
            events.push({ cell: i, kind: "hold", by: holder, unit: by[holder], vs: by[other(holder)], note: "capital" });
          } else {
            Object.assign(cell, { owner: null, unit: null, building: null, blocked: true });
            events.push({ cell: i, kind: "black", unit: by.A });
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
            events.push({ cell: i, kind: "capture", by: att, unit: by[att], vs: by[def], power: [pa, pd] });
          } else {
            cell.unit = by[def];
            events.push({ cell: i, kind: "hold", by: def, unit: by[def], vs: by[att], power: [pa, pd] });
          }
        } else {
          const pA = attackPower(start, "A", by.A, by.B, i);
          const pB = attackPower(start, "B", by.B, by.A, i);
          if (pA === pB) {
            events.push({ cell: i, kind: "bounce", units: { A: by.A, B: by.B }, power: [pA, pB] });
          } else {
            const w = pA > pB ? "A" : "B";
            take(cell, w, by[w]);
            events.push({ cell: i, kind: "conquer", by: w, unit: by[w], vs: by[other(w)], power: w === "A" ? [pA, pB] : [pB, pA] });
          }
        }
        continue;
      }
      const p = by.A ? "A" : "B";
      const unit = by[p];
      if (owner === p) {
        cell.unit = unit;
        events.push({ cell: i, kind: "repaint", by: p, unit });
      } else if (!owner) {
        take(cell, p, unit);
        events.push({ cell: i, kind: "conquer", by: p, unit });
      } else {
        const pa = attackPower(start, p, unit, before.unit, i);
        const pd = defensePower(start, before.unit, unit, i);
        if (pa > pd) {
          take(cell, p, unit);
          captured[p] += 1;
          events.push({ cell: i, kind: "capture", by: p, unit, vs: before.unit, power: [pa, pd] });
        } else {
          events.push({ cell: i, kind: "repel", by: p, unit, vs: before.unit, defender: owner, power: [pa, pd] });
        }
      }
    }
    for (const b of builds) {
      const cell = next.cells[b.cell];
      if (cell.owner === b.p && !cell.building && !cell.blocked) {
        cell.building = b.building;
        events.push({ cell: b.cell, kind: "build", by: b.p, building: b.building });
      } else {
        events.push({ cell: b.cell, kind: "build-lost", by: b.p, building: b.building });
      }
    }
    for (const p of PLAYERS) {
      if (captured[p] > 0) {
        const rng = makeRng(state.seed, state.round, p, "loot");
        const u = MILITARY[Math.floor(rng() * MILITARY.length)];
        next.hands[p][u] += 1;
        events.push({ kind: "loot", by: p, unit: u });
      }
    }
    for (const p of PLAYERS) {
      if (next.cells[CAPITAL[p]].owner !== p) continue;
      const linked = suppliedFrom(next, p);
      for (const c of next.cells) {
        if (c.owner === p && !linked.has(c.i)) {
          events.push({ cell: c.i, kind: "cutoff", by: p, unit: c.unit, building: c.building });
          Object.assign(c, { owner: null, unit: null, building: null });
        }
      }
    }
    next.history.push({ round: state.round, actions: structuredClone(actionsByPlayer) });
    decideOutcome(next, events);
    if (next.status === "playing") {
      for (const p of PLAYERS) {
        const gain = income(next, p);
        for (const [u, n] of Object.entries(gain)) next.hands[p][u] += n;
        events.push({ kind: "income", by: p, gain });
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
      next.status = "over";
      next.winner = winner;
      next.reason = reason;
      events.push({ kind: "end", winner, reason });
    };
    const byPoints = (reason) => {
      const keys = (p) => [score(next, p), cellsOf(next, p).length, soldiers(next, p)];
      const a = keys("A");
      const b = keys("B");
      for (let k = 0; k < a.length; k++) {
        if (a[k] !== b[k]) return end(a[k] > b[k] ? "A" : "B", reason);
      }
      end(null, reason);
    };
    if (lostCapital.length === 2) return byPoints("capitals");
    if (lostCapital.length === 1) return end(other(lostCapital[0]), "capital");
    for (const p of PLAYERS) {
      if (cellsOf(next, p).length >= Math.ceil(total * DOMINATION_SHARE)) return end(p, "domination");
    }
    if (next.round >= MAX_ROUNDS) return byPoints("rounds");
  }
  function stateHash(state) {
    return hashOf({
      v: state.version,
      seed: state.seed,
      round: state.round,
      cells: state.cells.map((c) => [c.owner, c.unit, c.building, c.blocked ? 1 : 0, c.rock ? 1 : 0, c.capital]),
      hands: state.hands,
      status: state.status,
      winner: state.winner
    });
  }
  function replay(seed, history) {
    let s = createGame(seed);
    for (const h of history) s = resolveRound(s, h.actions);
    return s;
  }

  // src/engine/bot.js
  var MIND_GAME_RATE = 0.15;
  function botActions(state, p, { level = "normal" } = {}) {
    const rng = makeRng(state.seed, state.round, p, "bot", level);
    if (level === "facil" && rng() < 0.5) return randomActions(state, p, "facil");
    const foe = other(p);
    const hand = { ...state.hands[p] };
    const foeHand = state.hands[foe];
    const foeCap = CAPITAL[foe];
    const candidates = [];
    const jitter = () => rng() * 6;
    const borderOf = (i) => orthogonal(i).some((n) => state.cells[n].owner === foe);
    const foeReach = Object.fromEntries(MILITARY.map((u) => [u, foeHand[u] > 0 ? reachable(state, foe, u) : /* @__PURE__ */ new Set()]));
    const threats = (garrison, i) => MILITARY.filter(
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
            s += cutValue(state, p, i) * 3;
            candidates.push({ s: s + jitter(), a: { type: "place", cell: i, unit } });
          }
        } else if (!c.owner) {
          const contested = borderOf(i) || orthogonal(i).some((n) => state.cells[n].owner === foe);
          let s = unit === "peon" ? 6 : contested ? 5 : 1;
          if (contested && unit === "peon") s -= 4;
          s += (14 - distance(i, foeCap)) * 0.25;
          candidates.push({ s: s + jitter(), a: { type: "place", cell: i, unit } });
        } else if (c.owner === p && unit !== "peon") {
          const threatsNow = threats(c.unit, i);
          if (!threatsNow.length) continue;
          const cut = cutValue(state, foe, i);
          if (!c.capital && cut < 3 && rng() > MIND_GAME_RATE) continue;
          const value = 9 + (c.capital ? 30 : 0) + (c.building ? 4 : 0) + cut * 3;
          const threatsAfter = threats(unit, i);
          if (threatsAfter.length === 0) {
            candidates.push({ s: value + jitter(), a: { type: "place", cell: i, unit } });
          } else if (!c.capital && threatsNow.includes(unit)) {
            candidates.push({ s: value - 2 + jitter(), a: { type: "place", cell: i, unit } });
          }
        }
      }
    }
    for (const i of buildable(state, p)) {
      const c = state.cells[i];
      const border = borderOf(i);
      const nearCap = distance(i, CAPITAL[p]) <= 2;
      if (!border) candidates.push({ s: 4 + jitter(), a: { type: "build", cell: i, building: "granja" } });
      if (!border && c.unit !== "peon") candidates.push({ s: 5 + jitter(), a: { type: "build", cell: i, building: "cuartel" } });
      if (border && nearCap) candidates.push({ s: 6 + jitter(), a: { type: "build", cell: i, building: "muralla" } });
    }
    candidates.sort((x, y) => y.s - x.s);
    const chosen = [];
    const usedCells = /* @__PURE__ */ new Set();
    const pawnReserve = 0;
    for (const { a } of candidates) {
      if (chosen.length >= ACTIONS_PER_ROUND) break;
      if (usedCells.has(a.cell)) continue;
      if (a.type === "place") {
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
    return validateActions(state, p, chosen).ok ? chosen : [];
  }
  function randomActions(state, p, seedSalt = "rand") {
    const rng = makeRng(state.seed, state.round, p, seedSalt);
    const hand = { ...state.hands[p] };
    const chosen = [];
    const used = /* @__PURE__ */ new Set();
    for (let tries = 0; tries < 40 && chosen.length < ACTIONS_PER_ROUND; tries++) {
      const unit = UNIT_KEYS[Math.floor(rng() * UNIT_KEYS.length)];
      if (hand[unit] <= 0) continue;
      const opts = [...reachable(state, p, unit)].filter((i) => !used.has(i));
      if (!opts.length) continue;
      const cell = opts[Math.floor(rng() * opts.length)];
      hand[unit] -= 1;
      used.add(cell);
      chosen.push({ type: "place", cell, unit });
    }
    return validateActions(state, p, chosen).ok ? chosen : [];
  }

  // src/net/session.js
  var Session = class {
    /**
     * @param {object} opts
     * @param {'A'|'B'} opts.role   A = host, B = guest
     * @param {object}  opts.transport  { send(msg), onMessage(cb), onOpen(cb), onClose(cb), close() }
     */
    constructor({ role, transport }) {
      this.role = role;
      this.foe = other(role);
      this.state = null;
      this.listeners = {};
      this.over = false;
      this._seedShare = randomHex(16);
      this._seedSalt = randomHex(16);
      this._foeSeedCommit = null;
      this._sentSeedReveal = false;
      this._myHashes = /* @__PURE__ */ new Map();
      this._foeHashes = /* @__PURE__ */ new Map();
      this._resetRound();
      this.attach(transport);
    }
    on(event, cb) {
      var _a;
      ((_a = this.listeners)[event] || (_a[event] = [])).push(cb);
      return this;
    }
    emit(event, payload) {
      for (const cb of this.listeners[event] || []) cb(payload);
    }
    /** Attach a (new) transport. Used at start and when reconnecting. */
    attach(transport) {
      this.transport = transport;
      transport.onMessage((msg) => this._receive(msg));
      transport.onClose(() => this.emit("disconnected"));
      transport.onOpen(() => {
        this.emit("connected");
        if (this.state) {
          this._resetRound();
          if (this.role === "A") this._send({ t: "sync", seed: this.state.seed, history: this.state.history });
          this.emit("resync", { state: this.state });
        } else {
          this._send({ t: "hello", v: VERSION, commit: sha256(this._seedShare + this._seedSalt) });
        }
      });
    }
    _resetRound() {
      this._mine = null;
      this._foeCommit = null;
      this._foeReveal = null;
      this._sentReveal = false;
    }
    _send(msg) {
      try {
        this.transport.send(msg);
      } catch (err) {
        this.emit("error", { code: "send", message: String(err?.message || err) });
      }
    }
    _fail(code, message) {
      this.over = true;
      this.emit("error", { code, message });
    }
    // ------------------------------------------------------------ public API
    /** Lock in this round's moves. Throws if they break the rules. */
    submit(actions) {
      if (!this.state || this.over) throw new Error("La partida no est\xE1 activa");
      if (this._mine) throw new Error("Ya has confirmado esta ronda");
      const v = validateActions(this.state, this.role, actions);
      if (!v.ok) throw new Error(v.error);
      const round = this.state.round;
      const salt = randomHex(16);
      this._mine = { round, actions: structuredClone(actions), salt };
      this._send({ t: "commit", round, hash: hashOf({ round, actions, salt }) });
      this.emit("committed", { round });
      this._maybeReveal();
    }
    resign() {
      if (this.over) return;
      this._send({ t: "resign" });
      this.over = true;
      this.emit("ended", { winner: this.foe, reason: "resign" });
    }
    get waitingForFoe() {
      return Boolean(this._mine && !this._foeReveal);
    }
    get foeCommitted() {
      return Boolean(this._foeCommit);
    }
    // ------------------------------------------------------------ protocol
    _receive(msg) {
      if (!msg || typeof msg !== "object") return;
      switch (msg.t) {
        case "hello":
          if (msg.v !== VERSION) return this._fail("version", `El rival usa la versi\xF3n ${msg.v} y t\xFA la ${VERSION}`);
          this._foeSeedCommit = msg.commit;
          if (!this._sentSeedReveal) {
            this._sentSeedReveal = true;
            this._send({ t: "seed", share: this._seedShare, salt: this._seedSalt });
          }
          break;
        case "seed": {
          if (this.state) return;
          if (!this._foeSeedCommit || sha256(msg.share + msg.salt) !== this._foeSeedCommit) {
            return this._fail("cheat", "La semilla del rival no coincide con su compromiso");
          }
          const shares = this.role === "A" ? [this._seedShare, msg.share] : [msg.share, this._seedShare];
          const seed = sha256(shares.join(":")).slice(0, 16);
          this.state = createGame(seed);
          this.emit("start", { state: this.state, role: this.role });
          break;
        }
        case "commit":
          if (!this.state || msg.round !== this.state.round) return;
          this._foeCommit = { round: msg.round, hash: msg.hash };
          this.emit("foeCommitted", { round: msg.round });
          this._maybeReveal();
          break;
        case "reveal": {
          if (!this.state || !this._foeCommit || msg.round !== this.state.round) return;
          const expected = hashOf({ round: msg.round, actions: msg.actions, salt: msg.salt });
          if (expected !== this._foeCommit.hash) return this._fail("cheat", "El rival cambi\xF3 su jugada despu\xE9s de confirmarla");
          const v = validateActions(this.state, this.foe, msg.actions);
          if (!v.ok) return this._fail("cheat", `Jugada ilegal del rival: ${v.error}`);
          this._foeReveal = { actions: msg.actions };
          this._maybeResolve();
          break;
        }
        case "state":
          this._foeHashes.set(msg.round, msg.hash);
          this._checkHash(msg.round);
          break;
        case "sync": {
          if (this.role !== "B") return;
          try {
            const rebuilt = replay(msg.seed, msg.history);
            this.state = rebuilt;
            this._resetRound();
            this.emit("resync", { state: this.state });
          } catch (err) {
            this._fail("cheat", `Historial inv\xE1lido al reconectar: ${err.message}`);
          }
          break;
        }
        case "resign":
          if (this.over) return;
          this.over = true;
          this.emit("ended", { winner: this.role, reason: "resign" });
          break;
        default:
          break;
      }
    }
    _checkHash(round) {
      const mine = this._myHashes.get(round);
      const theirs = this._foeHashes.get(round);
      if (!mine || !theirs) return;
      if (mine !== theirs) this._fail("desync", "Los dos tableros no coinciden. Partida detenida.");
      else this.emit("verified", { round });
    }
    _maybeReveal() {
      if (this._mine && this._foeCommit && !this._sentReveal) {
        this._sentReveal = true;
        this._send({ t: "reveal", round: this._mine.round, actions: this._mine.actions, salt: this._mine.salt });
        this._maybeResolve();
      }
    }
    _maybeResolve() {
      if (!this._mine || !this._foeReveal || !this._sentReveal) return;
      const actions = { [this.role]: this._mine.actions, [this.foe]: this._foeReveal.actions };
      const prev = this.state;
      const round = prev.round;
      this.state = resolveRound(prev, actions);
      const hash = stateHash(this.state);
      this._myHashes.set(round, hash);
      this._send({ t: "state", round, hash });
      this._checkHash(round);
      if (this.over) return;
      this._resetRound();
      this.emit("round", { prev, state: this.state, actions });
      if (this.state.status === "over") {
        this.over = true;
        this.emit("ended", { winner: this.state.winner, reason: this.state.reason });
      }
    }
  };
  var ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function newRoomCode(length = 5) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join("");
  }
  function normalizeRoomCode(text) {
    return String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  }

  // src/net/transports.js
  var PEER_PREFIX = "sembrado-001-";
  var PEERJS_URL = "https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js";
  function base() {
    const cbs = { message: [], open: [], close: [] };
    let opened = false;
    return {
      cbs,
      fire(kind, arg) {
        if (kind === "open") opened = true;
        for (const cb of cbs[kind]) cb(arg);
      },
      api: {
        onMessage: (cb) => cbs.message.push(cb),
        // Late subscribers to an already-open transport still get the event.
        onOpen: (cb) => {
          cbs.open.push(cb);
          if (opened) queueMicrotask(cb);
        },
        onClose: (cb) => cbs.close.push(cb)
      }
    };
  }
  function broadcastTransport(code, role) {
    const t = base();
    const ch = new BroadcastChannel(`sembrado-${code}`);
    const me = `${role}-${Math.random().toString(36).slice(2)}`;
    let peer = null;
    ch.onmessage = (e) => {
      const { from, kind, msg } = e.data || {};
      if (!from || from === me) return;
      if (kind === "join") {
        if (peer && peer !== from) return;
        const isNew = !peer;
        peer = from;
        ch.postMessage({ from: me, kind: "join" });
        if (isNew) t.fire("open");
      } else if (kind === "msg" && from === peer) {
        t.fire("message", msg);
      } else if (kind === "leave" && from === peer) {
        peer = null;
        t.fire("close");
      }
    };
    ch.postMessage({ from: me, kind: "join" });
    addEventListener("pagehide", () => ch.postMessage({ from: me, kind: "leave" }));
    return {
      ...t.api,
      send: (msg) => ch.postMessage({ from: me, kind: "msg", msg }),
      close: () => {
        ch.postMessage({ from: me, kind: "leave" });
        ch.close();
      }
    };
  }
  var peerjsPromise = null;
  function loadPeerJS() {
    if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
    peerjsPromise || (peerjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PEERJS_URL;
      s.async = true;
      s.onload = () => globalThis.Peer ? resolve(globalThis.Peer) : reject(new Error("PeerJS no se carg\xF3"));
      s.onerror = () => {
        peerjsPromise = null;
        reject(new Error("No se pudo descargar PeerJS. Comprueba la conexi\xF3n."));
      };
      document.head.appendChild(s);
    }));
    return peerjsPromise;
  }
  function peerOptions() {
    const ice = globalThis.SEMBRADO_ICE;
    return ice ? { config: { iceServers: ice } } : {};
  }
  function wrapConnection(conn, t) {
    conn.on("open", () => t.fire("open"));
    conn.on("data", (d) => t.fire("message", d));
    conn.on("close", () => t.fire("close"));
    conn.on("error", () => t.fire("close"));
  }
  async function hostRoom(code, { onTransport, onError }) {
    const Peer = await loadPeerJS();
    const peer = new Peer(PEER_PREFIX + code, peerOptions());
    let current = null;
    peer.on("connection", (conn) => {
      if (current) current.close?.();
      const t = base();
      const transport = { ...t.api, send: (m) => conn.send(m), close: () => conn.close() };
      current = conn;
      wrapConnection(conn, t);
      onTransport(transport);
    });
    peer.on("error", (err) => {
      const map = {
        "unavailable-id": "Ese c\xF3digo de sala ya est\xE1 en uso. Crea otro.",
        network: "Sin conexi\xF3n con el servidor de emparejamiento.",
        "server-error": "El servidor de emparejamiento no responde."
      };
      onError?.(map[err.type] || `Error de conexi\xF3n (${err.type || "desconocido"})`);
    });
    peer.on("disconnected", () => {
      if (!peer.destroyed) peer.reconnect();
    });
    await new Promise((resolve, reject) => {
      peer.on("open", resolve);
      peer.on("error", reject);
    });
    return { close: () => peer.destroy() };
  }
  async function joinRoom(code, { onError } = {}) {
    const Peer = await loadPeerJS();
    const peer = new Peer(peerOptions());
    await new Promise((resolve, reject) => {
      peer.on("open", resolve);
      peer.on("error", reject);
    });
    peer.on("error", (err) => {
      const map = { "peer-unavailable": "No existe ninguna sala con ese c\xF3digo." };
      onError?.(map[err.type] || `Error de conexi\xF3n (${err.type || "desconocido"})`);
    });
    const connect = () => {
      const t = base();
      const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
      wrapConnection(conn, t);
      return { ...t.api, send: (m) => conn.send(m), close: () => conn.close() };
    };
    return { transport: connect(), reconnect: connect, close: () => peer.destroy() };
  }

  // src/ui/app.js
  var ONLINE_ROUND_SECONDS = 60;
  var SAVE_KEY = "sembrado.bot.v1";
  var params = new URLSearchParams(location.search);
  var DEV_BC = params.get("dev") === "bc";
  var $ = (id) => document.getElementById(id);
  var VS = "\uFE0E";
  var glyph = (u) => UNITS[u].glyph + VS;
  var esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var app = {
    mode: null,
    // 'bot' | 'online'
    me: "A",
    level: "normal",
    state: null,
    plan: [],
    tool: null,
    // { kind: 'unit', unit } | { kind: 'build', building }
    phase: "plan",
    // 'plan' | 'waiting' | 'reveal' | 'over'
    session: null,
    net: null,
    foeReady: false,
    deadline: 0,
    timerId: null,
    reconnecting: false
  };
  var storage = {
    get(key) {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
      }
    },
    del(key) {
      try {
        localStorage.removeItem(key);
      } catch {
      }
    }
  };
  var buzz = (ms = 8) => navigator.vibrate?.(ms);
  var toastTimer;
  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }
  function viewIndex(i) {
    return app.me === "A" ? i : 63 - i;
  }
  function coordName(i) {
    const v = viewIndex(i);
    const [x, y] = xy(v);
    return `${"abcdefgh"[x]}${8 - y}`;
  }
  function show(screen) {
    for (const s of document.querySelectorAll(".screen")) s.classList.toggle("active", s.id === `screen-${screen}`);
  }
  var sheetLocked = false;
  function openSheet(html, { locked = false } = {}) {
    sheetLocked = locked;
    $("sheet-body").innerHTML = html;
    $("scrim").classList.add("open");
    $("sheet").classList.add("open");
    const first = $("sheet").querySelector("button, input");
    setTimeout(() => first?.focus({ preventScroll: true }), 50);
  }
  function closeSheet() {
    sheetLocked = false;
    $("scrim").classList.remove("open");
    $("sheet").classList.remove("open");
  }
  $("scrim").addEventListener("click", () => !sheetLocked && closeSheet());
  document.addEventListener("keydown", (e) => e.key === "Escape" && !sheetLocked && closeSheet());
  function onSheet(selector, handler) {
    for (const el of $("sheet-body").querySelectorAll(selector)) el.addEventListener("click", handler);
  }
  function usedByPlan(plan = app.plan) {
    const used = { peon: 0, inf: 0, cab: 0, arq: 0 };
    for (const a of plan) {
      if (a.type === "place") used[a.unit] += 1;
      else used.peon += BUILDINGS[a.building].cost;
    }
    return used;
  }
  function remaining(unit) {
    return app.state.hands[app.me][unit] - usedByPlan()[unit];
  }
  function targets() {
    if (!app.tool || app.phase !== "plan") return /* @__PURE__ */ new Set();
    const planned = new Set(app.plan.map((a) => a.cell));
    const base2 = app.tool.kind === "unit" ? reachable(app.state, app.me, app.tool.unit) : buildable(app.state, app.me);
    return new Set([...base2].filter((i) => !planned.has(i)));
  }
  function chipHTML(unit) {
    return `<span class="chip ${unit}" aria-hidden="true">${glyph(unit)}</span>`;
  }
  function renderBoard({ revealActions = null } = {}) {
    const s = app.state;
    const t = targets();
    const toolColor = app.tool?.kind === "unit" ? `var(--${app.tool.unit})` : "var(--mine)";
    const board = $("board");
    board.style.setProperty("--tool", toolColor);
    const order = [...Array(64).keys()].map((v) => viewIndex(v));
    const planByCell = new Map(app.plan.map((a, k) => [a.cell, { ...a, n: k + 1 }]));
    board.replaceChildren(
      ...order.map((i) => {
        const c = s.cells[i];
        const el = document.createElement("button");
        el.className = "cell";
        el.dataset.i = i;
        el.setAttribute("role", "gridcell");
        const side = c.owner === app.me ? "mine" : c.owner ? "foe" : "neutral";
        if (c.rock) el.classList.add("rock");
        else if (c.blocked) el.classList.add("blocked");
        else el.classList.add(side);
        if (t.has(i)) el.classList.add("target");
        let html = "";
        if (c.unit) html += chipHTML(c.unit);
        if (c.capital) html += `<span class="badge cap" aria-hidden="true">\u265B${VS}</span>`;
        if (c.building) html += `<span class="badge bld" aria-hidden="true">${BUILDINGS[c.building].glyph}</span>`;
        const plan = planByCell.get(i);
        if (plan) {
          const inner = plan.type === "place" ? chipHTML(plan.unit) : `<span class="bglyph">${BUILDINGS[plan.building].glyph}</span>`;
          html += `<span class="plan">${inner}<span class="n">${plan.n}</span></span>`;
        }
        if (revealActions) {
          for (const p of ["A", "B"]) {
            const a = revealActions[p].find((x) => x.cell === i);
            if (a && a.type === "place") html += `<span class="reveal-chip ${p === app.me ? "my-move" : "foe-move"}">${chipHTML(a.unit)}</span>`;
          }
        }
        const v = viewIndex(i);
        const [vx, vy] = xy(v);
        if (vx === 0 || vy === 7) {
          const label = vy === 7 && vx === 0 ? "a1" : vy === 7 ? "abcdefgh"[vx] : String(8 - vy);
          html += `<span class="coord">${label}</span>`;
        }
        el.innerHTML = html;
        el.setAttribute("aria-label", describeCell(i, plan));
        return el;
      })
    );
  }
  function describeCell(i, plan) {
    const c = app.state.cells[i];
    const name = coordName(i);
    if (c.rock) return `${name}, roca`;
    if (c.blocked) return `${name}, casilla negra`;
    const who = c.owner === app.me ? "tuya" : c.owner ? "del rival" : "libre";
    let text = `${name}, ${who}`;
    if (c.unit) text += `, ${UNITS[c.unit].name}`;
    if (c.capital) text += ", capital";
    if (c.building) text += `, ${BUILDINGS[c.building].name}`;
    if (plan) text += plan.type === "place" ? `, planeado ${UNITS[plan.unit].name}` : `, planeado ${BUILDINGS[plan.building].name}`;
    return text;
  }
  function renderTray() {
    const tray = $("tray");
    const disabled = app.phase !== "plan";
    const tools = UNIT_KEYS.map((u) => {
      const n = remaining(u);
      const pressed = app.tool?.kind === "unit" && app.tool.unit === u;
      return `<button class="tool" data-unit="${u}" style="--tool: var(--${u})" aria-pressed="${pressed}" ${disabled || n <= 0 ? "disabled" : ""} aria-label="${UNITS[u].name}, quedan ${n}">
      <span class="top">${chipHTML(u)}<span class="count">${n}</span></span><span class="label">${UNITS[u].short}</span></button>`;
    });
    const buildPressed = app.tool?.kind === "build";
    const buildGlyph = buildPressed ? BUILDINGS[app.tool.building].glyph : "\u2302";
    tools.push(`<button class="tool" data-build aria-pressed="${buildPressed}" ${disabled ? "disabled" : ""} aria-label="Construir">
    <span class="top"><span class="bglyph" aria-hidden="true">${buildGlyph}</span></span><span class="label">${buildPressed ? BUILDINGS[app.tool.building].name : "Construir"}</span></button>`);
    tray.innerHTML = tools.join("");
    for (const b of tray.querySelectorAll("[data-unit]")) {
      b.addEventListener("click", () => {
        const u = b.dataset.unit;
        app.tool = app.tool?.kind === "unit" && app.tool.unit === u ? null : { kind: "unit", unit: u };
        buzz(5);
        render();
      });
    }
    tray.querySelector("[data-build]").addEventListener("click", () => buildPressed ? (app.tool = null, render()) : openBuildSheet());
  }
  function renderStatus() {
    const s = app.state;
    const mine = cellsOf(s, app.me).length;
    const foe = cellsOf(s, other(app.me)).length;
    const total = playableCount(s);
    $("round-label").innerHTML = `Ronda ${Math.min(s.round, MAX_ROUNDS)} <small>de ${MAX_ROUNDS}</small>`;
    $("cells-me").textContent = mine;
    $("cells-foe").textContent = foe;
    const goal = Math.round(DOMINATION_SHARE * 100);
    $("share-me").textContent = `${Math.round(mine / total * 100)}% de ${goal}%`;
    $("share-foe").textContent = `${Math.round(foe / total * 100)}% de ${goal}%`;
    $("foe-name").textContent = app.mode === "bot" ? `Bot ${app.level === "facil" ? "f\xE1cil" : "normal"}` : "Rival";
    $("me-income").textContent = s.status === "playing" ? `Refuerzos previstos ${gainText(income(s, app.me))}` : "";
    const phaseText = { plan: "Planifica", waiting: "Esperando", reveal: "Revelando", over: "Terminada" }[app.phase];
    $("phase").dataset.phase = app.phase;
    $("phase-text").textContent = phaseText;
    const fs = $("foe-status");
    if (app.mode === "online" && (app.phase === "plan" || app.phase === "waiting")) {
      fs.textContent = app.foeReady ? "Ya ha confirmado" : "Est\xE1 planificando";
      fs.classList.toggle("ready", app.foeReady);
    } else {
      fs.textContent = app.mode === "bot" ? "Decide sin ver tu jugada" : "";
      fs.classList.remove("ready");
    }
    $("pips").innerHTML = Array.from({ length: ACTIONS_PER_ROUND }, (_, k) => `<span class="${k < app.plan.length ? "used" : ""}"></span>`).join("");
    $("pips").setAttribute("aria-label", `${app.plan.length} de ${ACTIONS_PER_ROUND} acciones`);
    const confirm = $("btn-confirm");
    confirm.disabled = app.phase !== "plan";
    confirm.textContent = {
      waiting: "Jugada enviada",
      reveal: "Revelando",
      over: "Partida terminada",
      plan: app.plan.length ? "Confirmar jugada" : "Pasar ronda"
    }[app.phase];
  }
  function setHint(text, isError = false) {
    const h = $("hint");
    h.textContent = text;
    h.classList.toggle("error", isError);
  }
  function defaultHint() {
    if (app.phase === "waiting") return "Tu jugada est\xE1 cerrada. Se revela cuando confirme tu rival.";
    if (app.phase !== "plan") return "";
    if (app.plan.length >= ACTIONS_PER_ROUND) return "Tienes tus 3 \xF3rdenes. Toca una para quitarla.";
    if (!app.tool) return "Elige una unidad y toca una casilla resaltada.";
    if (app.tool.kind === "unit") return `${UNITS[app.tool.unit].name}. ${UNITS[app.tool.unit].note}`;
    const b = BUILDINGS[app.tool.building];
    return `${b.name} (${b.cost} peones): ${b.note} Toca una casilla tuya.`;
  }
  function orthogonalOwners(i) {
    return new Set(orthogonal(i).map((n) => app.state.cells[n].owner).filter(Boolean));
  }
  function describeOrder(a) {
    const s = app.state;
    const c = s.cells[a.cell];
    const at = coordName(a.cell);
    if (a.type === "build") return { title: `Construir ${BUILDINGS[a.building].name.toLowerCase()} en ${at}`, detail: `Cuesta ${BUILDINGS[a.building].cost} peones. ${BUILDINGS[a.building].note}` };
    const name = UNITS[a.unit].name.toLowerCase();
    if (c.owner === app.me) {
      const was = UNITS[c.unit].name.toLowerCase();
      return { title: `Cambiar guarnici\xF3n de ${at} a ${name}`, detail: `La ${was} vuelve a tu reserva.` };
    }
    if (!c.owner) {
      const contested = orthogonalOwners(a.cell).has(other(app.me));
      return { title: `Ocupar ${at} con ${name}`, detail: contested ? "Al lado del rival: puede disputarla." : "" };
    }
    const atk = sum(explainAttack(s, app.me, a.unit, c.unit, a.cell));
    const def = sum(explainDefense(s, c.unit, a.unit, a.cell));
    const wins = atk > def;
    return {
      title: `Atacar ${at} con ${name}`,
      detail: `<span class="${wins ? "good" : "bad"}">${atk} contra ${def}: ${wins ? "la tomas si no cambia su guarnici\xF3n" : "no basta"}</span>`
    };
  }
  function renderOrders() {
    const list = $("orders");
    if (app.phase !== "plan" && app.phase !== "waiting") {
      list.innerHTML = "";
      return;
    }
    if (!app.plan.length) {
      list.innerHTML = `<li class="empty">${app.phase === "plan" ? "Tus \xF3rdenes aparecer\xE1n aqu\xED. El rival no las ver\xE1 hasta que confirm\xE9is los dos." : ""}</li>`;
      return;
    }
    list.innerHTML = app.plan.map((a, k) => {
      const d = describeOrder(a);
      const icon = a.type === "place" ? chipHTML(a.unit) : `<span class="bglyph">${BUILDINGS[a.building].glyph}</span>`;
      const removable = app.phase === "plan";
      return `<li data-k="${k}" ${removable ? 'role="button" tabindex="0" aria-label="Quitar orden ' + (k + 1) + '"' : ""}><span class="n">${k + 1}</span>${icon}<span class="t">${d.title}${d.detail ? `<small>${d.detail}</small>` : ""}</span><span class="x" aria-hidden="true">${removable ? "\u2715" : ""}</span></li>`;
    }).join("");
    if (app.phase === "plan") {
      for (const li of list.querySelectorAll("[data-k]")) {
        const remove = () => {
          app.plan.splice(Number(li.dataset.k), 1);
          buzz(5);
          render();
        };
        li.addEventListener("click", remove);
        li.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), remove()));
      }
    }
  }
  function render(opts) {
    if (!app.state) return;
    renderStatus();
    renderBoard(opts);
    renderTray();
    renderOrders();
    setHint(defaultHint());
  }
  $("board").addEventListener("click", (e) => {
    const el = e.target.closest(".cell");
    if (!el || !app.state) return;
    const i = Number(el.dataset.i);
    const c = app.state.cells[i];
    if (c.rock) return;
    if (app.phase === "plan") {
      const k = app.plan.findIndex((a) => a.cell === i);
      if (k >= 0) {
        app.plan.splice(k, 1);
        buzz(5);
        render();
        return;
      }
      if (app.tool && targets().has(i)) {
        if (app.plan.length >= ACTIONS_PER_ROUND) return setHint("Ya usas tus 3 acciones esta ronda.", true);
        const action = app.tool.kind === "unit" ? { type: "place", cell: i, unit: app.tool.unit } : { type: "build", cell: i, building: app.tool.building };
        const v = validateActions(app.state, app.me, [...app.plan, action]);
        if (!v.ok) return setHint(v.error, true);
        app.plan.push(action);
        buzz(10);
        if (app.tool.kind === "unit" && remaining(app.tool.unit) <= 0) app.tool = null;
        if (app.tool?.kind === "build") app.tool = null;
        render();
        return;
      }
    }
    openCellSheet(i);
  });
  function openBuildSheet() {
    const pawns = remaining("peon");
    const items = BUILDING_KEYS.map((k) => {
      const b = BUILDINGS[k];
      const ok = pawns >= b.cost;
      return `<li class="pick" data-b="${k}" role="button" tabindex="0" aria-disabled="${!ok}">
      <span class="bglyph" style="font-size:24px;text-align:center">${b.glyph}</span>
      <span><span class="t">${b.name}</span><br><span class="d">${b.note}</span></span>
      <span class="v">${b.cost} ${glyph("peon")}</span></li>`;
    }).join("");
    openSheet(`<h2 id="sheet-title">Construir</h2>
    <p>Los edificios se levantan en casillas tuyas (no en la capital) y se pagan con peones. Si pierdes la casilla, se pierde el edificio.</p>
    <ul class="list">${items}</ul>
    <div class="stack"><button class="btn quiet" data-close>Cancelar</button></div>`);
    onSheet("[data-close]", closeSheet);
    onSheet("[data-b]", (e) => {
      const li = e.currentTarget;
      if (li.getAttribute("aria-disabled") === "true") return;
      app.tool = { kind: "build", building: li.dataset.b };
      closeSheet();
      render();
    });
  }
  function sum(o) {
    return Object.values(o).reduce((a, b) => a + b, 0);
  }
  function breakdown(parts, labels) {
    return Object.entries(parts).filter(([, v]) => v).map(([k, v]) => `${labels[k]} ${v}`).join(", ");
  }
  var ATT_LABELS = { base: "base", advantage: "ventaja", strike: "arqueros", flank: "flanqueo" };
  var DEF_LABELS = { base: "base", advantage: "ventaja", hold: "infanter\xEDa", wall: "muralla", capital: "capital", support: "apoyo" };
  function openCellSheet(i) {
    const s = app.state;
    const c = s.cells[i];
    const name = coordName(i);
    if (c.blocked) {
      openSheet(`<h2 id="sheet-title">${name}: casilla negra</h2><p>Los dos jugadores enviaron aqu\xED la misma unidad en la misma ronda. Nadie podr\xE1 ocuparla.</p>
      <div class="stack"><button class="btn" data-close>Cerrar</button></div>`);
      return onSheet("[data-close]", closeSheet);
    }
    const who = c.owner === app.me ? "Tuya" : c.owner ? "Del rival" : "Libre";
    let body = `<h2 id="sheet-title">${name}: ${who.toLowerCase()}</h2>`;
    const facts = [];
    if (c.unit) facts.push(`${UNITS[c.unit].name} de guarnici\xF3n`);
    if (c.capital) facts.push("capital");
    if (c.building) facts.push(`${BUILDINGS[c.building].name.toLowerCase()}`);
    body += `<p>${facts.length ? facts.join(", ").replace(/^./, (m) => m.toUpperCase()) + "." : "Sin unidades."}</p>`;
    if (c.owner && c.unit) {
      const attacker = other(c.owner);
      const rows = UNIT_KEYS.map((u) => {
        const at = explainAttack(s, attacker, u, c.unit, i);
        const df = explainDefense(s, c.unit, u, i);
        const a = sum(at);
        const d = sum(df);
        const wins = a > d;
        const verdict = c.owner === app.me ? wins ? "La tomar\xEDa" : "Resistes" : wins ? "La tomas" : "No basta";
        return `<li>${chipHTML(u)}<span><span class="t">${UNITS[u].name}: ${a} contra ${d}</span><br>
        <span class="d">Ataque: ${breakdown(at, ATT_LABELS)}. Defensa: ${breakdown(df, DEF_LABELS)}.</span></span>
        <span class="v" style="color:${wins === (c.owner !== app.me) ? "var(--ok)" : "var(--danger)"}">${verdict}</span></li>`;
      }).join("");
      body += `<h3>${c.owner === app.me ? "Si el rival ataca con" : "Si atacas con"}</h3>
      <p>El defensor gana los empates. Calculado con el tablero actual; si el due\xF1o cambia la guarnici\xF3n esta ronda, el resultado cambia.</p>
      <ul class="list">${rows}</ul>`;
    } else if (!c.owner) {
      body += "<p>Quien la ocupe primero se la queda. Si los dos envi\xE1is una unidad a la vez, gana la m\xE1s fuerte; con la misma unidad, se vuelve negra.</p>";
    }
    body += '<div class="stack"><button class="btn" data-close>Cerrar</button></div>';
    openSheet(body);
    onSheet("[data-close]", closeSheet);
  }
  $("btn-confirm").addEventListener("click", confirmPlan);
  function confirmPlan() {
    if (app.phase !== "plan") return;
    const v = validateActions(app.state, app.me, app.plan);
    if (!v.ok) return setHint(v.error, true);
    buzz(15);
    app.tool = null;
    if (app.mode === "bot") {
      const foe = other(app.me);
      const foeActs = botActions(app.state, foe, { level: app.level });
      const actions = { [app.me]: app.plan, [foe]: foeActs };
      const prev = app.state;
      const next = resolveRound(prev, actions);
      storage.set(SAVE_KEY, { seed: next.seed, history: next.history, level: app.level });
      runReveal(prev, next, actions);
    } else {
      try {
        app.session.submit(app.plan);
        app.phase = "waiting";
        stopTimer();
        render();
      } catch (err) {
        setHint(err.message, true);
      }
    }
  }
  function runReveal(prev, next, actions) {
    app.phase = "reveal";
    app.plan = [];
    app.state = prev;
    render({ revealActions: actions });
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(
      () => {
        app.state = next;
        app.phase = next.status === "over" ? "over" : "plan";
        render();
        const evCells = next.lastEvents.filter((e) => Number.isInteger(e.cell));
        evCells.forEach((e, k) => {
          const el = $("board").querySelector(`[data-i="${e.cell}"]`);
          if (!el) return;
          el.style.setProperty("--delay", `${k * 0.06}s`);
          el.classList.add("flash");
          if (e.kind === "black") el.classList.add("ev-black");
        });
        if (next.lastEvents.some((e) => e.kind === "black")) buzz([20, 40, 20]);
        setTimeout(() => afterReveal(next), reduce ? 0 : 500 + evCells.length * 60);
      },
      reduce ? 0 : 1100
    );
  }
  function afterReveal(state) {
    if (state.status === "over") return showGameOver(state.winner, state.reason);
    const report = roundReport(state.lastEvents);
    if (report.important) {
      openSheet(`<h2 id="sheet-title">Ronda ${state.round - 1}</h2><ul class="list">${report.html}</ul>
      <div class="stack"><button class="btn primary" data-close>Siguiente ronda</button></div>`);
      onSheet("[data-close]", closeSheet);
    } else if (report.summary) {
      toast(report.summary);
    }
    if (app.mode === "online") startTimer();
  }
  function gainText(gain) {
    return UNIT_KEYS.filter((u) => gain[u]).map((u) => `+${gain[u]} ${glyph(u)}`).join("  ");
  }
  function roundReport(events) {
    const me = app.me;
    const rows = [];
    let important = false;
    let summary = "";
    const pw = (e) => e.power ? ` (${e.power[0]} contra ${e.power[1]})` : "";
    const row = (unit, title, detail = "", tone = "") => rows.push(`<li>${unit ? chipHTML(unit) : "<span></span>"}<span><span class="t">${title}</span>${detail ? `<br><span class="d">${detail}</span>` : ""}</span><span class="v" style="color:${tone}">${tone ? "\u25CF" : ""}</span></li>`);
    for (const e of events) {
      const at = Number.isInteger(e.cell) ? coordName(e.cell) : "";
      const mine = e.by === me;
      switch (e.kind) {
        case "conquer":
          if (e.vs) {
            important = true;
            row(e.unit, mine ? `Ganas el choque en ${at}` : `El rival gana el choque en ${at}`, `${UNITS[e.unit].name} contra ${UNITS[e.vs].name}${pw(e)}`, mine ? "var(--ok)" : "var(--danger)");
          }
          break;
        case "capture":
          important = true;
          row(e.unit, mine ? `Tomas ${at}` : `Pierdes ${at}`, `${UNITS[e.unit].name} contra ${UNITS[e.vs].name}${pw(e)}`, mine ? "var(--ok)" : "var(--danger)");
          break;
        case "repel":
          important = true;
          row(e.unit, mine ? `Tu ataque en ${at} no basta` : `Resistes en ${at}`, `${UNITS[e.unit].name} contra ${UNITS[e.vs].name}${pw(e)}. El defensor gana los empates.`, mine ? "var(--danger)" : "var(--ok)");
          break;
        case "hold":
          important = true;
          row(e.unit, mine ? `Aguantas ${at}` : `El rival aguanta ${at}`, e.note === "capital" ? "Misma unidad en una capital: el defensor la conserva." : `${UNITS[e.unit].name} contra ${UNITS[e.vs].name}${pw(e)}`, mine ? "var(--ok)" : "var(--danger)");
          break;
        case "black":
          important = true;
          row(e.unit, `${at} se quema`, `Los dos enviasteis ${UNITS[e.unit].name.toLowerCase()}. Nadie podr\xE1 ocuparla.`, "#000");
          break;
        case "bounce":
          important = true;
          row(null, `Choque sin vencedor en ${at}`, `Misma fuerza${pw(e)}. La casilla sigue libre.`);
          break;
        case "cutoff":
          important = true;
          row(e.unit, mine ? `Pierdes ${at} por suministro` : `El rival pierde ${at} por suministro`, "Qued\xF3 desconectada de su capital.", mine ? "var(--danger)" : "var(--ok)");
          break;
        case "build":
          if (mine) row(null, `Construyes ${BUILDINGS[e.building].name.toLowerCase()} en ${at}`);
          else {
            important = true;
            row(null, `El rival construye ${BUILDINGS[e.building].name.toLowerCase()} en ${at}`);
          }
          break;
        case "build-lost":
          if (mine) {
            important = true;
            row(null, `Tu ${BUILDINGS[e.building].name.toLowerCase()} en ${at} no se construy\xF3`, "Perdiste la casilla en esta ronda.", "var(--danger)");
          }
          break;
        case "loot":
          if (mine) row(e.unit, `Bot\xEDn: +1 ${UNITS[e.unit].name.toLowerCase()}`, "Por capturar terreno del rival.", "var(--ok)");
          break;
        case "income":
          if (mine) {
            summary = `Refuerzos: ${gainText(e.gain)}`;
            row(null, "Refuerzos", gainText(e.gain));
          }
          break;
        default:
          break;
      }
    }
    return { important, html: rows.join(""), summary };
  }
  var REASONS = {
    capital: (w) => w === app.me ? "Has tomado la capital rival." : "El rival ha tomado tu capital.",
    capitals: () => "Las dos capitales cayeron en la misma ronda. Decidieron los puntos.",
    domination: (w) => w === app.me ? `Controlas el ${Math.round(DOMINATION_SHARE * 100)}% del tablero.` : `El rival controla el ${Math.round(DOMINATION_SHARE * 100)}% del tablero.`,
    rounds: () => `Se acabaron las ${MAX_ROUNDS} rondas. Gana quien tiene m\xE1s puntos: casillas, m\xE1s 2 por edificio.`,
    resign: (w) => w === app.me ? "Tu rival se ha rendido." : "Te has rendido."
  };
  function showGameOver(winner, reason) {
    app.phase = "over";
    stopTimer();
    if (app.mode === "bot") storage.del(SAVE_KEY);
    render();
    const title = winner === null ? "Empate" : winner === app.me ? "Victoria" : "Derrota";
    const s = app.state;
    openSheet(
      `<p class="result${winner === app.me ? " win" : ""}" id="sheet-title">${title}</p><p>${REASONS[reason]?.(winner) ?? ""}</p>
    <ul class="list">
      <li><span></span><span class="t">Tus casillas</span><span class="v">${cellsOf(s, app.me).length}</span></li>
      <li><span></span><span class="t">Casillas del rival</span><span class="v">${cellsOf(s, other(app.me)).length}</span></li>
      <li><span></span><span class="t">Rondas jugadas</span><span class="v">${s.history.length}</span></li>
    </ul>
    <div class="stack">
      ${app.mode === "bot" ? '<button class="btn primary" data-again>Jugar otra vez</button>' : ""}
      <button class="btn" data-home>Volver al inicio</button>
    </div>`,
      { locked: true }
    );
    onSheet("[data-again]", () => {
      closeSheet();
      startBot(app.level);
    });
    onSheet("[data-home]", goHome);
  }
  function startTimer() {
    stopTimer();
    app.deadline = Date.now() + ONLINE_ROUND_SECONDS * 1e3;
    const tick = () => {
      const left = Math.max(0, Math.ceil((app.deadline - Date.now()) / 1e3));
      $("timer").textContent = app.phase === "plan" ? `${left}s` : "";
      if (left === 0 && app.phase === "plan") {
        toast("Tiempo agotado: se env\xEDa lo que ten\xEDas planeado.");
        confirmPlan();
      }
    };
    tick();
    app.timerId = setInterval(tick, 500);
  }
  function stopTimer() {
    clearInterval(app.timerId);
    $("timer").textContent = "";
  }
  function enterGame(mode, me, state) {
    app.mode = mode;
    app.me = me;
    app.state = state;
    app.plan = [];
    app.tool = null;
    app.foeReady = false;
    app.phase = state.status === "over" ? "over" : "plan";
    closeSheet();
    show("game");
    render();
    if (mode === "online") startTimer();
  }
  function startBot(level, saved = null) {
    app.level = level;
    let state;
    if (saved) {
      try {
        state = replay(saved.seed, saved.history);
      } catch {
        storage.del(SAVE_KEY);
        state = null;
      }
    }
    state || (state = createGame(randomHex(8)));
    enterGame("bot", "A", state);
    if (!saved) storage.set(SAVE_KEY, { seed: state.seed, history: [], level });
  }
  function goHome() {
    closeSheet();
    stopTimer();
    try {
      app.net?.close?.();
    } catch {
    }
    app.session = null;
    app.net = null;
    app.state = null;
    app.mode = null;
    show("home");
    refreshHome();
  }
  function wireSession(session) {
    app.session = session;
    session.on("start", ({ state, role }) => enterGame("online", role, state)).on("foeCommitted", () => {
      app.foeReady = true;
      if (app.phase === "plan") render();
    }).on("round", ({ prev, state, actions }) => {
      app.foeReady = false;
      runReveal(prev, state, actions);
    }).on("ended", ({ winner, reason }) => {
      if (reason === "resign") showGameOver(winner, reason);
    }).on("resync", ({ state }) => {
      app.state = state;
      app.plan = [];
      app.foeReady = false;
      app.phase = state.status === "over" ? "over" : "plan";
      toast("Conexi\xF3n recuperada. Repite tu jugada de esta ronda.");
      render();
      startTimer();
    }).on("disconnected", () => {
      if (!app.state || app.phase === "over") return;
      toast("Conexi\xF3n perdida con el rival.");
      if (session.role === "B") reconnectGuest();
    }).on("error", ({ code, message }) => {
      const titles = { cheat: "Partida detenida", desync: "Partida detenida", version: "Versiones distintas" };
      openSheet(`<h2 id="sheet-title">${titles[code] || "Error de conexi\xF3n"}</h2><p>${esc(message)}</p>
        <div class="stack"><button class="btn" data-home>Volver al inicio</button></div>`, { locked: true });
      onSheet("[data-home]", goHome);
    });
  }
  async function reconnectGuest() {
    if (app.reconnecting || !app.net?.reconnect) return;
    app.reconnecting = true;
    for (let attempt = 1; attempt <= 10 && app.session; attempt++) {
      await new Promise((r) => setTimeout(r, 3e3));
      const t = app.net.reconnect();
      const opened = await new Promise((resolve) => {
        const to = setTimeout(() => resolve(false), 4e3);
        t.onOpen(() => {
          clearTimeout(to);
          resolve(true);
        });
      });
      if (opened) {
        app.session.attach(t);
        break;
      }
    }
    app.reconnecting = false;
  }
  function lobbySheet(code) {
    const url = `${location.origin}${location.pathname}?sala=${code}${DEV_BC ? "&dev=bc" : ""}`;
    openSheet(
      `<h2 id="sheet-title">Sala creada</h2><p>Comparte este c\xF3digo con tu rival. La partida empieza cuando se una.</p>
    <div class="code-box" aria-label="C\xF3digo de sala">${code}</div>
    <p id="lobby-status" role="status">Esperando a tu rival\u2026</p>
    <div class="stack"><button class="btn primary" data-share>Compartir enlace</button><button class="btn quiet" data-cancel>Cancelar</button></div>`,
      { locked: true }
    );
    onSheet("[data-share]", async () => {
      try {
        if (navigator.share) await navigator.share({ title: "Sembrado", text: `Juega conmigo. C\xF3digo: ${code}`, url });
        else {
          await navigator.clipboard.writeText(url);
          toast("Enlace copiado.");
        }
      } catch {
      }
    });
    onSheet("[data-cancel]", goHome);
  }
  function lobbyError(message) {
    const el = document.getElementById("lobby-status");
    if (el) {
      el.textContent = message;
      el.style.color = "var(--danger)";
    } else toast(message);
  }
  async function hostOnline() {
    const code = newRoomCode();
    lobbySheet(code);
    try {
      if (DEV_BC) {
        wireSession(new Session({ role: "A", transport: broadcastTransport(code, "A") }));
        return;
      }
      app.net = await hostRoom(code, {
        onTransport: (t) => app.session ? app.session.attach(t) : wireSession(new Session({ role: "A", transport: t })),
        onError: lobbyError
      });
    } catch (err) {
      lobbyError(err.message || String(err));
    }
  }
  function joinSheet(prefill = "") {
    openSheet(`<h2 id="sheet-title">Unirse a una sala</h2><p>Escribe el c\xF3digo de cinco letras que te ha pasado tu rival.</p>
    <input class="code-input" id="code-input" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="5" value="${esc(prefill)}" aria-label="C\xF3digo de sala" />
    <p id="join-status" role="status"></p>
    <div class="stack"><button class="btn primary" data-join>Unirse</button><button class="btn quiet" data-cancel>Cancelar</button></div>`);
    const input = $("code-input");
    input.addEventListener("input", () => input.value = normalizeRoomCode(input.value));
    input.addEventListener("keydown", (e) => e.key === "Enter" && doJoin());
    onSheet("[data-join]", doJoin);
    onSheet("[data-cancel]", closeSheet);
    async function doJoin() {
      const code = normalizeRoomCode(input.value);
      const status = $("join-status");
      if (code.length !== 5) {
        status.textContent = "El c\xF3digo tiene cinco caracteres.";
        status.style.color = "var(--danger)";
        return;
      }
      status.style.color = "";
      status.textContent = "Conectando\u2026";
      sheetLocked = true;
      try {
        if (DEV_BC) {
          wireSession(new Session({ role: "B", transport: broadcastTransport(code, "B") }));
          return;
        }
        app.net = await joinRoom(code, {
          onError: (m) => {
            status.textContent = m;
            status.style.color = "var(--danger)";
            sheetLocked = false;
          }
        });
        wireSession(new Session({ role: "B", transport: app.net.transport }));
      } catch (err) {
        status.textContent = err.message || String(err);
        status.style.color = "var(--danger)";
        sheetLocked = false;
      }
    }
  }
  function triangleSVG() {
    const node = (x, y, u) => `<g><circle cx="${x}" cy="${y}" r="26" fill="var(--${u})"/><text x="${x}" y="${y + 9}" text-anchor="middle" font-size="26" fill="#fff" font-family="'Segoe UI Symbol','Noto Sans Symbols 2','DejaVu Sans',sans-serif">${glyph(u)}</text>
     <text x="${x}" y="${y + 46}" text-anchor="middle" font-size="13" fill="var(--text-2)" font-family="Barlow, sans-serif">${UNITS[u].name}</text></g>`;
    const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text-2)" stroke-width="2" marker-end="url(#ah)"/>`;
    return `<svg class="triangle" viewBox="0 0 280 230" role="img" aria-label="Infanter\xEDa vence a caballer\xEDa, caballer\xEDa vence a arqueros, arqueros vencen a infanter\xEDa">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text-2)"/></marker></defs>
    ${arrow(118, 52, 62, 136)}${arrow(80, 168, 196, 168)}${arrow(218, 136, 162, 52)}
    ${node(140, 34, "inf")}${node(50, 160, "cab")}${node(230, 160, "arq")}
  </svg>`;
  }
  function openRules() {
    const units = UNIT_KEYS.map((u) => {
      const beats2 = UNITS[u].beats ? `Vence a ${UNITS[UNITS[u].beats].name.toLowerCase()}. ` : "";
      return `<li>${chipHTML(u)}<span><span class="t">${UNITS[u].name}</span><br><span class="d">${beats2}${UNITS[u].note}</span></span><span class="v">${UNITS[u].power}</span></li>`;
    }).join("");
    const blds = BUILDING_KEYS.map((k) => {
      const b = BUILDINGS[k];
      return `<li><span class="bglyph" style="font-size:22px;text-align:center">${b.glyph}</span><span><span class="t">${b.name}</span><br><span class="d">${b.note}</span></span><span class="v">${b.cost} ${glyph("peon")}</span></li>`;
    }).join("");
    openSheet(`<h2 id="sheet-title">C\xF3mo se juega</h2>
    <p>Cada ronda tienes ${ACTIONS_PER_ROUND} acciones. Tu rival y t\xFA orden\xE1is a la vez y nadie ve la jugada del otro hasta que los dos confirm\xE1is.</p>
    <h3>Unidades</h3>
    <p>El n\xFAmero es su fuerza base. Cada unidad militar vence a otra: la ventaja suma +${ADVANTAGE}, no gana sola.</p>
    ${triangleSVG()}
    <ul class="list">${units}</ul>
    <h3>D\xF3nde colocar</h3>
    <p>En tus casillas, para cambiar la guarnici\xF3n, o en las vecinas. La caballer\xEDa llega a dos casillas de distancia.</p>
    <h3>Combate</h3>
    <p>Atacante: base, ventaja, +${ARQ_STRIKE} si son arqueros y +1 por cada casilla tuya vecina al objetivo a partir de la segunda (flanqueo). Defensor: base, ventaja, +${INF_HOLD} si es infanter\xEDa, +${WALL_DEFENSE} con muralla, +${CAPITAL_DEFENSE} en la capital y +1 por cada casilla propia vecina a partir de la segunda (apoyo). El defensor gana los empates.</p>
    <p>Toca cualquier casilla ocupada para ver la cuenta exacta contra cada unidad.</p>
    <h3>Casillas negras</h3>
    <p>Si los dos envi\xE1is la misma unidad a la misma casilla en la misma ronda, se quema y nadie podr\xE1 ocuparla. Sirve para cerrar pasos. Las capitales no se queman.</p>
    <h3>Suministro</h3>
    <p>Al final de cada ronda, las casillas que no est\xE9n unidas a tu capital por casillas tuyas se pierden. Corta el territorio del rival por su punto m\xE1s estrecho.</p>
    <h3>Edificios</h3>
    <ul class="list">${blds}</ul>
    <h3>Refuerzos</h3>
    <p>Cada ronda: 1 pe\xF3n por cada ${CELLS_PER_PAWN} casillas (m\xEDnimo ${BASE_INCOME_MIN}), 1 soldado por cada ${CELLS_PER_SOLDIER} casillas, 1 soldado de tu capital (rota entre infanter\xEDa, caballer\xEDa y arqueros) y 1 de bot\xEDn si has capturado terreno rival.</p>
    <h3>Victoria</h3>
    <p>Toma la capital rival, controla el ${Math.round(DOMINATION_SHARE * 100)}% del tablero o ten m\xE1s puntos al acabar la ronda ${MAX_ROUNDS} (1 por casilla y 2 por edificio).</p>
    <div class="stack"><button class="btn" data-close>Entendido</button></div>`);
    onSheet("[data-close]", closeSheet);
  }
  function openGameMenu() {
    const online = app.mode === "online";
    openSheet(`<h2 id="sheet-title">Partida</h2>
    <p>${online ? "Si sales, la partida termina para los dos." : "La partida se guarda en este dispositivo."}</p>
    <div class="stack">
      <button class="btn" data-rules>C\xF3mo se juega</button>
      ${app.phase !== "over" ? '<button class="btn danger" data-resign>Rendirse</button>' : ""}
      <button class="btn quiet" data-home>${online ? "Salir" : "Guardar y salir"}</button>
    </div>`);
    onSheet("[data-rules]", openRules);
    onSheet("[data-home]", () => {
      if (online && app.phase !== "over") app.session?.resign();
      goHome();
    });
    onSheet("[data-resign]", () => {
      if (online) app.session.resign();
      else showGameOver(other(app.me), "resign");
    });
  }
  function refreshHome() {
    const saved = storage.get(SAVE_KEY);
    $("btn-continue").hidden = !(saved && Array.isArray(saved.history) && saved.history.length > 0);
  }
  for (const b of document.querySelectorAll(".seg [data-level]")) {
    b.addEventListener("click", () => {
      app.level = b.dataset.level;
      for (const o of document.querySelectorAll(".seg [data-level]")) o.setAttribute("aria-pressed", String(o === b));
    });
  }
  $("btn-bot").addEventListener("click", () => startBot(app.level));
  $("btn-continue").addEventListener("click", () => {
    const saved = storage.get(SAVE_KEY);
    if (saved) startBot(saved.level || "normal", saved);
  });
  $("btn-host").addEventListener("click", hostOnline);
  $("btn-join").addEventListener("click", () => joinSheet());
  $("btn-rules").addEventListener("click", openRules);
  $("btn-help").addEventListener("click", openRules);
  $("btn-menu").addEventListener("click", openGameMenu);
  var installEvent = null;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    $("btn-install").hidden = false;
  });
  $("btn-install").addEventListener("click", async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => null);
    installEvent = null;
    $("btn-install").hidden = true;
  });
  if ("serviceWorker" in navigator && location.protocol.startsWith("http") && !params.has("nosw")) {
    navigator.serviceWorker.register("sw.js").catch(() => {
    });
  }
  $("version").textContent = VERSION;
  refreshHome();
  if (params.get("sala")) joinSheet(normalizeRoomCode(params.get("sala")));
  globalThis.__sembrado = { app, capitalUnit, income };
})();
