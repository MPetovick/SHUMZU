// Balance simulator. Plays many games between bot policies and prints the results.
// Usage: npm run sim            (300 games per pairing)
//        node tools/simulate.mjs 100
// Change numbers in src/engine/rules.js, run this, compare.

import { createGame, resolveRound } from '../src/engine/game.js';
import { botActions, randomActions } from '../src/engine/bot.js';

const GAMES = Number(process.argv[2]) || 300;
const policies = {
  normal: (s, p) => botActions(s, p),
  facil: (s, p) => botActions(s, p, { level: 'facil' }),
  azar: (s, p) => randomActions(s, p),
};

function run(a, b) {
  const wins = { A: 0, B: 0, empate: 0 };
  const reasons = {};
  const rounds = [];
  let black = 0;
  let captures = 0;
  let cutoffs = 0;
  let builds = 0;
  for (let g = 0; g < GAMES; g++) {
    let s = createGame(`sim-${g}`);
    while (s.status === 'playing') {
      s = resolveRound(s, { A: policies[a](s, 'A'), B: policies[b](s, 'B') });
      for (const e of s.lastEvents) {
        if (e.kind === 'black') black++;
        if (e.kind === 'capture') captures++;
        if (e.kind === 'cutoff') cutoffs++;
        if (e.kind === 'build') builds++;
      }
    }
    wins[s.winner ?? 'empate']++;
    reasons[s.reason] = (reasons[s.reason] || 0) + 1;
    rounds.push(s.history.length);
  }
  rounds.sort((x, y) => x - y);
  const per = (n) => (n / GAMES).toFixed(1);
  console.log(
    `${a} (A) contra ${b} (B):`,
    wins,
    reasons,
    `| rondas (mediana) ${rounds[GAMES >> 1]} | por partida: negras ${per(black)}, capturas ${per(captures)}, cortes ${per(cutoffs)}, edificios ${per(builds)}`
  );
}

run('normal', 'normal');
run('normal', 'facil');
run('facil', 'azar');
run('azar', 'normal');
