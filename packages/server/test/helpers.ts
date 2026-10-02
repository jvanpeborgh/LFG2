import { WebSocket } from "ws";
import { decodeChunkFrame, type ServerMessage } from "@lfg/shared";

/** A minimal scripted client for server tests. */
export class TestClient {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  chunks = 0;
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer;
        decodeChunkFrame(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
        this.chunks++;
        return;
      }
      const m = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
  }

  open(): Promise<void> {
    return new Promise((r) => this.ws.once("open", () => r()));
  }

  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  waitFor<T extends ServerMessage["t"]>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 8000): Promise<Extract<ServerMessage, { t: T }>> {
    const found = this.messages.find((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
    if (found) return Promise.resolve(found as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), ms);
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>),
        resolve: (m) => { clearTimeout(timer); resolve(m as Extract<ServerMessage, { t: T }>); },
      });
    });
  }
}
