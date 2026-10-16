// PvP session over any message transport (WebRTC, BroadcastChannel, in-memory).
// No server decides anything: both peers run the same deterministic engine.
//
// Fairness:
//  - Seed: each peer commits to a random share, then reveals it. Nobody can pick the board.
//  - Rounds: commit (hash of moves + salt), then reveal once both commits are in.
//    Nobody can change their moves after seeing the rival's.
//  - Every revealed move is validated against the rules; every round both peers
//    compare a hash of the resulting state.

import { sha256, hashOf } from '../engine/sha256.js';
import { randomHex } from '../engine/rng.js';
import { VERSION, other } from '../engine/rules.js';
import { createGame, resolveRound, validateActions, stateHash, replay } from '../engine/game.js';

export class Session {
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
    this._myHashes = new Map();
    this._foeHashes = new Map();
    this._resetRound();
    this.attach(transport);
  }

  on(event, cb) {
    (this.listeners[event] ||= []).push(cb);
    return this;
  }

  emit(event, payload) {
    for (const cb of this.listeners[event] || []) cb(payload);
  }

  /** Attach a (new) transport. Used at start and when reconnecting. */
  attach(transport) {
    this.transport = transport;
    transport.onMessage((msg) => this._receive(msg));
    transport.onClose(() => this.emit('disconnected'));
    transport.onOpen(() => {
      this.emit('connected');
      if (this.state) {
        // Reconnection: the host re-sends the full history so the guest can rebuild.
        this._resetRound();
        if (this.role === 'A') this._send({ t: 'sync', seed: this.state.seed, history: this.state.history });
        this.emit('resync', { state: this.state });
      } else {
        this._send({ t: 'hello', v: VERSION, commit: sha256(this._seedShare + this._seedSalt) });
      }
    });
  }

  _resetRound() {
    this._mine = null; // { round, actions, salt }
    this._foeCommit = null; // { round, hash }
    this._foeReveal = null;
    this._sentReveal = false;
  }

  _send(msg) {
    try {
      this.transport.send(msg);
    } catch (err) {
      this.emit('error', { code: 'send', message: String(err?.message || err) });
    }
  }

  _fail(code, message) {
    this.over = true;
    this.emit('error', { code, message });
  }

  // ------------------------------------------------------------ public API

  /** Lock in this round's moves. Throws if they break the rules. */
  submit(actions) {
    if (!this.state || this.over) throw new Error('La partida no está activa');
    if (this._mine) throw new Error('Ya has confirmado esta ronda');
    const v = validateActions(this.state, this.role, actions);
    if (!v.ok) throw new Error(v.error);
    const round = this.state.round;
    const salt = randomHex(16);
    this._mine = { round, actions: structuredClone(actions), salt };
    this._send({ t: 'commit', round, hash: hashOf({ round, actions, salt }) });
    this.emit('committed', { round });
    this._maybeReveal();
  }

  resign() {
    if (this.over) return;
    this._send({ t: 'resign' });
    this.over = true;
    this.emit('ended', { winner: this.foe, reason: 'resign' });
  }

  get waitingForFoe() {
    return Boolean(this._mine && !this._foeReveal);
  }

  get foeCommitted() {
    return Boolean(this._foeCommit);
  }

  // ------------------------------------------------------------ protocol

  _receive(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'hello':
        if (msg.v !== VERSION) return this._fail('version', `El rival usa la versión ${msg.v} y tú la ${VERSION}`);
        this._foeSeedCommit = msg.commit;
        if (!this._sentSeedReveal) {
          this._sentSeedReveal = true;
          this._send({ t: 'seed', share: this._seedShare, salt: this._seedSalt });
        }
        break;

      case 'seed': {
        if (this.state) return;
        if (!this._foeSeedCommit || sha256(msg.share + msg.salt) !== this._foeSeedCommit) {
          return this._fail('cheat', 'La semilla del rival no coincide con su compromiso');
        }
        const shares = this.role === 'A' ? [this._seedShare, msg.share] : [msg.share, this._seedShare];
        const seed = sha256(shares.join(':')).slice(0, 16);
        this.state = createGame(seed);
        this.emit('start', { state: this.state, role: this.role });
        break;
      }

      case 'commit':
        if (!this.state || msg.round !== this.state.round) return;
        this._foeCommit = { round: msg.round, hash: msg.hash };
        this.emit('foeCommitted', { round: msg.round });
        this._maybeReveal();
        break;

      case 'reveal': {
        if (!this.state || !this._foeCommit || msg.round !== this.state.round) return;
        const expected = hashOf({ round: msg.round, actions: msg.actions, salt: msg.salt });
        if (expected !== this._foeCommit.hash) return this._fail('cheat', 'El rival cambió su jugada después de confirmarla');
        const v = validateActions(this.state, this.foe, msg.actions);
        if (!v.ok) return this._fail('cheat', `Jugada ilegal del rival: ${v.error}`);
        this._foeReveal = { actions: msg.actions };
        this._maybeResolve();
        break;
      }

      case 'state':
        // The rival may resolve before us, so keep its hash until ours exists.
        this._foeHashes.set(msg.round, msg.hash);
        this._checkHash(msg.round);
        break;

      case 'sync': {
        // Guest rebuilds the game from the host's history and checks it.
        if (this.role !== 'B') return;
        try {
          const rebuilt = replay(msg.seed, msg.history);
          this.state = rebuilt;
          this._resetRound();
          this.emit('resync', { state: this.state });
        } catch (err) {
          this._fail('cheat', `Historial inválido al reconectar: ${err.message}`);
        }
        break;
      }

      case 'resign':
        if (this.over) return;
        this.over = true;
        this.emit('ended', { winner: this.role, reason: 'resign' });
        break;

      default:
        break;
    }
  }

  _checkHash(round) {
    const mine = this._myHashes.get(round);
    const theirs = this._foeHashes.get(round);
    if (!mine || !theirs) return;
    if (mine !== theirs) this._fail('desync', 'Los dos tableros no coinciden. Partida detenida.');
    else this.emit('verified', { round });
  }

  _maybeReveal() {
    if (this._mine && this._foeCommit && !this._sentReveal) {
      this._sentReveal = true;
      this._send({ t: 'reveal', round: this._mine.round, actions: this._mine.actions, salt: this._mine.salt });
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
    this._send({ t: 'state', round, hash });
    this._checkHash(round);
    if (this.over) return;
    this._resetRound();
    this.emit('round', { prev, state: this.state, actions });
    if (this.state.status === 'over') {
      this.over = true;
      this.emit('ended', { winner: this.state.winner, reason: this.state.reason });
    }
  }
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I

export function newRoomCode(length = 5) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

export function normalizeRoomCode(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);
}
