// ---- MCPanel: Minecraft Server List Ping ----
//
// Implements the Minecraft Server List Ping protocol (modern, post-1.7).
// Returns player count + player list or null if the server is unreachable.

import net from "node:net";

interface PingResult {
  online: number;
  max: number;
  players: { name: string; id: string }[];
}

/**
 * Ping a Minecraft server using the Server List Ping protocol.
 * Returns player count + player list or null if the server is unreachable.
 */
export function pingMinecraftServer(
  host: string,
  port: number,
  timeoutMs = 3000,
): Promise<PingResult | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buf: Buffer = Buffer.alloc(0);
    let resolved = false;

    const done = (result: PingResult | null) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs, () => done(null));
    socket.on("error", () => done(null));

    socket.connect(port, host, () => {
      const hostBytes = Buffer.from(host, "utf8");
      const writeVarInt = (b: Buffer, val: number): Buffer => {
        do {
          let temp = val & 0x7f;
          val >>>= 7;
          if (val !== 0) temp |= 0x80;
          b = Buffer.concat([b, Buffer.from([temp])]);
        } while (val !== 0);
        return b;
      };

      let pkt: Buffer = Buffer.from([0x00]);
      pkt = writeVarInt(pkt, -1);
      pkt = writeVarInt(pkt, hostBytes.length);
      pkt = Buffer.concat([pkt, hostBytes]);
      pkt = Buffer.concat([pkt, Buffer.from([port >> 8, port & 0xff])]);
      pkt = writeVarInt(pkt, 1);

      const len = writeVarInt(Buffer.alloc(0), pkt.length);
      socket.write(Buffer.concat([len, pkt]));
      socket.write(Buffer.from([0x01, 0x00]));
    });

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]) as Buffer;
      try {
        // Parse VarInt length prefix
        let pos = 0;
        let length = 0;
        let shift = 0;
        while (pos < buf.length) {
          const b = buf[pos++];
          length |= (b & 0x7f) << shift;
          if (!(b & 0x80)) break;
          shift += 7;
        }
        if (pos + length > buf.length) return; // incomplete

        const payload = buf.subarray(pos, pos + length);
        if (payload[0] !== 0x00) return; // not a status response

        // Read VarInt string length prefix from the response body
        let strPos = 1;
        let strLen = 0;
        let strShift = 0;
        while (strPos < payload.length) {
          const sb = payload[strPos++];
          strLen |= (sb & 0x7f) << strShift;
          if (!(sb & 0x80)) break;
          strShift += 7;
        }

        const jsonStr = payload.subarray(strPos, strPos + strLen).toString("utf8");
        const data = JSON.parse(jsonStr);
        if (data.players) {
          done({
            online: data.players.online ?? 0,
            max: data.players.max ?? 0,
            players: (data.players.sample ?? []).map((p: any) => ({ name: p.name, id: p.id })),
          });
        } else {
          done(null);
        }
      } catch {
        // incomplete or invalid, wait for more data
      }
    });
  });
}
