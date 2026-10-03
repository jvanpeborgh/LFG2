import "./style.css";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, type ServerMessage } from "@lfg/shared";
import { GameClient } from "./game";

/** Title screen: pick a name, connect, hand over to the game. */
const title = document.getElementById("title")!;
const nameInput = document.getElementById("name") as HTMLInputElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const status = document.getElementById("status")!;
const worldSelect = document.getElementById("world") as HTMLSelectElement;
const canvas = document.getElementById("game") as HTMLCanvasElement;

const params = new URLSearchParams(location.search);
nameInput.value = params.get("name") ?? safeGet("lfg2.name") ?? `Player${Math.floor(Math.random() * 900 + 100)}`;

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}

// Worlds on this server (open ones, plus ?world= for one being set up).
const wantedWorld = params.get("world") ?? "";
fetch("/api/worlds").then((r) => r.json()).then((list: { name: string; title: string; players: number; owner: string | null }[]) => {
  worldSelect.innerHTML = "";
  const names = new Set<string>();
  for (const w of list) {
    names.add(w.name);
    const o = document.createElement("option");
    o.value = w.name;
    o.textContent = `${w.title}${w.owner ? ` (by ${w.owner})` : ""} · ${w.players} playing`;
    worldSelect.appendChild(o);
  }
  if (wantedWorld && !names.has(wantedWorld)) {
    const o = document.createElement("option");
    o.value = o.textContent = wantedWorld;
    worldSelect.appendChild(o);
  }
  if (wantedWorld) worldSelect.value = wantedWorld;
}).catch(() => {
  if (wantedWorld) { worldSelect.innerHTML = ""; const o = document.createElement("option"); o.value = o.textContent = wantedWorld; worldSelect.appendChild(o); }
});

function serverUrl(): string {
  const custom = params.get("server");
  const world = worldSelect.value || wantedWorld;
  const q = world ? `?world=${encodeURIComponent(world)}` : "";
  if (custom) return custom + q;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${q}`;
}

let game: GameClient | null = null;

function connect(): void {
  const name = nameInput.value.trim();
  if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) {
    status.textContent = "Name: 2–16 letters, numbers or _";
    return;
  }
  try { localStorage.setItem("lfg2.name", name); } catch { /* ignore */ }
  playBtn.disabled = true;
  status.textContent = "Connecting…";
  // The fingerprint of the content this build knows; the server checks it matches.
  const fingerprint = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS).fingerprint();
  const ws = new WebSocket(serverUrl());
  ws.binaryType = "arraybuffer";
  ws.onopen = () => ws.send(JSON.stringify({ t: "hello", name, protocol: PROTOCOL_VERSION, fingerprint }));
  ws.onerror = () => { status.textContent = "Couldn't reach the server."; playBtn.disabled = false; };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    const m = JSON.parse(ev.data) as ServerMessage;
    if (m.t === "reject") {
      status.textContent = m.reason;
      playBtn.disabled = false;
      ws.close();
      return;
    }
    if (m.t !== "welcome") return;
    try {
      title.hidden = true;
      canvas.hidden = false;
      game = new GameClient(ws, m, canvas, (reason) => {
        game = null;
        title.hidden = false;
        canvas.hidden = true;
        status.textContent = reason;
        playBtn.disabled = false;
      });
      (window as unknown as { lfg: unknown }).lfg = game;
      Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
      title.hidden = false;
      playBtn.disabled = false;
      ws.close();
    }
  };
}

playBtn.onclick = connect;
nameInput.onkeydown = (e) => { if (e.key === "Enter") connect(); };
if (params.has("autoplay")) connect();
