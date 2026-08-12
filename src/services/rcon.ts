// ---- Obsidian Panel: RCON client ----
//
// Persistent connection per (host, port): Minecraft logs every RCON
// connect/disconnect ("Thread RCON Client started/stopped") into the console
// and latest.log. By reusing ONE TCP connection per server instead of opening
// a fresh socket for every request, that log spam is eliminated at the source.
//
// Requests are correlated by request id (the Source RCON protocol supports
// multiple in-flight requests over a single connection).

import net from "node:net";

const DEFAULT_TIMEOUT_MS = 5000;
/** Close idle connections after 5 minutes without traffic. */
const IDLE_CLEANUP_MS = 5 * 60_000;

interface PendingRequest {
  resolve: (value: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface RconConnection {
  key: string;
  host: string;
  port: number;
  password: string;
  socket: net.Socket | null;
  authed: boolean;
  connecting: boolean;
  /** Partial packet data while parsing the stream. */
  buffer: Buffer;
  /** In-flight requests by id. */
  pending: Map<number, PendingRequest>;
  /** Requests waiting while the connection is being established. */
  waiters: Array<() => void>;
  nextId: number;
  lastUsed: number;
}

const connections = new Map<string, RconConnection>();

function keyOf(host: string, port: number): string {
  return `${host}:${port}`;
}

function getConnection(host: string, port: number, password: string): RconConnection {
  const key = keyOf(host, port);
  let conn = connections.get(key);
  if (!conn) {
    conn = {
      key, host, port, password,
      socket: null, authed: false, connecting: false,
      buffer: Buffer.alloc(0), pending: new Map(), waiters: [],
      nextId: 1, lastUsed: Date.now(),
    };
    connections.set(key, conn);
  }
  return conn;
}

function writePacket(socket: net.Socket, id: number, type: number, payload: string): void {
  const body = Buffer.from(payload, "utf8");
  const len = 10 + body.length;
  const pkt = Buffer.alloc(len + 4);
  pkt.writeInt32LE(len, 0);
  pkt.writeInt32LE(id, 4);
  pkt.writeInt32LE(type, 8);
  body.copy(pkt, 12);
  pkt.writeInt8(0, 12 + body.length);
  pkt.writeInt8(0, 13 + body.length);
  socket.write(pkt);
}

function failPending(conn: RconConnection, err: Error): void {
  for (const [, req] of conn.pending) {
    clearTimeout(req.timer);
    req.reject(err);
  }
  conn.pending.clear();
}

/** Parse RCON packets from the stream and resolve matching in-flight requests. */
function onData(conn: RconConnection, chunk: Buffer): void {
  conn.buffer = Buffer.concat([conn.buffer, chunk]);
  while (conn.buffer.length >= 4) {
    const len = conn.buffer.readInt32LE(0);
    if (conn.buffer.length < 4 + len) break;

    const id = conn.buffer.readInt32LE(4);
    const type = conn.buffer.readInt32LE(8);
    const payload = conn.buffer.slice(12, 4 + len - 2).toString("utf8");
    conn.buffer = conn.buffer.subarray(4 + len);

    const req = conn.pending.get(id);
    if (!req) continue; // auth for an already-rejected request, or stale packet
    clearTimeout(req.timer);
    conn.pending.delete(id);
    conn.lastUsed = Date.now();

    if (id === -1) {
      req.reject(new Error("RCON authentication failed. Check password."));
      continue;
    }
    // type 2 = SERVERDATA_RESPONSE_VALUE, type 0 = auth response. The payload
    // is the command reply in both cases.
    req.resolve(payload.trim());
  }
}

/**
 * Make sure the connection is open and authenticated. Multiple callers during
 * the connect/auth phase wait on the same in-flight handshake.
 */
function ensureReady(conn: RconConnection, timeoutMs: number): Promise<void> {
  if (conn.socket && conn.authed && conn.socket.writable) {
    return Promise.resolve();
  }
  if (conn.connecting) {
    return new Promise((resolve) => conn.waiters.push(resolve));
  }

  return new Promise<void>((resolve, reject) => {
    conn.connecting = true;
    conn.buffer = Buffer.alloc(0);

    const socket = new net.Socket();
    socket.setNoDelay(true);

    const handshakeTimer = setTimeout(() => {
      socket.destroy();
      conn.connecting = false;
      conn.socket = null;
      conn.authed = false;
      const err = new Error("RCON timeout — server may not be fully started.");
      for (const w of conn.waiters) w(); // let them fail via their own request timeout
      conn.waiters = [];
      reject(err);
    }, timeoutMs);

    socket.on("connect", () => {
      conn.socket = socket;
      conn.nextId = Math.floor(Math.random() * 0x7fffffff);
      socket.on("data", (c: Buffer) => onData(conn, c));

      // Authenticate first.
      const authId = conn.nextId++;
      conn.pending.set(authId, {
        resolve: () => {
          clearTimeout(handshakeTimer);
          conn.authed = true;
          conn.connecting = false;
          conn.lastUsed = Date.now();
          for (const w of conn.waiters) w();
          conn.waiters = [];
          resolve();
        },
        reject: (err) => {
          clearTimeout(handshakeTimer);
          socket.destroy();
          conn.connecting = false;
          conn.socket = null;
          conn.authed = false;
          for (const w of conn.waiters) w();
          conn.waiters = [];
          reject(err);
        },
        timer: handshakeTimer,
      });
      writePacket(socket, authId, 3, conn.password); // SERVERDATA_AUTH
    });

    socket.on("error", (e) => {
      clearTimeout(handshakeTimer);
      conn.connecting = false;
      conn.socket = null;
      conn.authed = false;
      reject(e);
    });

    socket.on("close", () => {
      clearTimeout(handshakeTimer);
      failPending(conn, new Error("RCON connection lost."));
      conn.connecting = false;
      conn.socket = null;
      conn.authed = false;
      connections.delete(conn.key);
    });

    socket.connect(conn.port, conn.host);
  });
}

/** Send one command over the (reused) connection and await its reply. */
export function sendRcon(
  host: string,
  port: number,
  password: string,
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const conn = getConnection(host, port, password);

  return ensureReady(conn, timeoutMs).then(
    () =>
      new Promise<string>((resolve, reject) => {
        if (!conn.socket || !conn.socket.writable) {
          reject(new Error("RCON connection lost."));
          return;
        }
        const id = conn.nextId++;
        const timer = setTimeout(() => {
          conn.pending.delete(id);
          // A timed-out connection may be wedged — drop it so the next
          // request reconnects cleanly.
          conn.socket?.destroy();
          reject(new Error("RCON timeout — server may not be fully started."));
        }, timeoutMs);
        conn.pending.set(id, { resolve, reject, timer });
        writePacket(conn.socket, id, 2, command); // SERVERDATA_EXECCOMMAND
      }),
  );
}

// ---- idle cleanup: close connections that haven't been used for a while ----
setInterval(() => {
  const now = Date.now();
  for (const [key, conn] of connections) {
    if (now - conn.lastUsed > IDLE_CLEANUP_MS) {
      conn.socket?.destroy();
      connections.delete(key);
    }
  }
}, 60_000).unref();
