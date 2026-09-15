/* ==========================================================================
   BLOTTUKU — núcleo del juego
   ==========================================================================
   Tablero: 9 filas × 3 columnas, dígitos 0–8.

   Reglas:
     · Cada fila suma 12.
     · Cada columna es una permutación de 0–8 (sin repetir).

   Generación determinista (no falla nunca):
     Se toma una permutación p0 de 0–8, se define p1[i] = (p0[i] + 4) mod 9,
     y p2[i] = 12 − p0[i] − p1[i]. Barajar filas y columnas no rompe nada.

   Pistas:
     makePuzzle elige N celdas al azar como pistas iniciales. NO se exige
     solución única. La red de seguridad son los botones del cliente:
       · Ayuda → revela una celda vacía con su valor correcto.
       · Check → fija una celda correcta, o marca en rojo una incorrecta.
     La puntuación del cliente usa DIFICULTADES[diff].base.

   DIFICULTADES[diff] = { pistas, ayudas, checks, base }

   Dos representaciones:
     · "crudo":   [[0..8|null]]
     · "estado":  [[{ v, clue, notes }]]
   ========================================================================== */
'use strict';

var BLOTTUKU = (() => {
  const FILAS = 9;
  const COLS = 3;
  const PRESUPUESTO = 12;
  const TOTAL = FILAS * COLS;

  function baraja(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function barajado(a) { return baraja(a.slice()); }

  const vacia = v => v === null || v === undefined;
  function clave(r, c) { return r + ',' + c; }

  /* ------------------------------------------------------------------ */
  /* Generación                                                          */
  /* ------------------------------------------------------------------ */
  function tablero() {
    const p0 = barajado([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const p1 = p0.map(v => (v + 4) % 9);
    const p2 = p0.map((v, i) => PRESUPUESTO - v - p1[i]);

    const rows = new Array(FILAS);
    for (let i = 0; i < FILAS; i++) rows[i] = [p0[i], p1[i], p2[i]];

    baraja(rows);
    const co = barajado([0, 1, 2]);
    return rows.map(row => [row[co[0]], row[co[1]], row[co[2]]]);
  }

  function validar(grid) {
    if (!Array.isArray(grid) || grid.length !== FILAS) return false;
    for (let r = 0; r < FILAS; r++) {
      const row = grid[r];
      if (!Array.isArray(row) || row.length !== COLS) return false;
      let s = 0;
      for (let c = 0; c < COLS; c++) {
        const v = row[c];
        if (!Number.isInteger(v) || v < 0 || v > 8) return false;
        s += v;
      }
      if (s !== PRESUPUESTO) return false;
    }
    for (let c = 0; c < COLS; c++) {
      const visto = new Set();
      for (let r = 0; r < FILAS; r++) {
        const v = grid[r][c];
        if (visto.has(v)) return false;
        visto.add(v);
      }
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Adaptadores                                                         */
  /* ------------------------------------------------------------------ */
  function crudoAEstado(crudo, clues) {
    return crudo.map((row, r) => row.map((v, c) => {
      const esClue = clues ? clues.has(clave(r, c)) : false;
      return { v: esClue ? v : null, clue: esClue, notes: new Set() };
    }));
  }
  function estadoACrudo(estado) {
    return estado.map(row => row.map(cell => cell.v));
  }

  /* ------------------------------------------------------------------ */
  /* Solver (utilidad; no se usa para generar)                           */
  /* ------------------------------------------------------------------ */
  const MAX_PASOS = 80000;

  function _puedeCrudo(g, r, c, d) {
    for (let rr = 0; rr < FILAS; rr++)
      if (rr !== r && g[rr][c] === d) return false;
    let conocidos = 0, huecos = 0;
    for (let cc = 0; cc < COLS; cc++) {
      if (cc === c) continue;
      const v = g[r][cc];
      if (vacia(v)) huecos++;
      else conocidos += v;
    }
    const queda = PRESUPUESTO - conocidos - d;
    if (huecos === 0) return queda === 0;
    return queda >= 0 && queda <= 8 * huecos;
  }

  function contarSoluciones(crudo, limite, maxPasos) {
    limite = limite || 2;
    maxPasos = maxPasos || MAX_PASOS;
    const g = crudo.map(row => row.slice());

    const vacias = [];
    for (let r = 0; r < FILAS; r++)
      for (let c = 0; c < COLS; c++)
        if (vacia(g[r][c])) {
          let nc = 0;
          for (let d = 0; d <= 8; d++) if (_puedeCrudo(g, r, c, d)) nc++;
          vacias.push([r, c, nc]);
        }
    vacias.sort((a, b) => a[2] - b[2]);

    let n = 0, pasos = 0, primera = null, agotado = false;
    function back(idx) {
      if (n >= limite) return;
      if (pasos >= maxPasos) { agotado = true; return; }
      if (idx === vacias.length) {
        n++;
        if (!primera) primera = g.map(row => row.slice());
        return;
      }
      const [r, c] = vacias[idx];
      for (let d = 0; d <= 8; d++) {
        pasos++;
        if (!_puedeCrudo(g, r, c, d)) continue;
        g[r][c] = d;
        back(idx + 1);
        g[r][c] = null;
        if (n >= limite || agotado) return;
      }
    }
    back(0);
    return { n, primera, agotado };
  }

  function esUnica(crudo) {
    const r = contarSoluciones(crudo, 2);
    return r.n === 1 && !r.agotado;
  }

  /* ------------------------------------------------------------------ */
  /* Dificultades                                                        */
  /* ------------------------------------------------------------------ */
  /*   pistas   → celdas reveladas al empezar
      ayudas    → usos del botón Ayuda
      checks    → usos del botón Check
      base      → puntuación máxima teórica del nivel (sin asistencias)  */
  const DIFICULTADES = Object.freeze({
    facil:   Object.freeze({ pistas: 14, ayudas: 4, checks: 4, base: 1000 }),
    medio:   Object.freeze({ pistas: 10, ayudas: 3, checks: 3, base: 1500 }),
    dificil: Object.freeze({ pistas:  7, ayudas: 2, checks: 3, base: 2200 }),
    experto: Object.freeze({ pistas:  5, ayudas: 1, checks: 2, base: 3200 })
  });

  /* ------------------------------------------------------------------ */
  /* makePuzzle                                                          */
  /* ------------------------------------------------------------------ */
  function makePuzzle(diff) {
    if (!DIFICULTADES[diff]) diff = 'medio';
    const objetivo = DIFICULTADES[diff].pistas;
    const solucion = tablero();

    const posiciones = [];
    for (let r = 0; r < FILAS; r++)
      for (let c = 0; c < COLS; c++)
        posiciones.push([r, c]);
    baraja(posiciones);

    const clues = new Set();
    for (let i = 0; i < objetivo; i++) {
      const [r, c] = posiciones[i];
      clues.add(clave(r, c));
    }
    return { solucion, clues, dificultad: diff, pistas: clues.size };
  }

  /* ------------------------------------------------------------------ */
  /* Reglas de celda                                                     */
  /* ------------------------------------------------------------------ */
  function columna(grid, c) {
    const s = new Set();
    for (let r = 0; r < FILAS; r++) {
      const v = grid[r][c].v;
      if (!vacia(v)) s.add(v);
    }
    return s;
  }

  function sumaFila(grid, r) {
    let suma = 0, huecos = 0;
    for (let c = 0; c < COLS; c++) {
      const v = grid[r][c].v;
      if (vacia(v)) huecos++;
      else suma += v;
    }
    return { suma, huecos };
  }

  function puedeIr(grid, r, c, d) {
    if (d < 0 || d > 8) return false;
    for (let rr = 0; rr < FILAS; rr++) {
      if (rr === r) continue;
      if (grid[rr][c].v === d) return false;
    }
    let conocidos = 0, huecos = 0;
    for (let cc = 0; cc < COLS; cc++) {
      if (cc === c) continue;
      const v = grid[r][cc].v;
      if (vacia(v)) huecos++;
      else conocidos += v;
    }
    const queda = PRESUPUESTO - conocidos - d;
    if (huecos === 0) return queda === 0;
    return queda >= 0 && queda <= 8 * huecos;
  }

  function candidatos(grid, r, c) {
    const out = [];
    for (let d = 0; d <= 8; d++) if (puedeIr(grid, r, c, d)) out.push(d);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Estado del tablero                                                  */
  /* ------------------------------------------------------------------ */
  function llena(grid) {
    for (let r = 0; r < FILAS; r++)
      for (let c = 0; c < COLS; c++)
        if (vacia(grid[r][c].v)) return false;
    return true;
  }

  function resuelto(grid) {
    for (let r = 0; r < FILAS; r++) {
      let s = 0;
      for (let c = 0; c < COLS; c++) {
        const v = grid[r][c].v;
        if (vacia(v)) return false;
        s += v;
      }
      if (s !== PRESUPUESTO) return false;
    }
    for (let c = 0; c < COLS; c++) {
      const visto = new Set();
      for (let r = 0; r < FILAS; r++) {
        const v = grid[r][c].v;
        if (visto.has(v)) return false;
        visto.add(v);
      }
    }
    return true;
  }

  function conflictos(grid, ultimo) {
    const set = new Set();
    for (let c = 0; c < COLS; c++) {
      const porValor = Object.create(null);
      for (let r = 0; r < FILAS; r++) {
        const v = grid[r][c].v;
        if (vacia(v)) continue;
        if (porValor[v] !== undefined) {
          set.add(clave(r, c));
          set.add(clave(porValor[v], c));
        } else porValor[v] = r;
      }
    }
    for (let r = 0; r < FILAS; r++) {
      let s = 0, llenaFila = true;
      for (let c = 0; c < COLS; c++) {
        const v = grid[r][c].v;
        if (vacia(v)) { llenaFila = false; break; }
        s += v;
      }
      if (s > PRESUPUESTO || (llenaFila && s !== PRESUPUESTO)) {
        if (ultimo && ultimo.r === r) set.add(clave(ultimo.r, ultimo.c));
      }
    }
    return set;
  }

  function globalCounts(grid) {
    const counts = new Array(9).fill(0);
    for (let r = 0; r < FILAS; r++)
      for (let c = 0; c < COLS; c++) {
        const v = grid[r][c].v;
        if (!vacia(v)) counts[v]++;
      }
    return counts;
  }

  /* ------------------------------------------------------------------ */
  /* Análisis para el botón «ayuda»                                      */
  /* ------------------------------------------------------------------ */
  function explicar(grid, r, c) {
    const enCol = new Set();
    for (let rr = 0; rr < FILAS; rr++) {
      if (rr === r) continue;
      const v = grid[rr][c].v;
      if (!vacia(v)) enCol.add(v);
    }
    if (enCol.size === 8) return { clave: 'col' };

    const { suma, huecos } = sumaFila(grid, r);
    if (huecos === 1) return { clave: 'row', suma, queda: PRESUPUESTO - suma };

    if (candidatos(grid, r, c).length === 1) return { clave: 'only' };
    return { clave: 'deduce' };
  }

  /* ------------------------------------------------------------------ */
  /* Códigos de 3 cifras                                                 */
  /* ------------------------------------------------------------------ */
  function valida(code) {
    const t = String(code || '');
    if (!/^\d{3}$/.test(t)) return false;
    return (+t[0]) + (+t[1]) + (+t[2]) === PRESUPUESTO;
  }

  function legales() {
    const o = [];
    for (let a = 0; a <= 9; a++)
      for (let b = 0; b <= 9; b++) {
        const c = PRESUPUESTO - a - b;
        if (c >= 0 && c <= 9) o.push('' + a + b + c);
      }
    return o;
  }

  function cifras(code) {
    const t = String(code || '');
    return [+t[0], +t[1], +t[2]];
  }

  function resuelve(mia, suya) {
    if (!valida(mia) || !valida(suya)) return null;
    const a = cifras(mia), b = cifras(suya);
    const frentes = [];
    let yo = 0, el = 0;
    for (let i = 0; i < COLS; i++) {
      const g = a[i] > b[i] ? 1 : (a[i] < b[i] ? -1 : 0);
      frentes.push(g);
      if (g > 0) yo++; else if (g < 0) el++;
    }
    return { frentes, yo, el, gana: yo > el ? 1 : (el > yo ? -1 : 0) };
  }

  const FAMILIAS = Object.freeze([
    Object.freeze({ id: 'reparte', nombre: 'Repartido',           tope: 5, desc: 'ningún frente pasa de cinco' }),
    Object.freeze({ id: 'fuerte',  nombre: 'Con un frente fuerte', tope: 7, desc: 'seis o siete en uno' }),
    Object.freeze({ id: 'todo',    nombre: 'Todo a un frente',     tope: 9, desc: 'ocho o nueve, y renuncias al resto' })
  ]);

  function familia(code) {
    if (!valida(code)) return null;
    const m = Math.max(...cifras(code));
    for (const f of FAMILIAS) if (m <= f.tope) return f.id;
    return null;
  }

  function porFamilia() {
    const peso = k => {
      const c = cifras(k).slice().sort((a, b) => b - a);
      return c[0] * 100 + c[1] * 10 + c[2];
    };
    const grupos = FAMILIAS.map(f => ({ familia: f, codigos: [] }));
    for (const k of legales()) {
      const id = familia(k);
      const g = grupos.find(x => x.familia.id === id);
      if (g) g.codigos.push(k);
    }
    for (const g of grupos)
      g.codigos.sort((a, b) => peso(a) - peso(b) || a.localeCompare(b));
    return grupos;
  }

  /* ------------------------------------------------------------------ */
  /* Tests internos                                                      */
  /* ------------------------------------------------------------------ */
  function _selfTest() {
    for (let i = 0; i < 40; i++)
      if (!validar(tablero())) throw new Error('tablero() inválido');

    if (legales().length !== 73) throw new Error('legales() != 73');

    const sol = tablero();
    const soloUna = new Set([clave(0, 0)]);
    const est = crudoAEstado(sol, soloUna);
    if (est[0][0].v !== sol[0][0] || !est[0][0].clue)
      throw new Error('crudoAEstado: pista mal');
    if (est[5][2].v !== null || est[5][2].clue)
      throw new Error('crudoAEstado: no-pista mal');

    const todas = new Set();
    for (let r = 0; r < FILAS; r++)
      for (let c = 0; c < COLS; c++) todas.add(clave(r, c));
    const completa = crudoAEstado(sol, todas);
    if (!resuelto(completa)) throw new Error('resuelto no acepta solución');
    for (let r = 0; r < FILAS; r++)
      for (let c = 0; c < COLS; c++)
        if (!puedeIr(completa, r, c, sol[r][c]))
          throw new Error('puedeIr rechaza solución');

    for (const diff of ['facil', 'medio', 'dificil', 'experto']) {
      const d = DIFICULTADES[diff];
      if (typeof d.checks !== 'number' || d.checks < 0)
        throw new Error('DIFICULTADES["' + diff + '"].checks inválido');
      if (typeof d.ayudas !== 'number' || d.ayudas < 0)
        throw new Error('DIFICULTADES["' + diff + '"].ayudas inválido');
      if (typeof d.base !== 'number' || d.base < 0)
        throw new Error('DIFICULTADES["' + diff + '"].base inválido');
      const p = makePuzzle(diff);
      if (p.pistas !== d.pistas)
        throw new Error('makePuzzle("' + diff + '") dio ' + p.pistas + ' pistas');
      if (p.clues.size !== d.pistas)
        throw new Error('makePuzzle("' + diff + '") clues mal');
      if (!validar(p.solucion))
        throw new Error('makePuzzle("' + diff + '") solución inválida');
    }

    return true;
  }

  return {
    FILAS, COLS, PRESUPUESTO, TOTAL,
    DIFICULTADES, FAMILIAS,
    clave,
    tablero, validar, makePuzzle,
    crudoAEstado, estadoACrudo,
    contarSoluciones, esUnica,
    columna, sumaFila, puedeIr, candidatos, globalCounts,
    llena, resuelto, conflictos, explicar,
    valida, legales, cifras, resuelve, familia, porFamilia,
    _selfTest
  };
})();
