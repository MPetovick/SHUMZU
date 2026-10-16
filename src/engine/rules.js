// Game rules: units, buildings and the numbers behind them.
// Everything a player can read in the in-game legend comes from here.

export const VERSION = '0.0.1';
export const BOARD_SIZE = 8;
export const MAX_ROUNDS = 20;
export const ACTIONS_PER_ROUND = 3;
export const ROCKS = 6; // impassable terrain, placed with point symmetry

export const PLAYERS = ['A', 'B'];
export const other = (p) => (p === 'A' ? 'B' : 'A');

/**
 * Units. Military units form a triangle: each one beats the next.
 * The triangle is a bonus (ADVANTAGE), not an automatic win, so walls and
 * flanking can still change a fight. Lesson taken from Fire Emblem's weapon triangle.
 */
export const UNITS = {
  peon: { name: 'Peón', short: 'Peón', glyph: '♟', power: 1, beats: null, note: 'Barato. Expande y paga edificios.' },
  inf: { name: 'Infantería', short: 'Infant.', glyph: '♜', power: 2, beats: 'cab', note: '+1 al defender una casilla.' },
  cab: { name: 'Caballería', short: 'Caball.', glyph: '♞', power: 2, beats: 'arq', note: 'Llega a dos casillas de distancia.' },
  arq: { name: 'Arqueros', short: 'Arquer.', glyph: '♝', power: 2, beats: 'inf', note: '+1 al atacar.' },
};
export const UNIT_KEYS = Object.keys(UNITS);
export const MILITARY = ['inf', 'cab', 'arq'];

export const ADVANTAGE = 2; // bonus for the unit that wins the triangle
export const INF_HOLD = 1;
export const ARQ_STRIKE = 1;
export const CAPITAL_DEFENSE = 2;
export const FLANK_PER_CELL = 1; // attacker bonus per extra own neighbour of the target
export const FLANK_MAX = 2;
/** Support (Diplomacy): each friendly neighbour of a defended cell adds defence. */
export const SUPPORT_PER_CELL = 1;
export const SUPPORT_MAX = 2;

/** Buildings are built on your own cells and paid with pawns. */
export const BUILDINGS = {
  granja: { name: 'Granja', glyph: '❋', cost: 2, note: '+1 peón cada ronda.' },
  cuartel: { name: 'Cuartel', glyph: '⚑', cost: 3, note: '+1 unidad del tipo que guarnece la casilla cada ronda.' },
  muralla: { name: 'Muralla', glyph: '▦', cost: 3, note: '+2 a la defensa de la casilla.' },
};
export const BUILDING_KEYS = Object.keys(BUILDINGS);
export const WALL_DEFENSE = 2;

export const START_HAND = { peon: 4, inf: 2, cab: 2, arq: 2 };

/** Risk-style income: one pawn per three cells, never less than three. */
export const BASE_INCOME_MIN = 3;
export const CELLS_PER_PAWN = 3;
/** Momentum, like Risk reinforcements: every N cells also train one soldier per round. */
export const CELLS_PER_SOLDIER = 5;
export const CAPITAL_INCOME = { inf: 1 };

export function beats(a, b) {
  return Boolean(a && b && UNITS[a].beats === b);
}
