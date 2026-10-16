// Message transports. All share one shape:
//   { send(msg), onMessage(cb), onOpen(cb), onClose(cb), close() }

const PEER_PREFIX = 'sembrado-001-';
const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';

function base() {
  const cbs = { message: [], open: [], close: [] };
  let opened = false;
  return {
    cbs,
    fire(kind, arg) {
      if (kind === 'open') opened = true;
      for (const cb of cbs[kind]) cb(arg);
    },
    api: {
      onMessage: (cb) => cbs.message.push(cb),
      // Late subscribers to an already-open transport still get the event.
      onOpen: (cb) => {
        cbs.open.push(cb);
        if (opened) queueMicrotask(cb);
      },
      onClose: (cb) => cbs.close.push(cb),
    },
  };
}

// ---------------------------------------------------------------- in-memory (tests)

export function loopbackPair() {
  const a = base();
  const b = base();
  let alive = true;
  const deliver = (target, msg) =>
    setTimeout(() => alive && target.fire('message', JSON.parse(JSON.stringify(msg))), 0);
  const ta = { ...a.api, send: (m) => deliver(b, m), close: () => { alive = false; a.fire('close'); b.fire('close'); } };
  const tb = { ...b.api, send: (m) => deliver(a, m), close: ta.close };
  setTimeout(() => {
    a.fire('open');
    b.fire('open');
  }, 0);
  return [ta, tb];
}

// ---------------------------------------------------------------- BroadcastChannel (two tabs, no internet)

export function broadcastTransport(code, role) {
  const t = base();
  const ch = new BroadcastChannel(`sembrado-${code}`);
  const me = `${role}-${Math.random().toString(36).slice(2)}`;
  let peer = null;

  ch.onmessage = (e) => {
    const { from, kind, msg } = e.data || {};
    if (!from || from === me) return;
    if (kind === 'join') {
      if (peer && peer !== from) return;
      const isNew = !peer;
      peer = from;
      ch.postMessage({ from: me, kind: 'join' });
      if (isNew) t.fire('open');
    } else if (kind === 'msg' && from === peer) {
      t.fire('message', msg);
    } else if (kind === 'leave' && from === peer) {
      peer = null;
      t.fire('close');
    }
  };
  ch.postMessage({ from: me, kind: 'join' });
  addEventListener('pagehide', () => ch.postMessage({ from: me, kind: 'leave' }));

  return {
    ...t.api,
    send: (msg) => ch.postMessage({ from: me, kind: 'msg', msg }),
    close: () => {
      ch.postMessage({ from: me, kind: 'leave' });
      ch.close();
    },
  };
}

// ---------------------------------------------------------------- WebRTC via PeerJS

let peerjsPromise = null;
function loadPeerJS() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  peerjsPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEERJS_URL;
    s.async = true;
    s.onload = () => (globalThis.Peer ? resolve(globalThis.Peer) : reject(new Error('PeerJS no se cargó')));
    s.onerror = () => {
      peerjsPromise = null;
      reject(new Error('No se pudo descargar PeerJS. Comprueba la conexión.'));
    };
    document.head.appendChild(s);
  });
  return peerjsPromise;
}

/** Optional ICE override, e.g. a TURN server for strict networks: window.SEMBRADO_ICE = [...] */
function peerOptions() {
  const ice = globalThis.SEMBRADO_ICE;
  return ice ? { config: { iceServers: ice } } : {};
}

function wrapConnection(conn, t) {
  conn.on('open', () => t.fire('open'));
  conn.on('data', (d) => t.fire('message', d));
  conn.on('close', () => t.fire('close'));
  conn.on('error', () => t.fire('close'));
}

/**
 * Host a room. Calls onTransport(transport) for each incoming connection
 * (the first one, and again after the guest reconnects).
 */
export async function hostRoom(code, { onTransport, onError }) {
  const Peer = await loadPeerJS();
  const peer = new Peer(PEER_PREFIX + code, peerOptions());
  let current = null;

  peer.on('connection', (conn) => {
    if (current) current.close?.();
    const t = base();
    const transport = { ...t.api, send: (m) => conn.send(m), close: () => conn.close() };
    current = conn;
    wrapConnection(conn, t);
    onTransport(transport);
  });
  peer.on('error', (err) => {
    const map = {
      'unavailable-id': 'Ese código de sala ya está en uso. Crea otro.',
      network: 'Sin conexión con el servidor de emparejamiento.',
      'server-error': 'El servidor de emparejamiento no responde.',
    };
    onError?.(map[err.type] || `Error de conexión (${err.type || 'desconocido'})`);
  });
  // Keep the room reachable if the signalling link drops (the P2P link may survive).
  peer.on('disconnected', () => {
    if (!peer.destroyed) peer.reconnect();
  });

  await new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', reject);
  });
  return { close: () => peer.destroy() };
}

/** Join a room as guest. Resolves with a transport once the data channel is open. */
export async function joinRoom(code, { onError } = {}) {
  const Peer = await loadPeerJS();
  const peer = new Peer(peerOptions());
  await new Promise((resolve, reject) => {
    peer.on('open', resolve);
    peer.on('error', reject);
  });
  peer.on('error', (err) => {
    const map = { 'peer-unavailable': 'No existe ninguna sala con ese código.' };
    onError?.(map[err.type] || `Error de conexión (${err.type || 'desconocido'})`);
  });

  const connect = () => {
    const t = base();
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
    wrapConnection(conn, t);
    return { ...t.api, send: (m) => conn.send(m), close: () => conn.close() };
  };

  return { transport: connect(), reconnect: connect, close: () => peer.destroy() };
}
