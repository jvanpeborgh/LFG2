import "./style.css";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, type ServerMessage } from "@lfg/shared";
import { GameClient } from "./game";

/**
 * Title screen: your name (kept for you by this browser), then straight in: into the world a
 * friend invited you to, the world you were last in, or one you pick or make.
 *
 *   ?join=<code>   an invite link: shows who invited you, and joins next to them
 *   ?world=<name>  a world by name; ?name= and ?autoplay for scripts
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = $("title");
const nameInput = $<HTMLInputElement>("name");
const nameNote = $("name-note");
const playBtn = $<HTMLButtonElement>("play");
const status = $("status");
const canvas = $<HTMLCanvasElement>("game");

const params = new URLSearchParams(location.search);
const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* private window */ } },
};

// ------------------------------------------------------------------ your name and this browser's key
/** Keys by name: the first key to play a name keeps it (see the server's accounts.ts). */
const keys: Record<string, string> = (() => { try { return JSON.parse(store.get("lfg2.keys") ?? "{}"); } catch { return {}; } })();
function keyFor(name: string): string {
  const k = name.toLowerCase();
  if (!keys[k]) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    keys[k] = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
    store.set("lfg2.keys", JSON.stringify(keys));
  }
  return keys[k];
}
const validName = (n: string) => /^[A-Za-z0-9_]{2,16}$/.test(n);
nameInput.value = params.get("name") ?? store.get("lfg2.name") ?? `Player${Math.floor(Math.random() * 900 + 100)}`;

// ------------------------------------------------------------------ where to play
interface WorldCard { name: string; title: string; description: string; owner: string | null; players: number; open: boolean; access: "public" | "invite"; mine: boolean; member: boolean }
const invite = params.get("join")?.toLowerCase() ?? null;
let inviteInfo: { world: string; title: string; by: string; players: number; owner: string | null } | null = null;
let chosen: { world: string; title: string } | null = params.get("world") ? { world: params.get("world")!, title: params.get("world")! } : null;
let worlds: WorldCard[] = [];
let lastWorld: string | null = store.get("lfg2.lastWorld");

function playLabel(): string {
  if (inviteInfo && (!chosen || chosen.world === inviteInfo.world)) return `Join ${inviteInfo.by} in ${inviteInfo.title}`;
  if (chosen) return `Play in ${chosen.title}`;
  const last = lastWorld && worlds.find((w) => w.name === lastWorld);
  if (last) return `Continue in ${last.title}`;
  return "Play";
}
function target(): string {
  if (chosen) return chosen.world;
  if (inviteInfo) return inviteInfo.world;
  if (lastWorld && worlds.some((w) => w.name === lastWorld)) return lastWorld;
  return "";
}
function refreshButton(): void { playBtn.textContent = playLabel(); }

function renderWorlds(): void {
  const list = $("worlds");
  list.innerHTML = "";
  const sorted = [...worlds].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.member) - Number(a.member) || b.players - a.players);
  for (const w of sorted) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = `world${(chosen?.world ?? target()) === w.name ? " chosen" : ""}`;
    const badges = [w.mine ? "yours" : w.member ? "invited" : "", w.access === "invite" ? "invite-only" : "", w.open ? "" : "being set up"].filter(Boolean);
    b.innerHTML = `<span class="w-title"></span><span class="w-meta"></span>`;
    b.querySelector(".w-title")!.textContent = w.title;
    b.querySelector(".w-meta")!.textContent = [w.owner ? `by ${w.owner}` : "the server's world", `${w.players} playing`, ...badges].join(" · ");
    b.onclick = () => { chosen = { world: w.name, title: w.title }; renderWorlds(); refreshButton(); };
    li.appendChild(b);
    list.appendChild(li);
  }
  if (!sorted.length) list.innerHTML = `<li class="note">No worlds yet: create one below.</li>`;
}

async function loadWorlds(): Promise<void> {
  const name = nameInput.value.trim();
  const headers: Record<string, string> = validName(name) && keys[name.toLowerCase()] ? { "x-lfg-name": name, "x-lfg-key": keys[name.toLowerCase()] } : {};
  try {
    const r = await fetch("/api/worlds", { headers });
    const data = await r.json() as { worlds: WorldCard[]; lastWorld: string | null; claimed: "yours" | "taken" | "free" | null };
    worlds = data.worlds;
    if (data.lastWorld) lastWorld = data.lastWorld;
    nameNote.textContent = !validName(name) ? "2–16 letters, numbers or _"
      : data.claimed === "yours" ? "✓ This name is yours on this browser"
      : data.claimed === "taken" ? "Someone already plays as this name. If it's you, sign in with a code below."
      : "This name is free: it's yours once you play";
    nameNote.dataset.state = data.claimed ?? "";
  } catch { worlds = []; }
  renderWorlds();
  refreshButton();
}

async function loadInvite(): Promise<void> {
  if (!invite) return;
  const box = $("invite"), text = $("invite-text");
  box.hidden = false;
  try {
    const r = await fetch(`/api/invite/${encodeURIComponent(invite)}`);
    const data = await r.json();
    if (!r.ok) { text.textContent = data.error; box.dataset.state = "bad"; return; }
    inviteInfo = data;
    text.innerHTML = `<b></b> invited you to <b></b><span class="note"></span>`;
    const [by, world] = text.querySelectorAll("b");
    by.textContent = data.by; world.textContent = data.title;
    text.querySelector(".note")!.textContent = ` · ${data.players} playing${data.access === "invite" ? " · invite-only" : ""}`;
  } catch { text.textContent = "Couldn't check that invite link"; }
  refreshButton();
}

// ------------------------------------------------------------------ playing
let game: GameClient | null = null;
function serverUrl(world: string): string {
  const custom = params.get("server");
  const q = world ? `?world=${encodeURIComponent(world)}` : "";
  if (custom) return custom + q;
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws${q}`;
}

function connect(world = target()): void {
  const name = nameInput.value.trim();
  if (!validName(name)) { status.textContent = "Name: 2–16 letters, numbers or _"; nameInput.focus(); return; }
  store.set("lfg2.name", name);
  playBtn.disabled = true;
  status.textContent = "Connecting…";
  // The fingerprint of the content this build knows; the server checks it matches.
  const fingerprint = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS).fingerprint();
  const ws = new WebSocket(serverUrl(world));
  ws.binaryType = "arraybuffer";
  const useInvite = inviteInfo && (!world || world === inviteInfo.world) ? invite : undefined;
  ws.onopen = () => ws.send(JSON.stringify({ t: "hello", name, protocol: PROTOCOL_VERSION, fingerprint, key: keyFor(name), ...(useInvite ? { invite: useInvite } : {}) }));
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
      store.set("lfg2.lastWorld", world || "world");
      title.hidden = true;
      canvas.hidden = false;
      game = new GameClient(ws, m, canvas, (reason) => {
        game = null;
        title.hidden = false;
        canvas.hidden = true;
        status.textContent = reason;
        playBtn.disabled = false;
        void loadWorlds();
      });
      (window as unknown as { lfg: unknown }).lfg = game;
      // An invite is used once: later visits go to the world you were in.
      if (useInvite) history.replaceState(null, "", location.pathname + (params.has("name") ? `?name=${encodeURIComponent(name)}` : ""));
      Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
      title.hidden = false;
      playBtn.disabled = false;
      ws.close();
    }
  };
}

// ------------------------------------------------------------------ making a world
$<HTMLFormElement>("create").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!validName(name)) { status.textContent = "Pick your name first (2–16 letters, numbers or _)"; nameInput.focus(); return; }
  const body = {
    name, key: keyFor(name),
    title: $<HTMLInputElement>("c-title").value.trim(),
    theme: $<HTMLTextAreaElement>("c-theme").value.trim(),
    look: $<HTMLSelectElement>("c-look").value,
    access: (document.querySelector('input[name="c-access"]:checked') as HTMLInputElement).value,
    startTime: $<HTMLSelectElement>("c-time").value,
    setUp: $<HTMLInputElement>("c-setup").checked,
  };
  status.textContent = "Making your world…";
  try {
    const r = await fetch("/api/worlds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json();
    if (!r.ok) { status.textContent = data.error; return; }
    store.set("lfg2.name", name);
    chosen = { world: data.world, title: data.title };
    connect(data.world);
  } catch { status.textContent = "Couldn't reach the server."; }
});

$<HTMLFormElement>("signin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $<HTMLInputElement>("code").value.trim();
  if (!code) return;
  try {
    const r = await fetch("/api/signin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    const data = await r.json();
    if (!r.ok) { status.textContent = data.error; return; }
    keys[data.name.toLowerCase()] = data.key;
    store.set("lfg2.keys", JSON.stringify(keys));
    nameInput.value = data.name;
    store.set("lfg2.name", data.name);
    status.textContent = `Signed in as ${data.name}`;
    ($<HTMLDetailsElement>("signin-box")).open = false;
    void loadWorlds();
  } catch { status.textContent = "Couldn't reach the server."; }
});

playBtn.onclick = () => connect();
nameInput.onkeydown = (e) => { if (e.key === "Enter") connect(); };
let typing: ReturnType<typeof setTimeout> | undefined;
nameInput.oninput = () => { clearTimeout(typing); typing = setTimeout(() => void loadWorlds(), 350); };
// Open the worlds list for people with somewhere to choose from.
void Promise.all([loadInvite(), loadWorlds()]).then(() => {
  if (worlds.length > 1 && !inviteInfo) $<HTMLDetailsElement>("worlds-box").open = true;
  if (params.has("autoplay")) connect();
});
