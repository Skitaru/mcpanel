// ---- Minecraft Server Panel: RCON client ----
// Implements the Source RCON protocol for Minecraft servers.

import net from "node:net";

function sendRcon(
  host: string,
  port: number,
  password: string,
  command: string,
  timeoutMs = 5000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buf = Buffer.alloc(0);
    let authed = false;
    let requestId = 0;

    const tid = setTimeout(() => {
      socket.destroy();
      reject(new Error("RCON timeout — server may not be fully started."));
    }, timeoutMs);

    const write = (id: number, type: number, payload: string) => {
      const p = Buffer.from(payload, "utf8");
      const len = 10 + p.length;
      const pkt = Buffer.alloc(len + 4);
      pkt.writeInt32LE(len, 0);
      pkt.writeInt32LE(id, 4);
      pkt.writeInt32LE(type, 8);
      p.copy(pkt, 12);
      pkt.writeInt8(0, 12 + p.length);
      pkt.writeInt8(0, 13 + p.length);
      socket.write(pkt);
    };

    socket.on("connect", () => {
      requestId = Math.floor(Math.random() * 0x7fffffff);
      write(requestId, 3, password); // SERVERDATA_AUTH = 3
    });

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readInt32LE(0);
        if (buf.length < 4 + len) break;

        const id = buf.readInt32LE(4);
        const type = buf.readInt32LE(8);
        const payload = buf.slice(12, 4 + len - 2).toString("utf8");
        buf = buf.subarray(4 + len);

        if (!authed) {
          if (id === -1) {
            clearTimeout(tid);
            socket.destroy();
            return reject(new Error("RCON authentication failed. Check password."));
          }
          authed = true;
          // Auth succeeded, now send the actual command
          write(requestId + 1, 2, command); // SERVERDATA_EXECCOMMAND = 2
          return;
        }

        // Response received
        clearTimeout(tid);
        socket.destroy();
        resolve(payload.trim());
        return;
      }
    });

    socket.on("error", (e) => {
      clearTimeout(tid);
      reject(e);
    });

    socket.connect(port, host);
  });
}

export { sendRcon };
