import {
  VERSION,
  UNITS,
  UNIT_KEYS,
  MILITARY,
  BUILDINGS,
  BUILDING_KEYS,
  ACTIONS_PER_ROUND,
  MAX_ROUNDS,
  ADVANTAGE,
  INF_HOLD,
  ARQ_STRIKE,
  CAPITAL_DEFENSE,
  WALL_DEFENSE,
  CELLS_PER_PAWN,
  CELLS_PER_SOLDIER,
  BASE_INCOME_MIN,
  other,
} from '../engine/rules.js';
import {
  createGame,
  resolveRound,
  replay,
  reachable,
  buildable,
  validateActions,
  cellsOf,
  playableCount,
  xy,
  orthogonal,
  explainAttack,
  explainDefense,
  income,
  capitalUnit,
  DOMINATION_SHARE,
} from '../engine/game.js';
import { botActions } from '../engine/bot.js';
import { randomHex } from '../engine/rng.js';
import { Session, newRoomCode, normalizeRoomCode } from '../net/session.js';
import { hostRoom, joinRoom, broadcastTransport } from '../net/transports.js';

const ONLINE_ROUND_SECONDS = 60;
const SAVE_KEY = 'sembrado.bot.v1';
const params = new URLSearchParams(location.search);
const DEV_BC = params.get('dev') === 'bc'; // two tabs on one device, no internet needed

const $ = (id) => document.getElementById(id);
const VS = '︎'; // force text (not emoji) presentation for chess glyphs
const glyph = (u) => UNITS[u].glyph + VS;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const app = {
  mode: null, // 'bot' | 'online'
  me: 'A',
  level: 'normal',
  state: null,
  plan: [],
  tool: null, // { kind: 'unit', unit } | { kind: 'build', building }
  phase: 'plan', // 'plan' | 'waiting' | 'reveal' | 'over'
  session: null,
  net: null,
  foeReady: false,
  deadline: 0,
  timerId: null,
  reconnecting: false,
};

// ---------------------------------------------------------------- small helpers

const storage = {
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
      /* private mode: the game still works, it just won't resume */
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

const buzz = (ms = 8) => navigator.vibrate?.(ms);

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Viewer-relative coordinates: each player sees its own capital bottom-left, like chess. */
function viewIndex(i) {
  return app.me === 'A' ? i : 63 - i;
}
function coordName(i) {
  const v = viewIndex(i);
  const [x, y] = xy(v);
  return `${'abcdefgh'[x]}${8 - y}`;
}

function show(screen) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === `screen-${screen}`);
}

// ---------------------------------------------------------------- sheets

let sheetLocked = false;
function openSheet(html, { locked = false } = {}) {
  sheetLocked = locked;
  $('sheet-body').innerHTML = html;
  $('scrim').classList.add('open');
  $('sheet').classList.add('open');
  const first = $('sheet').querySelector('button, input');
  setTimeout(() => first?.focus({ preventScroll: true }), 50);
}
function closeSheet() {
  sheetLocked = false;
  $('scrim').classList.remove('open');
  $('sheet').classList.remove('open');
}
$('scrim').addEventListener('click', () => !sheetLocked && closeSheet());
document.addEventListener('keydown', (e) => e.key === 'Escape' && !sheetLocked && closeSheet());

function onSheet(selector, handler) {
  for (const el of $('sheet-body').querySelectorAll(selector)) el.addEventListener('click', handler);
}

// ---------------------------------------------------------------- plan bookkeeping

function usedByPlan(plan = app.plan) {
  const used = { peon: 0, inf: 0, cab: 0, arq: 0 };
  for (const a of plan) {
    if (a.type === 'place') used[a.unit] += 1;
    else used.peon += BUILDINGS[a.building].cost;
  }
  return used;
}

function remaining(unit) {
  return app.state.hands[app.me][unit] - usedByPlan()[unit];
}

function targets() {
  if (!app.tool || app.phase !== 'plan') return new Set();
  const planned = new Set(app.plan.map((a) => a.cell));
  const base = app.tool.kind === 'unit' ? reachable(app.state, app.me, app.tool.unit) : buildable(app.state, app.me);
  return new Set([...base].filter((i) => !planned.has(i)));
}

// ---------------------------------------------------------------- rendering

function chipHTML(unit) {
  return `<span class="chip ${unit}" aria-hidden="true">${glyph(unit)}</span>`;
}

function renderBoard({ revealActions = null } = {}) {
  const s = app.state;
  const t = targets();
  const toolColor = app.tool?.kind === 'unit' ? `var(--${app.tool.unit})` : 'var(--mine)';
  const board = $('board');
  board.style.setProperty('--tool', toolColor);

  const order = [...Array(64).keys()].map((v) => viewIndex(v));
  const planByCell = new Map(app.plan.map((a, k) => [a.cell, { ...a, n: k + 1 }]));

  board.replaceChildren(
    ...order.map((i) => {
      const c = s.cells[i];
      const el = document.createElement('button');
      el.className = 'cell';
      el.dataset.i = i;
      el.setAttribute('role', 'gridcell');

      const side = c.owner === app.me ? 'mine' : c.owner ? 'foe' : 'neutral';
      if (c.rock) el.classList.add('rock');
      else if (c.blocked) el.classList.add('blocked');
      else el.classList.add(side);
      if (t.has(i)) el.classList.add('target');

      let html = '';
      if (c.unit) html += chipHTML(c.unit);
      if (c.capital) html += `<span class="badge cap" aria-hidden="true">♛${VS}</span>`;
      if (c.building) html += `<span class="badge bld" aria-hidden="true">${BUILDINGS[c.building].glyph}</span>`;

      const plan = planByCell.get(i);
      if (plan) {
        const inner = plan.type === 'place' ? chipHTML(plan.unit) : `<span class="bglyph">${BUILDINGS[plan.building].glyph}</span>`;
        html += `<span class="plan">${inner}<span class="n">${plan.n}</span></span>`;
      }

      if (revealActions) {
        for (const p of ['A', 'B']) {
          const a = revealActions[p].find((x) => x.cell === i);
          if (a && a.type === 'place') html += `<span class="reveal-chip ${p === app.me ? 'my-move' : 'foe-move'}">${chipHTML(a.unit)}</span>`;
        }
      }

      const v = viewIndex(i);
      const [vx, vy] = xy(v);
      if (vx === 0 || vy === 7) {
        const label = vy === 7 && vx === 0 ? 'a1' : vy === 7 ? 'abcdefgh'[vx] : String(8 - vy);
        html += `<span class="coord">${label}</span>`;
      }
      el.innerHTML = html;
      el.setAttribute('aria-label', describeCell(i, plan));
      return el;
    })
  );
}

function describeCell(i, plan) {
  const c = app.state.cells[i];
  const name = coordName(i);
  if (c.rock) return `${name}, roca`;
  if (c.blocked) return `${name}, casilla negra`;
  const who = c.owner === app.me ? 'tuya' : c.owner ? 'del rival' : 'libre';
  let text = `${name}, ${who}`;
  if (c.unit) text += `, ${UNITS[c.unit].name}`;
  if (c.capital) text += ', capital';
  if (c.building) text += `, ${BUILDINGS[c.building].name}`;
  if (plan) text += plan.type === 'place' ? `, planeado ${UNITS[plan.unit].name}` : `, planeado ${BUILDINGS[plan.building].name}`;
  return text;
}

function renderTray() {
  const tray = $('tray');
  const disabled = app.phase !== 'plan';
  const tools = UNIT_KEYS.map((u) => {
    const n = remaining(u);
    const pressed = app.tool?.kind === 'unit' && app.tool.unit === u;
    return `<button class="tool" data-unit="${u}" style="--tool: var(--${u})" aria-pressed="${pressed}" ${disabled || n <= 0 ? 'disabled' : ''} aria-label="${UNITS[u].name}, quedan ${n}">
      <span class="top">${chipHTML(u)}<span class="count">${n}</span></span><span class="label">${UNITS[u].short}</span></button>`;
  });
  const buildPressed = app.tool?.kind === 'build';
  const buildGlyph = buildPressed ? BUILDINGS[app.tool.building].glyph : '⌂';
  tools.push(`<button class="tool" data-build aria-pressed="${buildPressed}" ${disabled ? 'disabled' : ''} aria-label="Construir">
    <span class="top"><span class="bglyph" aria-hidden="true">${buildGlyph}</span></span><span class="label">${buildPressed ? BUILDINGS[app.tool.building].name : 'Construir'}</span></button>`);
  tray.innerHTML = tools.join('');

  for (const b of tray.querySelectorAll('[data-unit]')) {
    b.addEventListener('click', () => {
      const u = b.dataset.unit;
      app.tool = app.tool?.kind === 'unit' && app.tool.unit === u ? null : { kind: 'unit', unit: u };
      buzz(5);
      render();
    });
  }
  tray.querySelector('[data-build]').addEventListener('click', () => (buildPressed ? ((app.tool = null), render()) : openBuildSheet()));
}

function renderStatus() {
  const s = app.state;
  const mine = cellsOf(s, app.me).length;
  const foe = cellsOf(s, other(app.me)).length;
  const total = playableCount(s);
  $('round-label').innerHTML = `Ronda ${Math.min(s.round, MAX_ROUNDS)} <small>de ${MAX_ROUNDS}</small>`;
  $('cells-me').textContent = mine;
  $('cells-foe').textContent = foe;
  const goal = Math.round(DOMINATION_SHARE * 100);
  $('share-me').textContent = `${Math.round((mine / total) * 100)}% de ${goal}%`;
  $('share-foe').textContent = `${Math.round((foe / total) * 100)}% de ${goal}%`;
  $('foe-name').textContent = app.mode === 'bot' ? `Bot ${app.level === 'facil' ? 'fácil' : 'normal'}` : 'Rival';
  $('me-income').textContent = s.status === 'playing' ? `Refuerzos previstos ${gainText(income(s, app.me))}` : '';

  const phaseText = { plan: 'Planifica', waiting: 'Esperando', reveal: 'Revelando', over: 'Terminada' }[app.phase];
  $('phase').dataset.phase = app.phase;
  $('phase-text').textContent = phaseText;

  const fs = $('foe-status');
  if (app.mode === 'online' && (app.phase === 'plan' || app.phase === 'waiting')) {
    fs.textContent = app.foeReady ? 'Ya ha confirmado' : 'Está planificando';
    fs.classList.toggle('ready', app.foeReady);
  } else {
    fs.textContent = app.mode === 'bot' ? 'Decide sin ver tu jugada' : '';
    fs.classList.remove('ready');
  }

  $('pips').innerHTML = Array.from({ length: ACTIONS_PER_ROUND }, (_, k) => `<span class="${k < app.plan.length ? 'used' : ''}"></span>`).join('');
  $('pips').setAttribute('aria-label', `${app.plan.length} de ${ACTIONS_PER_ROUND} acciones`);

  const confirm = $('btn-confirm');
  confirm.disabled = app.phase !== 'plan';
  confirm.textContent = {
    waiting: 'Jugada enviada',
    reveal: 'Revelando',
    over: 'Partida terminada',
    plan: app.plan.length ? 'Confirmar jugada' : 'Pasar ronda',
  }[app.phase];
}

function setHint(text, isError = false) {
  const h = $('hint');
  h.textContent = text;
  h.classList.toggle('error', isError);
}

function defaultHint() {
  if (app.phase === 'waiting') return 'Tu jugada está cerrada. Se revela cuando confirme tu rival.';
  if (app.phase !== 'plan') return '';
  if (app.plan.length >= ACTIONS_PER_ROUND) return 'Tienes tus 3 órdenes. Toca una para quitarla.';
  if (!app.tool) return 'Elige una unidad y toca una casilla resaltada.';
  if (app.tool.kind === 'unit') return `${UNITS[app.tool.unit].name}. ${UNITS[app.tool.unit].note}`;
  const b = BUILDINGS[app.tool.building];
  return `${b.name} (${b.cost} peones): ${b.note} Toca una casilla tuya.`;
}

function orthogonalOwners(i) {
  return new Set(orthogonal(i).map((n) => app.state.cells[n].owner).filter(Boolean));
}

/** One line per planned order, with the expected result against the current board. */
function describeOrder(a) {
  const s = app.state;
  const c = s.cells[a.cell];
  const at = coordName(a.cell);
  if (a.type === 'build') return { title: `Construir ${BUILDINGS[a.building].name.toLowerCase()} en ${at}`, detail: `Cuesta ${BUILDINGS[a.building].cost} peones. ${BUILDINGS[a.building].note}` };
  const name = UNITS[a.unit].name.toLowerCase();
  if (c.owner === app.me) {
    const was = UNITS[c.unit].name.toLowerCase();
    return { title: `Cambiar guarnición de ${at} a ${name}`, detail: `La ${was} vuelve a tu reserva.` };
  }
  if (!c.owner) {
    const contested = orthogonalOwners(a.cell).has(other(app.me));
    return { title: `Ocupar ${at} con ${name}`, detail: contested ? 'Al lado del rival: puede disputarla.' : '' };
  }
  const atk = sum(explainAttack(s, app.me, a.unit, c.unit, a.cell));
  const def = sum(explainDefense(s, c.unit, a.unit, a.cell));
  const wins = atk > def;
  return {
    title: `Atacar ${at} con ${name}`,
    detail: `<span class="${wins ? 'good' : 'bad'}">${atk} contra ${def}: ${wins ? 'la tomas si no cambia su guarnición' : 'no basta'}</span>`,
  };
}

function renderOrders() {
  const list = $('orders');
  if (app.phase !== 'plan' && app.phase !== 'waiting') {
    list.innerHTML = '';
    return;
  }
  if (!app.plan.length) {
    list.innerHTML = `<li class="empty">${app.phase === 'plan' ? 'Tus órdenes aparecerán aquí. El rival no las verá hasta que confirméis los dos.' : ''}</li>`;
    return;
  }
  list.innerHTML = app.plan
    .map((a, k) => {
      const d = describeOrder(a);
      const icon = a.type === 'place' ? chipHTML(a.unit) : `<span class="bglyph">${BUILDINGS[a.building].glyph}</span>`;
      const removable = app.phase === 'plan';
      return `<li data-k="${k}" ${removable ? 'role="button" tabindex="0" aria-label="Quitar orden ' + (k + 1) + '"' : ''}><span class="n">${k + 1}</span>${icon}<span class="t">${d.title}${d.detail ? `<small>${d.detail}</small>` : ''}</span><span class="x" aria-hidden="true">${removable ? '✕' : ''}</span></li>`;
    })
    .join('');
  if (app.phase === 'plan') {
    for (const li of list.querySelectorAll('[data-k]')) {
      const remove = () => {
        app.plan.splice(Number(li.dataset.k), 1);
        buzz(5);
        render();
      };
      li.addEventListener('click', remove);
      li.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), remove()));
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

// ---------------------------------------------------------------- planning

$('board').addEventListener('click', (e) => {
  const el = e.target.closest('.cell');
  if (!el || !app.state) return;
  const i = Number(el.dataset.i);
  const c = app.state.cells[i];
  if (c.rock) return;

  if (app.phase === 'plan') {
    const k = app.plan.findIndex((a) => a.cell === i);
    if (k >= 0) {
      app.plan.splice(k, 1);
      buzz(5);
      render();
      return;
    }
    if (app.tool && targets().has(i)) {
      if (app.plan.length >= ACTIONS_PER_ROUND) return setHint('Ya usas tus 3 acciones esta ronda.', true);
      const action = app.tool.kind === 'unit' ? { type: 'place', cell: i, unit: app.tool.unit } : { type: 'build', cell: i, building: app.tool.building };
      const v = validateActions(app.state, app.me, [...app.plan, action]);
      if (!v.ok) return setHint(v.error, true);
      app.plan.push(action);
      buzz(10);
      if (app.tool.kind === 'unit' && remaining(app.tool.unit) <= 0) app.tool = null;
      if (app.tool?.kind === 'build') app.tool = null;
      render();
      return;
    }
  }
  openCellSheet(i);
});

function openBuildSheet() {
  const pawns = remaining('peon');
  const items = BUILDING_KEYS.map((k) => {
    const b = BUILDINGS[k];
    const ok = pawns >= b.cost;
    return `<li class="pick" data-b="${k}" role="button" tabindex="0" aria-disabled="${!ok}">
      <span class="bglyph" style="font-size:24px;text-align:center">${b.glyph}</span>
      <span><span class="t">${b.name}</span><br><span class="d">${b.note}</span></span>
      <span class="v">${b.cost} ${glyph('peon')}</span></li>`;
  }).join('');
  openSheet(`<h2 id="sheet-title">Construir</h2>
    <p>Los edificios se levantan en casillas tuyas (no en la capital) y se pagan con peones. Si pierdes la casilla, se pierde el edificio.</p>
    <ul class="list">${items}</ul>
    <div class="stack"><button class="btn quiet" data-close>Cancelar</button></div>`);
  onSheet('[data-close]', closeSheet);
  onSheet('[data-b]', (e) => {
    const li = e.currentTarget;
    if (li.getAttribute('aria-disabled') === 'true') return;
    app.tool = { kind: 'build', building: li.dataset.b };
    closeSheet();
    render();
  });
}

function sum(o) {
  return Object.values(o).reduce((a, b) => a + b, 0);
}

function breakdown(parts, labels) {
  return Object.entries(parts)
    .filter(([, v]) => v)
    .map(([k, v]) => `${labels[k]} ${v}`)
    .join(', ');
}

const ATT_LABELS = { base: 'base', advantage: 'ventaja', strike: 'arqueros', flank: 'flanqueo' };
const DEF_LABELS = { base: 'base', advantage: 'ventaja', hold: 'infantería', wall: 'muralla', capital: 'capital', support: 'apoyo' };

function openCellSheet(i) {
  const s = app.state;
  const c = s.cells[i];
  const name = coordName(i);
  if (c.blocked) {
    openSheet(`<h2 id="sheet-title">${name}: casilla negra</h2><p>Los dos jugadores enviaron aquí la misma unidad en la misma ronda. Nadie podrá ocuparla.</p>
      <div class="stack"><button class="btn" data-close>Cerrar</button></div>`);
    return onSheet('[data-close]', closeSheet);
  }

  const who = c.owner === app.me ? 'Tuya' : c.owner ? 'Del rival' : 'Libre';
  let body = `<h2 id="sheet-title">${name}: ${who.toLowerCase()}</h2>`;
  const facts = [];
  if (c.unit) facts.push(`${UNITS[c.unit].name} de guarnición`);
  if (c.capital) facts.push('capital');
  if (c.building) facts.push(`${BUILDINGS[c.building].name.toLowerCase()}`);
  body += `<p>${facts.length ? facts.join(', ').replace(/^./, (m) => m.toUpperCase()) + '.' : 'Sin unidades.'}</p>`;

  if (c.owner && c.unit) {
    const attacker = other(c.owner);
    const rows = UNIT_KEYS.map((u) => {
      const at = explainAttack(s, attacker, u, c.unit, i);
      const df = explainDefense(s, c.unit, u, i);
      const a = sum(at);
      const d = sum(df);
      const wins = a > d;
      const verdict = c.owner === app.me ? (wins ? 'La tomaría' : 'Resistes') : wins ? 'La tomas' : 'No basta';
      return `<li>${chipHTML(u)}<span><span class="t">${UNITS[u].name}: ${a} contra ${d}</span><br>
        <span class="d">Ataque: ${breakdown(at, ATT_LABELS)}. Defensa: ${breakdown(df, DEF_LABELS)}.</span></span>
        <span class="v" style="color:${wins === (c.owner !== app.me) ? 'var(--ok)' : 'var(--danger)'}">${verdict}</span></li>`;
    }).join('');
    body += `<h3>${c.owner === app.me ? 'Si el rival ataca con' : 'Si atacas con'}</h3>
      <p>El defensor gana los empates. Calculado con el tablero actual; si el dueño cambia la guarnición esta ronda, el resultado cambia.</p>
      <ul class="list">${rows}</ul>`;
  } else if (!c.owner) {
    body += '<p>Quien la ocupe primero se la queda. Si los dos enviáis una unidad a la vez, gana la más fuerte; con la misma unidad, se vuelve negra.</p>';
  }
  body += '<div class="stack"><button class="btn" data-close>Cerrar</button></div>';
  openSheet(body);
  onSheet('[data-close]', closeSheet);
}

// ---------------------------------------------------------------- rounds

$('btn-confirm').addEventListener('click', confirmPlan);

function confirmPlan() {
  if (app.phase !== 'plan') return;
  const v = validateActions(app.state, app.me, app.plan);
  if (!v.ok) return setHint(v.error, true);
  buzz(15);
  app.tool = null;

  if (app.mode === 'bot') {
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
      app.phase = 'waiting';
      stopTimer();
      render();
    } catch (err) {
      setHint(err.message, true);
    }
  }
}

function runReveal(prev, next, actions) {
  app.phase = 'reveal';
  app.plan = [];
  app.state = prev;
  render({ revealActions: actions });

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(
    () => {
      app.state = next;
      app.phase = next.status === 'over' ? 'over' : 'plan';
      render();
      const evCells = next.lastEvents.filter((e) => Number.isInteger(e.cell));
      evCells.forEach((e, k) => {
        const el = $('board').querySelector(`[data-i="${e.cell}"]`);
        if (!el) return;
        el.style.setProperty('--delay', `${k * 0.06}s`);
        el.classList.add('flash');
        if (e.kind === 'black') el.classList.add('ev-black');
      });
      if (next.lastEvents.some((e) => e.kind === 'black')) buzz([20, 40, 20]);
      setTimeout(() => afterReveal(next), reduce ? 0 : 500 + evCells.length * 60);
    },
    reduce ? 0 : 1100
  );
}

function afterReveal(state) {
  if (state.status === 'over') return showGameOver(state.winner, state.reason);
  const report = roundReport(state.lastEvents);
  if (report.important) {
    openSheet(`<h2 id="sheet-title">Ronda ${state.round - 1}</h2><ul class="list">${report.html}</ul>
      <div class="stack"><button class="btn primary" data-close>Siguiente ronda</button></div>`);
    onSheet('[data-close]', closeSheet);
  } else if (report.summary) {
    toast(report.summary);
  }
  if (app.mode === 'online') startTimer();
}

function gainText(gain) {
  return UNIT_KEYS.filter((u) => gain[u])
    .map((u) => `+${gain[u]} ${glyph(u)}`)
    .join('  ');
}

function roundReport(events) {
  const me = app.me;
  const rows = [];
  let important = false;
  let summary = '';
  const pw = (e) => (e.power ? ` (${e.power[0]} contra ${e.power[1]})` : '');
  const row = (unit, title, detail = '', tone = '') =>
    rows.push(`<li>${unit ? chipHTML(unit) : '<span></span>'}<span><span class="t">${title}</span>${detail ? `<br><span class="d">${detail}</span>` : ''}</span><span class="v" style="color:${tone}">${tone ? '●' : ''}</span></li>`);

  for (const e of events) {
    const at = Number.isInteger(e.cell) ? coordName(e.cell) : '';
    const mine = e.by === me;
    switch (e.kind) {
      case 'conquer':
        if (e.vs) {
          important = true;
          row(e.unit, mine ? `Ganas el choque en ${at}` : `El rival gana el choque en ${at}`, `${UNITS[e.unit].name} contra ${UNITS[e.vs].name}${pw(e)}`, mine ? 'var(--ok)' : 'var(--danger)');
        }
        break;
      case 'capture':
        important = true;
        row(e.unit, mine ? `Tomas ${at}` : `Pierdes ${at}`, `${UNITS[e.unit].name} contra ${UNITS[e.vs].name}${pw(e)}`, mine ? 'var(--ok)' : 'var(--danger)');
        break;
      case 'repel':
        important = true;
        row(e.unit, mine ? `Tu ataque en ${at} no basta` : `Resistes en ${at}`, `${UNITS[e.unit].name} contra ${UNITS[e.vs].name}${pw(e)}. El defensor gana los empates.`, mine ? 'var(--danger)' : 'var(--ok)');
        break;
      case 'hold':
        important = true;
        row(e.unit, mine ? `Aguantas ${at}` : `El rival aguanta ${at}`, e.note === 'capital' ? 'Misma unidad en una capital: el defensor la conserva.' : `${UNITS[e.unit].name} contra ${UNITS[e.vs].name}${pw(e)}`, mine ? 'var(--ok)' : 'var(--danger)');
        break;
      case 'black':
        important = true;
        row(e.unit, `${at} se quema`, `Los dos enviasteis ${UNITS[e.unit].name.toLowerCase()}. Nadie podrá ocuparla.`, '#000');
        break;
      case 'bounce':
        important = true;
        row(null, `Choque sin vencedor en ${at}`, `Misma fuerza${pw(e)}. La casilla sigue libre.`);
        break;
      case 'cutoff':
        important = true;
        row(e.unit, mine ? `Pierdes ${at} por suministro` : `El rival pierde ${at} por suministro`, 'Quedó desconectada de su capital.', mine ? 'var(--danger)' : 'var(--ok)');
        break;
      case 'build':
        if (mine) row(null, `Construyes ${BUILDINGS[e.building].name.toLowerCase()} en ${at}`);
        else {
          important = true;
          row(null, `El rival construye ${BUILDINGS[e.building].name.toLowerCase()} en ${at}`);
        }
        break;
      case 'build-lost':
        if (mine) {
          important = true;
          row(null, `Tu ${BUILDINGS[e.building].name.toLowerCase()} en ${at} no se construyó`, 'Perdiste la casilla en esta ronda.', 'var(--danger)');
        }
        break;
      case 'loot':
        if (mine) row(e.unit, `Botín: +1 ${UNITS[e.unit].name.toLowerCase()}`, 'Por capturar terreno del rival.', 'var(--ok)');
        break;
      case 'income':
        if (mine) {
          summary = `Refuerzos: ${gainText(e.gain)}`;
          row(null, 'Refuerzos', gainText(e.gain));
        }
        break;
      default:
        break;
    }
  }
  return { important, html: rows.join(''), summary };
}

const REASONS = {
  capital: (w) => (w === app.me ? 'Has tomado la capital rival.' : 'El rival ha tomado tu capital.'),
  capitals: () => 'Las dos capitales cayeron en la misma ronda. Decidieron los puntos.',
  domination: (w) => (w === app.me ? `Controlas el ${Math.round(DOMINATION_SHARE * 100)}% del tablero.` : `El rival controla el ${Math.round(DOMINATION_SHARE * 100)}% del tablero.`),
  rounds: () => `Se acabaron las ${MAX_ROUNDS} rondas. Gana quien tiene más puntos: casillas, más 2 por edificio.`,
  resign: (w) => (w === app.me ? 'Tu rival se ha rendido.' : 'Te has rendido.'),
};

function showGameOver(winner, reason) {
  app.phase = 'over';
  stopTimer();
  if (app.mode === 'bot') storage.del(SAVE_KEY);
  render();
  const title = winner === null ? 'Empate' : winner === app.me ? 'Victoria' : 'Derrota';
  const s = app.state;
  openSheet(
    `<p class="result${winner === app.me ? ' win' : ''}" id="sheet-title">${title}</p><p>${REASONS[reason]?.(winner) ?? ''}</p>
    <ul class="list">
      <li><span></span><span class="t">Tus casillas</span><span class="v">${cellsOf(s, app.me).length}</span></li>
      <li><span></span><span class="t">Casillas del rival</span><span class="v">${cellsOf(s, other(app.me)).length}</span></li>
      <li><span></span><span class="t">Rondas jugadas</span><span class="v">${s.history.length}</span></li>
    </ul>
    <div class="stack">
      ${app.mode === 'bot' ? '<button class="btn primary" data-again>Jugar otra vez</button>' : ''}
      <button class="btn" data-home>Volver al inicio</button>
    </div>`,
    { locked: true }
  );
  onSheet('[data-again]', () => {
    closeSheet();
    startBot(app.level);
  });
  onSheet('[data-home]', goHome);
}

// ---------------------------------------------------------------- timer (online)

function startTimer() {
  stopTimer();
  app.deadline = Date.now() + ONLINE_ROUND_SECONDS * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((app.deadline - Date.now()) / 1000));
    $('timer').textContent = app.phase === 'plan' ? `${left}s` : '';
    if (left === 0 && app.phase === 'plan') {
      toast('Tiempo agotado: se envía lo que tenías planeado.');
      confirmPlan();
    }
  };
  tick();
  app.timerId = setInterval(tick, 500);
}
function stopTimer() {
  clearInterval(app.timerId);
  $('timer').textContent = '';
}

// ---------------------------------------------------------------- modes

function enterGame(mode, me, state) {
  app.mode = mode;
  app.me = me;
  app.state = state;
  app.plan = [];
  app.tool = null;
  app.foeReady = false;
  app.phase = state.status === 'over' ? 'over' : 'plan';
  closeSheet();
  show('game');
  render();
  if (mode === 'online') startTimer();
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
  state ||= createGame(randomHex(8));
  enterGame('bot', 'A', state);
  if (!saved) storage.set(SAVE_KEY, { seed: state.seed, history: [], level });
}

function goHome() {
  closeSheet();
  stopTimer();
  try {
    app.net?.close?.();
  } catch {
    /* ignore */
  }
  app.session = null;
  app.net = null;
  app.state = null;
  app.mode = null;
  show('home');
  refreshHome();
}

function wireSession(session) {
  app.session = session;
  session
    .on('start', ({ state, role }) => enterGame('online', role, state))
    .on('foeCommitted', () => {
      app.foeReady = true;
      if (app.phase === 'plan') render();
    })
    .on('round', ({ prev, state, actions }) => {
      app.foeReady = false;
      runReveal(prev, state, actions);
    })
    .on('ended', ({ winner, reason }) => {
      if (reason === 'resign') showGameOver(winner, reason);
    })
    .on('resync', ({ state }) => {
      app.state = state;
      app.plan = [];
      app.foeReady = false;
      app.phase = state.status === 'over' ? 'over' : 'plan';
      toast('Conexión recuperada. Repite tu jugada de esta ronda.');
      render();
      startTimer();
    })
    .on('disconnected', () => {
      if (!app.state || app.phase === 'over') return;
      toast('Conexión perdida con el rival.');
      if (session.role === 'B') reconnectGuest();
    })
    .on('error', ({ code, message }) => {
      const titles = { cheat: 'Partida detenida', desync: 'Partida detenida', version: 'Versiones distintas' };
      openSheet(`<h2 id="sheet-title">${titles[code] || 'Error de conexión'}</h2><p>${esc(message)}</p>
        <div class="stack"><button class="btn" data-home>Volver al inicio</button></div>`, { locked: true });
      onSheet('[data-home]', goHome);
    });
}

async function reconnectGuest() {
  if (app.reconnecting || !app.net?.reconnect) return;
  app.reconnecting = true;
  for (let attempt = 1; attempt <= 10 && app.session; attempt++) {
    await new Promise((r) => setTimeout(r, 3000));
    const t = app.net.reconnect();
    const opened = await new Promise((resolve) => {
      const to = setTimeout(() => resolve(false), 4000);
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
  const url = `${location.origin}${location.pathname}?sala=${code}${DEV_BC ? '&dev=bc' : ''}`;
  openSheet(
    `<h2 id="sheet-title">Sala creada</h2><p>Comparte este código con tu rival. La partida empieza cuando se una.</p>
    <div class="code-box" aria-label="Código de sala">${code}</div>
    <p id="lobby-status" role="status">Esperando a tu rival…</p>
    <div class="stack"><button class="btn primary" data-share>Compartir enlace</button><button class="btn quiet" data-cancel>Cancelar</button></div>`,
    { locked: true }
  );
  onSheet('[data-share]', async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Sembrado', text: `Juega conmigo. Código: ${code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Enlace copiado.');
      }
    } catch {
      /* user cancelled share */
    }
  });
  onSheet('[data-cancel]', goHome);
}

function lobbyError(message) {
  const el = document.getElementById('lobby-status');
  if (el) {
    el.textContent = message;
    el.style.color = 'var(--danger)';
  } else toast(message);
}

async function hostOnline() {
  const code = newRoomCode();
  lobbySheet(code);
  try {
    if (DEV_BC) {
      wireSession(new Session({ role: 'A', transport: broadcastTransport(code, 'A') }));
      return;
    }
    app.net = await hostRoom(code, {
      onTransport: (t) => (app.session ? app.session.attach(t) : wireSession(new Session({ role: 'A', transport: t }))),
      onError: lobbyError,
    });
  } catch (err) {
    lobbyError(err.message || String(err));
  }
}

function joinSheet(prefill = '') {
  openSheet(`<h2 id="sheet-title">Unirse a una sala</h2><p>Escribe el código de cinco letras que te ha pasado tu rival.</p>
    <input class="code-input" id="code-input" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="5" value="${esc(prefill)}" aria-label="Código de sala" />
    <p id="join-status" role="status"></p>
    <div class="stack"><button class="btn primary" data-join>Unirse</button><button class="btn quiet" data-cancel>Cancelar</button></div>`);
  const input = $('code-input');
  input.addEventListener('input', () => (input.value = normalizeRoomCode(input.value)));
  input.addEventListener('keydown', (e) => e.key === 'Enter' && doJoin());
  onSheet('[data-join]', doJoin);
  onSheet('[data-cancel]', closeSheet);

  async function doJoin() {
    const code = normalizeRoomCode(input.value);
    const status = $('join-status');
    if (code.length !== 5) {
      status.textContent = 'El código tiene cinco caracteres.';
      status.style.color = 'var(--danger)';
      return;
    }
    status.style.color = '';
    status.textContent = 'Conectando…';
    sheetLocked = true;
    try {
      if (DEV_BC) {
        wireSession(new Session({ role: 'B', transport: broadcastTransport(code, 'B') }));
        return;
      }
      app.net = await joinRoom(code, {
        onError: (m) => {
          status.textContent = m;
          status.style.color = 'var(--danger)';
          sheetLocked = false;
        },
      });
      wireSession(new Session({ role: 'B', transport: app.net.transport }));
    } catch (err) {
      status.textContent = err.message || String(err);
      status.style.color = 'var(--danger)';
      sheetLocked = false;
    }
  }
}

// ---------------------------------------------------------------- legend and rules

function triangleSVG() {
  // inf beats cab, cab beats arq, arq beats inf.
  const node = (x, y, u) =>
    `<g><circle cx="${x}" cy="${y}" r="26" fill="var(--${u})"/><text x="${x}" y="${y + 9}" text-anchor="middle" font-size="26" fill="#fff" font-family="'Segoe UI Symbol','Noto Sans Symbols 2','DejaVu Sans',sans-serif">${glyph(u)}</text>
     <text x="${x}" y="${y + 46}" text-anchor="middle" font-size="13" fill="var(--text-2)" font-family="Barlow, sans-serif">${UNITS[u].name}</text></g>`;
  const arrow = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text-2)" stroke-width="2" marker-end="url(#ah)"/>`;
  return `<svg class="triangle" viewBox="0 0 280 230" role="img" aria-label="Infantería vence a caballería, caballería vence a arqueros, arqueros vencen a infantería">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--text-2)"/></marker></defs>
    ${arrow(118, 52, 62, 136)}${arrow(80, 168, 196, 168)}${arrow(218, 136, 162, 52)}
    ${node(140, 34, 'inf')}${node(50, 160, 'cab')}${node(230, 160, 'arq')}
  </svg>`;
}

function openRules() {
  const units = UNIT_KEYS.map((u) => {
    const beats = UNITS[u].beats ? `Vence a ${UNITS[UNITS[u].beats].name.toLowerCase()}. ` : '';
    return `<li>${chipHTML(u)}<span><span class="t">${UNITS[u].name}</span><br><span class="d">${beats}${UNITS[u].note}</span></span><span class="v">${UNITS[u].power}</span></li>`;
  }).join('');
  const blds = BUILDING_KEYS.map((k) => {
    const b = BUILDINGS[k];
    return `<li><span class="bglyph" style="font-size:22px;text-align:center">${b.glyph}</span><span><span class="t">${b.name}</span><br><span class="d">${b.note}</span></span><span class="v">${b.cost} ${glyph('peon')}</span></li>`;
  }).join('');
  openSheet(`<h2 id="sheet-title">Cómo se juega</h2>
    <p>Cada ronda tienes ${ACTIONS_PER_ROUND} acciones. Tu rival y tú ordenáis a la vez y nadie ve la jugada del otro hasta que los dos confirmáis.</p>
    <h3>Unidades</h3>
    <p>El número es su fuerza base. Cada unidad militar vence a otra: la ventaja suma +${ADVANTAGE}, no gana sola.</p>
    ${triangleSVG()}
    <ul class="list">${units}</ul>
    <h3>Dónde colocar</h3>
    <p>En tus casillas, para cambiar la guarnición, o en las vecinas. La caballería llega a dos casillas de distancia.</p>
    <h3>Combate</h3>
    <p>Atacante: base, ventaja, +${ARQ_STRIKE} si son arqueros y +1 por cada casilla tuya vecina al objetivo a partir de la segunda (flanqueo). Defensor: base, ventaja, +${INF_HOLD} si es infantería, +${WALL_DEFENSE} con muralla, +${CAPITAL_DEFENSE} en la capital y +1 por cada casilla propia vecina a partir de la segunda (apoyo). El defensor gana los empates.</p>
    <p>Toca cualquier casilla ocupada para ver la cuenta exacta contra cada unidad.</p>
    <h3>Casillas negras</h3>
    <p>Si los dos enviáis la misma unidad a la misma casilla en la misma ronda, se quema y nadie podrá ocuparla. Sirve para cerrar pasos. Las capitales no se queman.</p>
    <h3>Suministro</h3>
    <p>Al final de cada ronda, las casillas que no estén unidas a tu capital por casillas tuyas se pierden. Corta el territorio del rival por su punto más estrecho.</p>
    <h3>Edificios</h3>
    <ul class="list">${blds}</ul>
    <h3>Refuerzos</h3>
    <p>Cada ronda: 1 peón por cada ${CELLS_PER_PAWN} casillas (mínimo ${BASE_INCOME_MIN}), 1 soldado por cada ${CELLS_PER_SOLDIER} casillas, 1 soldado de tu capital (rota entre infantería, caballería y arqueros) y 1 de botín si has capturado terreno rival.</p>
    <h3>Victoria</h3>
    <p>Toma la capital rival, controla el ${Math.round(DOMINATION_SHARE * 100)}% del tablero o ten más puntos al acabar la ronda ${MAX_ROUNDS} (1 por casilla y 2 por edificio).</p>
    <div class="stack"><button class="btn" data-close>Entendido</button></div>`);
  onSheet('[data-close]', closeSheet);
}

function openGameMenu() {
  const online = app.mode === 'online';
  openSheet(`<h2 id="sheet-title">Partida</h2>
    <p>${online ? 'Si sales, la partida termina para los dos.' : 'La partida se guarda en este dispositivo.'}</p>
    <div class="stack">
      <button class="btn" data-rules>Cómo se juega</button>
      ${app.phase !== 'over' ? '<button class="btn danger" data-resign>Rendirse</button>' : ''}
      <button class="btn quiet" data-home>${online ? 'Salir' : 'Guardar y salir'}</button>
    </div>`);
  onSheet('[data-rules]', openRules);
  onSheet('[data-home]', () => {
    if (online && app.phase !== 'over') app.session?.resign();
    goHome();
  });
  onSheet('[data-resign]', () => {
    if (online) app.session.resign();
    else showGameOver(other(app.me), 'resign');
  });
}

// ---------------------------------------------------------------- home

function refreshHome() {
  const saved = storage.get(SAVE_KEY);
  $('btn-continue').hidden = !(saved && Array.isArray(saved.history) && saved.history.length > 0);
}

for (const b of document.querySelectorAll('.seg [data-level]')) {
  b.addEventListener('click', () => {
    app.level = b.dataset.level;
    for (const o of document.querySelectorAll('.seg [data-level]')) o.setAttribute('aria-pressed', String(o === b));
  });
}

$('btn-bot').addEventListener('click', () => startBot(app.level));
$('btn-continue').addEventListener('click', () => {
  const saved = storage.get(SAVE_KEY);
  if (saved) startBot(saved.level || 'normal', saved);
});
$('btn-host').addEventListener('click', hostOnline);
$('btn-join').addEventListener('click', () => joinSheet());
$('btn-rules').addEventListener('click', openRules);
$('btn-help').addEventListener('click', openRules);
$('btn-menu').addEventListener('click', openGameMenu);

let installEvent = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $('btn-install').hidden = false;
});
$('btn-install').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => null);
  installEvent = null;
  $('btn-install').hidden = true;
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !params.has('nosw')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

$('version').textContent = VERSION;
refreshHome();
if (params.get('sala')) joinSheet(normalizeRoomCode(params.get('sala')));

// Exposed for automated checks only.
globalThis.__sembrado = { app, capitalUnit, income };
