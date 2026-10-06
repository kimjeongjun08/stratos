// STRATOS — hand-rolled WebSocket server (RFC 6455), zero dependencies.
//
// Why from scratch? It's the clearest way to show the "efficient use of
// user connections" the brief asked for:
//   • a single shared broadcast loop drives every client (no per-socket timers)
//   • binary frames are parsed without buffering whole messages when avoidable
//   • heartbeat ping/pong reaps dead sockets
//   • per-IP connection caps protect the box from a single abusive client
//
// Public protocol (JSON text frames):
//   server -> client: { type: 'hello'|'presence'|'metrics'|'signup', ... }
//   client -> server: { type: 'ping'|'cursor', ... }

import { createHash, randomBytes } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OPCODES = { continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa };

const WS_MAX_PER_IP = Number(process.env.WS_MAX_PER_IP ?? 8);
const HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS ?? 15000);

/** Compute the Sec-WebSocket-Accept response token. */
function acceptKey(key) {
  return createHash('sha1').update(key + GUID).digest('base64');
}

/** Encode a server->client frame. Server frames are never masked. */
function encodeFrame(data, opcode = OPCODES.text) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode; // FIN + opcode
  return Buffer.concat([header, payload]);
}

/**
 * A stateful frame decoder. Feed it raw TCP chunks; it emits complete
 * messages via callbacks. Handles fragmentation and masking.
 */
class FrameDecoder {
  constructor({ onMessage, onPing, onPong, onClose }) {
    this.buf = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = null;
    this.cb = { onMessage, onPing, onPong, onClose };
  }

  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    // Parse as many complete frames as the buffer currently holds.
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;

      if (len === 126) {
        if (this.buf.length < offset + 2) return;
        len = this.buf.readUInt16BE(offset);
        offset += 2;
      } else if (len === 127) {
        if (this.buf.length < offset + 8) return;
        len = Number(this.buf.readBigUInt64BE(offset));
        offset += 8;
      }

      let mask;
      if (masked) {
        if (this.buf.length < offset + 4) return;
        mask = this.buf.subarray(offset, offset + 4);
        offset += 4;
      }

      if (this.buf.length < offset + len) return; // wait for more data

      let payload = this.buf.subarray(offset, offset + len);
      if (masked) {
        const unmasked = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ mask[i & 3];
        payload = unmasked;
      }
      this.buf = this.buf.subarray(offset + len);

      this.#handleFrame(fin, opcode, payload);
    }
  }

  #handleFrame(fin, opcode, payload) {
    switch (opcode) {
      case OPCODES.close:
        this.cb.onClose?.(payload);
        break;
      case OPCODES.ping:
        this.cb.onPing?.(payload);
        break;
      case OPCODES.pong:
        this.cb.onPong?.(payload);
        break;
      case OPCODES.continuation:
        this.fragments.push(payload);
        if (fin) this.#flushFragments();
        break;
      case OPCODES.text:
      case OPCODES.binary:
        if (fin) {
          this.cb.onMessage?.(payload);
        } else {
          this.fragmentOpcode = opcode;
          this.fragments = [payload];
        }
        break;
    }
  }

  #flushFragments() {
    const full = Buffer.concat(this.fragments);
    this.fragments = [];
    this.fragmentOpcode = null;
    this.cb.onMessage?.(full);
  }
}

/** A single connected client. */
class Client {
  constructor(socket, ip) {
    this.id = randomBytes(6).toString('hex');
    this.socket = socket;
    this.ip = ip;
    this.alive = true;
    this.meta = {}; // e.g. live cursor position
    this.joinedAt = Date.now();
  }

  send(obj) {
    if (this.socket.writable) {
      this.socket.write(encodeFrame(JSON.stringify(obj)));
    }
  }

  ping() {
    if (this.socket.writable) this.socket.write(encodeFrame(Buffer.alloc(0), OPCODES.ping));
  }

  close() {
    try {
      this.socket.write(encodeFrame(Buffer.alloc(0), OPCODES.close));
      this.socket.end();
    } catch { /* already gone */ }
  }
}

/**
 * The hub owns every connection and the single shared broadcast loop.
 */
export class WebSocketHub {
  constructor() {
    this.clients = new Map();        // id -> Client
    this.perIp = new Map();          // ip -> count
    this.listeners = { message: [] };
    this.#startHeartbeat();
  }

  get size() { return this.clients.size; }

  onMessage(fn) { this.listeners.message.push(fn); }

  /** Handle an HTTP Upgrade request that asked for a WebSocket. */
  handleUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const ip = (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
    const count = this.perIp.get(ip) ?? 0;
    if (count >= WS_MAX_PER_IP) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
    );

    const client = new Client(socket, ip);
    this.clients.set(client.id, client);
    this.perIp.set(ip, count + 1);

    const decoder = new FrameDecoder({
      onMessage: (buf) => this.#onClientMessage(client, buf),
      onPing: () => socket.write(encodeFrame(Buffer.alloc(0), OPCODES.pong)),
      onPong: () => { client.alive = true; },
      onClose: () => this.#drop(client),
    });

    socket.on('data', (chunk) => {
      try { decoder.push(chunk); } catch { this.#drop(client); }
    });
    socket.on('error', () => this.#drop(client));
    socket.on('close', () => this.#drop(client));

    client.send({ type: 'hello', id: client.id, since: client.joinedAt });
    this.broadcastPresence();
  }

  #onClientMessage(client, buf) {
    let msg;
    try { msg = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (msg.type === 'cursor') {
      client.meta.cursor = { x: msg.x, y: msg.y };
    }
    for (const fn of this.listeners.message) fn(client, msg);
  }

  #drop(client) {
    if (!this.clients.has(client.id)) return;
    this.clients.delete(client.id);
    const n = (this.perIp.get(client.ip) ?? 1) - 1;
    if (n <= 0) this.perIp.delete(client.ip); else this.perIp.set(client.ip, n);
    try { client.socket.destroy(); } catch { /* noop */ }
    this.broadcastPresence();
  }

  /** One JSON string serialized once, written to every socket. */
  broadcast(obj) {
    const frame = encodeFrame(JSON.stringify(obj));
    for (const c of this.clients.values()) {
      if (c.socket.writable) c.socket.write(frame);
    }
  }

  broadcastPresence() {
    this.broadcast({ type: 'presence', count: this.clients.size });
  }

  #startHeartbeat() {
    this.heartbeat = setInterval(() => {
      for (const c of this.clients.values()) {
        if (!c.alive) { this.#drop(c); continue; }
        c.alive = false;
        c.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  stop() {
    clearInterval(this.heartbeat);
    for (const c of this.clients.values()) c.close();
  }
}

export default WebSocketHub;
