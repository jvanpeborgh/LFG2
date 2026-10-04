import type { VoiceMode } from "./voice";
import { TIER_NAMES, type FriendHud, type GameMode, type ItemStack, type BuffHud, type ScrollHud, type ProgressHud, type Registry, type RitualHud, type Slot, type WindowSnapshot, type WorldEventNotice, type ScenarioHud, type ServerMessage } from "@lfg/shared";
import type { Atlas } from "./atlas";

export interface SelfState {
  health: number;
  maxHealth: number;
  hunger: number;
  gameMode: GameMode;
  selected: number;
  hotbar: Slot[];
  main: Slot[];
  dead: boolean;
}

export interface Settings {
  fov: number;
  sensitivity: number;
  volume: number;
  renderDistance: number;
  reducedMotion: boolean;
  /** Voice commands: how to transcribe (auto picks the server if it can, else the browser). */
  voice: VoiceMode;
  /** Always wait for Enter before sending what was heard. */
  voiceConfirm: boolean;
  /** Glow (bloom) and tone mapping: the sun, lightning, lanterns and glowing eyes bloom. */
  effects: boolean;
  /** Sun shadows from terrain, trees, creatures and players. */
  shadows: boolean;
}

export interface UICallbacks {
  click(index: number, button: 0 | 1, shift: boolean): void;
  creativePick(item: number, count: number): void;
  closeWindow(): void;
  chat(text: string): void;
  respawn(): void;
  resume(): void;
  /** Push-to-talk from the on-screen mic button. */
  voiceStart?(): void;
  voiceStop?(): void;
  settings(s: Settings): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
};

const HEART = (fill: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 9' shape-rendering='crispEdges'><path fill='#1a1a1a' d='M1 1h3v1h1V1h3v1h1v3H8v1H7v1H6v1H5v1H4V8H3V7H2V6H1V5H0V2h1z'/><path fill='${fill}' d='M1 2h3v1h1V2h3v3H7v1H6v1H5v1H4V7H3V6H2V5H1z'/><path fill='#fff' opacity='.6' d='M2 2h1v1H2z'/></svg>`)}")`;
const DRUM = (fill: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 9 9' shape-rendering='crispEdges'><path fill='#1a1a1a' d='M4 0h4v1h1v4H8v1H6v1H5v1H3v1H1V8H0V6h1V5h1V4h1V1h1z'/><path fill='${fill}' d='M4 1h4v4H6v1H4V4H4V1z'/><path fill='#e8e2d8' d='M1 6h2v1H2v1H1z'/></svg>`)}")`;

const CONTROLS: [string, string][] = [
  ["WASD", "move"],
  ["Mouse", "look"],
  ["Space", "jump · double-tap to fly (creative)"],
  ["Shift", "sprint · boost while flying"],
  ["C", "fly down"],
  ["Left click", "mine / attack"],
  ["Right click", "place · use · eat"],
  ["Middle click", "pick block"],
  ["1–9 / wheel", "hotbar"],
  ["E", "inventory & crafting"],
  ["Q", "drop (Shift+Q: stack)"],
  ["T or Enter", "chat · / for commands"],
  ["B (hold)", "speak: \"summon a flying shark\""],
  ["J", "join a ritual"],
  ["R / F / G", "spells (with a power)"],
  ["K", "spellbook (prepared scrolls)"],
  ["V", "first / third person"],
  ["F3", "debug info"],
  ["H", "hide this"],
];

export class UI {
  readonly root: HTMLElement;
  private hotbarEl: HTMLElement;
  private heartsEl: HTMLElement;
  private hungerEl: HTMLElement;
  private airEl: HTMLElement;
  private chatLog: HTMLElement;
  private chatInput: HTMLInputElement;
  private bannerEl: HTMLElement;
  private toastEl: HTMLElement;
  private debugEl: HTMLElement;
  private helpEl: HTMLElement;
  private windowEl: HTMLElement;
  private cursorEl: HTMLElement;
  private tooltipEl: HTMLElement;
  private deathEl: HTMLElement;
  private pauseEl: HTMLElement;
  private crosshair: HTMLElement;
  private flashEl: HTMLElement;
  private vignette: HTMLElement;
  private playersEl: HTMLElement;
  private scenarioEl: HTMLElement;
  private aetherEl!: HTMLElement;
  private levelEl!: HTMLElement;
  private tierEl!: HTMLElement;
  private xpEl!: HTMLElement;
  private ritualEl!: HTMLElement;
  progress: ProgressHud | null = null;
  private voiceEl!: HTMLElement;
  private micEl!: HTMLButtonElement;
  private voiceTimer = 0;
  private buffsEl!: HTMLElement;
  private bookEl!: HTMLElement;
  scrolls: ScrollHud[] = [];
  ritualHud: RitualHud | null = null;
  private scenarioHud: ScenarioHud | null = null;
  self: SelfState | null = null;
  window: WindowSnapshot | null = null;
  cursor: Slot = null;
  chatOpen = false;
  settings: Settings;
  private bannerTimer = 0;
  private toastTimer = 0;
  private lastSelected = -1;

  constructor(private reg: Registry, private atlas: Atlas, private cb: UICallbacks) {
    this.settings = loadSettings();
    this.root = el("div", "hud", document.body);
    this.crosshair = el("div", "crosshair", this.root);
    this.flashEl = el("div", "flash", this.root);
    this.vignette = el("div", "hurt-vignette", this.root);
    const bottom = el("div", "bottom", this.root);
    const bars = el("div", "bars", bottom);
    this.heartsEl = el("div", "hearts", bars);
    this.airEl = el("div", "air", bars);
    this.hungerEl = el("div", "hunger", bars);
    // Progression: aether (left), level (middle), tier and shards (right), XP bar under them.
    const prog = el("div", "bars prog", bottom);
    this.aetherEl = el("div", "aether", prog);
    this.levelEl = el("div", "level", prog);
    this.tierEl = el("div", "tier", prog);
    this.xpEl = el("div", "xp", bottom);
    el("div", "xp-fill", this.xpEl);
    this.hotbarEl = el("div", "hotbar", bottom);
    for (let i = 0; i < 9; i++) el("div", "slot", this.hotbarEl);
    this.toastEl = el("div", "toast", this.root);

    const chat = el("div", "chat", this.root);
    this.chatLog = el("div", "chat-log", chat);
    this.chatInput = el("input", "chat-input", chat);
    this.chatInput.maxLength = 256;
    this.chatInput.placeholder = "Say something, or /help";
    this.chatInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const text = this.chatInput.value.trim();
        if (text) this.cb.chat(text);
        this.closeChat();
        this.cb.resume();
      } else if (e.key === "Escape") {
        this.closeChat();
        this.cb.resume();
      }
    });

    this.bannerEl = el("div", "banner", this.root);
    this.scenarioEl = el("div", "scenario", this.root);
    this.raceEl = el("div", "scenario race", this.root);
    this.happeningEl = el("div", "happening", this.root);
    this.raceCountEl = el("div", "race-count", this.root);
    this.ritualEl = el("div", "ritual", this.root);
    this.voiceEl = el("div", "voice", this.root);
    this.buffsEl = el("div", "buffs", this.root);
    this.bookEl = el("div", "spellbook", this.root);
    this.micEl = el("button", "mic", this.root, "🎤");
    this.micEl.title = "Hold to speak a command (or hold B)";
    this.micEl.hidden = true;
    const down = (e: Event) => { e.preventDefault(); this.cb.voiceStart?.(); };
    const up = (e: Event) => { e.preventDefault(); this.cb.voiceStop?.(); };
    this.micEl.addEventListener("pointerdown", down);
    this.micEl.addEventListener("pointerup", up);
    this.micEl.addEventListener("pointerleave", up);
    this.debugEl = el("pre", "debug", this.root);
    this.debugEl.hidden = true;
    this.helpEl = el("div", "help", this.root);
    el("div", "help-title", this.helpEl, "Controls");
    for (const [k, v] of CONTROLS) {
      const row = el("div", "help-row", this.helpEl);
      el("span", "key", row, k);
      el("span", "", row, v);
    }
    this.playersEl = el("div", "players", this.root);

    this.windowEl = el("div", "window-overlay", this.root);
    this.windowEl.hidden = true;
    this.windowEl.addEventListener("mousedown", (e) => {
      if (e.target === this.windowEl) this.cb.closeWindow();
    });
    this.cursorEl = el("div", "cursor-stack", this.root);
    this.tooltipEl = el("div", "tooltip", this.root);
    this.tooltipEl.hidden = true;
    document.addEventListener("mousemove", (e) => {
      this.cursorEl.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - 20}px)`;
      this.tooltipEl.style.transform = `translate(${e.clientX + 14}px, ${e.clientY - 28}px)`;
    });

    this.deathEl = el("div", "screen death", this.root);
    el("h1", "", this.deathEl, "You died!");
    const respawn = el("button", "", this.deathEl, "Respawn");
    respawn.onclick = () => this.cb.respawn();
    this.deathEl.hidden = true;

    this.pauseEl = el("div", "screen pause", this.root);
    this.pauseEl.hidden = true;
    this.buildPause();
  }

  private buildPause(): void {
    const p = this.pauseEl;
    el("h1", "", p, "Paused");
    const resume = el("button", "", p, "Back to game");
    resume.onclick = () => this.cb.resume();
    const form = el("div", "settings", p);
    const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const row = el("label", "setting", form);
      const name = el("span", "", row, label);
      const input = el("input", "", row);
      input.type = "range";
      input.min = String(min); input.max = String(max); input.step = String(step);
      input.value = String(this.settings[key]);
      const val = el("span", "val", row, fmt(Number(input.value)));
      input.oninput = () => {
        (this.settings[key] as number) = Number(input.value);
        val.textContent = fmt(Number(input.value));
        saveSettings(this.settings);
        this.cb.settings(this.settings);
      };
      void name;
    };
    slider("Field of view", "fov", 50, 110, 1, (v) => `${v}°`);
    slider("Mouse sensitivity", "sensitivity", 0.2, 3, 0.1, (v) => v.toFixed(1));
    slider("Volume", "volume", 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`);
    slider("Fog distance", "renderDistance", 48, 192, 8, (v) => `${v} blocks`);
    const row = el("label", "setting", form);
    el("span", "", row, "Reduced motion");
    const cb = el("input", "", row);
    cb.type = "checkbox";
    cb.checked = this.settings.reducedMotion;
    cb.onchange = () => { this.settings.reducedMotion = cb.checked; saveSettings(this.settings); this.cb.settings(this.settings); };
    const erow = el("label", "setting", form);
    el("span", "", erow, "Glow effects");
    const ef = el("input", "", erow);
    ef.type = "checkbox";
    ef.checked = this.settings.effects;
    ef.onchange = () => { this.settings.effects = ef.checked; saveSettings(this.settings); this.cb.settings(this.settings); };
    const srow = el("label", "setting", form);
    el("span", "", srow, "Sun shadows");
    const sh = el("input", "", srow);
    sh.type = "checkbox";
    sh.checked = this.settings.shadows;
    sh.onchange = () => { this.settings.shadows = sh.checked; saveSettings(this.settings); this.cb.settings(this.settings); };
    const vrow = el("label", "setting", form);
    el("span", "", vrow, "Voice (hold B)");
    const sel = el("select", "", vrow);
    for (const [v, label] of [["auto", "Automatic"], ["server", "Game server"], ["browser", "This browser"], ["off", "Off"]] as const) {
      const o = el("option", "", sel, label);
      o.value = v;
    }
    sel.value = this.settings.voice;
    sel.onchange = () => { this.settings.voice = sel.value as VoiceMode; saveSettings(this.settings); this.cb.settings(this.settings); };
    const crow = el("label", "setting", form);
    el("span", "", crow, "Confirm voice with Enter");
    const cc = el("input", "", crow);
    cc.type = "checkbox";
    cc.checked = this.settings.voiceConfirm;
    cc.onchange = () => { this.settings.voiceConfirm = cc.checked; saveSettings(this.settings); };
    // Bringing friends: your invite link (they join next to you), to copy or share.
    const inv = el("div", "invite-panel", p);
    el("h2", "", inv, "Invite friends");
    el("p", "", inv, "Friends who open your link join this world right next to you, and you both get XP the first time.");
    const get = el("button", "", inv, "Get my invite link");
    const linkRow = el("div", "invite-row", inv);
    linkRow.hidden = true;
    this.inviteInput = el("input", "", linkRow);
    this.inviteInput.readOnly = true;
    this.inviteInput.setAttribute("aria-label", "Your invite link");
    const copy = el("button", "small-btn", linkRow, "Copy");
    const share = el("button", "small-btn", linkRow, "Share");
    share.hidden = !("share" in navigator);
    this.inviteNote = el("p", "invite-note", inv);
    get.onclick = () => { this.cb.chat("/invite"); get.disabled = true; setTimeout(() => (get.disabled = false), 1500); };
    copy.onclick = () => {
      this.inviteInput.select();
      navigator.clipboard?.writeText(this.inviteInput.value).then(() => (this.inviteNote.textContent = "Copied: send it to a friend"), () => document.execCommand?.("copy"));
    };
    share.onclick = () => { void navigator.share?.({ title: "Play LFG2 with me", text: `Come and play in ${this.inviteTitle} with me`, url: this.inviteInput.value }).catch(() => {}); };
    this.inviteRow = linkRow;
    // Friends: who's online and where; go to them (here) or join their world.
    const fr = el("div", "invite-panel friends-panel", p);
    el("h2", "", fr, "Friends");
    this.friendsList = el("div", "friends-list", fr);
    el("p", "", this.friendsList, "Friends you invite (or ask with /friend <name>) show up here.");
    const add = el("div", "invite-row", fr);
    const who = el("input", "", add);
    who.placeholder = "Ask someone to be your friend";
    who.maxLength = 16;
    who.setAttribute("aria-label", "Name to ask");
    const ask = el("button", "small-btn", add, "Ask");
    ask.onclick = () => { const n = who.value.trim(); if (n) { this.cb.chat(`/friend ${n}`); who.value = ""; } };
    who.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") ask.click(); };
    el("p", "hint", p, "Click the game to keep playing. Press H in game to show or hide the controls.");
  }

  private inviteInput!: HTMLInputElement;
  private inviteNote!: HTMLElement;
  private inviteRow!: HTMLElement;
  private inviteTitle = "";
  private friendsList!: HTMLElement;

  /** Your friends list (online first): Go to one here, Join one elsewhere, answer requests. */
  setFriends(friends: FriendHud[], requests: string[]): void {
    const box = this.friendsList;
    box.innerHTML = "";
    if (!friends.length && !requests.length) { el("p", "", box, "Friends you invite (or ask with /friend <name>) show up here."); return; }
    for (const n of requests) {
      const row = el("div", "friend-row request", box);
      el("span", "f-name", row, `${n} asked to be your friend`);
      const yes = el("button", "small-btn", row, "Accept");
      yes.onclick = () => this.cb.chat(`/friend ${n}`);
      const no = el("button", "small-btn quiet", row, "No");
      no.onclick = () => this.cb.chat(`/friend no ${n}`);
    }
    for (const f of friends) {
      const row = el("div", `friend-row${f.online ? " online" : ""}`, box);
      el("span", "f-name", row, `${f.online ? "●" : "○"} ${f.name}`);
      el("span", "f-where", row, !f.online ? "offline" : f.here ? "here" : `in ${f.title}`);
      if (f.online && f.here) {
        const go = el("button", "small-btn", row, "Go");
        go.onclick = () => { this.cb.chat(`/visit ${f.name}`); this.cb.resume(); };
        const gift = el("button", "small-btn quiet", row, "Gift");
        gift.title = `Summon something for ${f.name}: you pay, it's theirs`;
        gift.onclick = () => this.openChat(`/gift ${f.name} `);
      } else if (f.online && f.canJoin) {
        const go = el("button", "small-btn", row, "Join");
        go.title = `Leave this world and join ${f.name} in ${f.title}`;
        go.onclick = () => { location.href = `/?world=${encodeURIComponent(f.world!)}&near=${encodeURIComponent(f.name)}&autoplay`; };
      }
    }
  }
  private stepsEl: HTMLElement | null = null;

  /** Your invite link arrived (from the menu's button or /invite). */
  setInvite(url: string, title: string, access: "public" | "invite"): void {
    this.inviteTitle = title;
    this.inviteInput.value = url;
    this.inviteRow.hidden = false;
    this.inviteNote.textContent = access === "invite" ? `${title} is invite-only: this link lets your friends in.` : `Anyone can join ${title}; this link brings them straight to you.`;
  }

  /** Your first steps, in the corner (null hides them). */
  setSteps(steps: { id: string; label: string; hint: string; done: boolean }[] | null): void {
    if (!steps) { this.stepsEl?.remove(); this.stepsEl = null; return; }
    if (!this.stepsEl) this.stepsEl = el("div", "steps", this.root);
    const box = this.stepsEl;
    box.innerHTML = "";
    el("div", "steps-title", box, `First steps · ${steps.filter((s) => s.done).length}/${steps.length}`);
    const next = steps.find((s) => !s.done);
    for (const s of steps) {
      const row = el("div", `step${s.done ? " done" : ""}${s === next ? " next" : ""}`, box);
      el("span", "tick", row, s.done ? "✔" : "○");
      const t = el("span", "", row);
      el("span", "label", t, s.label);
      if (s === next) el("span", "hint", t, s.hint);
    }
    el("div", "steps-foot", box, "/steps to hide");
  }

  // ------------------------------------------------------------------ HUD state

  setSelf(s: SelfState): void {
    const prevHealth = this.self?.health ?? s.health;
    this.self = s;
    const cells = this.hotbarEl.children;
    for (let i = 0; i < 9; i++) {
      const c = cells[i] as HTMLElement;
      c.classList.toggle("selected", i === s.selected);
      this.fillSlot(c, s.hotbar[i]);
    }
    const survival = s.gameMode === "survival";
    this.heartsEl.hidden = this.hungerEl.hidden = !survival;
    if (survival) {
      const per = s.maxHealth / 10;
      this.heartsEl.innerHTML = "";
      for (let i = 0; i < 10; i++) {
        const v = s.health - i * per;
        const h = el("i", "icon", this.heartsEl);
        h.style.backgroundImage = HEART(v >= per ? "#e0332b" : v > 0 ? "#e0332b" : "#3a3a3a");
        if (v > 0 && v < per) h.classList.add("half");
      }
      if (s.health < prevHealth) {
        this.heartsEl.classList.remove("shake");
        void this.heartsEl.offsetWidth;
        this.heartsEl.classList.add("shake");
        this.vignette.style.opacity = "0.55";
        setTimeout(() => (this.vignette.style.opacity = "0"), 220);
      }
      this.hungerEl.innerHTML = "";
      for (let i = 0; i < 10; i++) {
        const v = s.hunger - (9 - i) * 2;
        const h = el("i", "icon", this.hungerEl);
        h.style.backgroundImage = DRUM(v >= 1 ? "#b06a35" : "#3a3a3a");
        if (v === 1) h.classList.add("half");
      }
    }
    if (s.selected !== this.lastSelected) {
      this.lastSelected = s.selected;
      const st = s.hotbar[s.selected];
      if (st) this.toast(this.reg.itemById(st.item)?.displayName ?? "");
    }
    this.deathEl.hidden = !s.dead;
    if (this.window) this.renderWindow();
  }

  setAir(air: number): void {
    this.airEl.hidden = air >= 10;
    if (air < 10) this.airEl.textContent = "◯".repeat(Math.max(0, Math.ceil(air)));
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = "1";
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.style.opacity = "0"), 1800);
  }

  flash(amount: number): void {
    this.flashEl.style.opacity = String(Math.min(0.5, amount));
  }

  setUnderwater(on: boolean): void {
    this.root.classList.toggle("underwater", on);
  }

  setCrosshairTarget(kind: "none" | "block" | "entity"): void {
    this.crosshair.dataset.target = kind;
  }

  setPlayers(list: { name: string; gameMode: GameMode }[]): void {
    this.playersEl.textContent = `${list.length} online: ${list.map((p) => p.name).join(", ")}`;
  }

  toggleHelp(): void {
    this.helpEl.hidden = !this.helpEl.hidden;
  }

  toggleDebug(): boolean {
    this.debugEl.hidden = !this.debugEl.hidden;
    return !this.debugEl.hidden;
  }

  setDebug(text: string): void {
    if (!this.debugEl.hidden) this.debugEl.textContent = text;
  }

  showPause(show: boolean): void {
    this.pauseEl.hidden = !show || !!this.window || this.chatOpen || !!this.self?.dead;
  }

  // ------------------------------------------------------------------ chat & events

  addChat(text: string, kind: "chat" | "system" | "event", from?: string): void {
    for (const line of text.split("\n")) {
      const row = el("div", `chat-line ${kind}`, this.chatLog);
      if (from) el("b", "", row, `<${from}> `);
      row.appendChild(document.createTextNode(line));
      setTimeout(() => row.classList.add("old"), 10_000);
    }
    while (this.chatLog.children.length > 80) this.chatLog.firstChild?.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  openChat(prefix = ""): void {
    this.chatOpen = true;
    this.root.classList.add("chat-open");
    this.chatInput.value = prefix;
    setTimeout(() => this.chatInput.focus(), 0);
  }

  closeChat(): void {
    this.chatOpen = false;
    this.root.classList.remove("chat-open");
    this.chatInput.blur();
  }

  /** Level, XP, aether, shards. Returns true when the level went up (for the fanfare). */
  setProgress(p: ProgressHud): boolean {
    const up = !!this.progress && p.level > this.progress.level;
    const unlocked = !!this.progress && p.tier > this.progress.tier;
    this.progress = p;
    this.levelEl.textContent = String(p.level);
    this.levelEl.title = `Level ${p.level}`;
    this.aetherEl.innerHTML = "";
    const track = el("div", "aether-track", this.aetherEl);
    el("div", "aether-fill", track).style.width = `${(p.aether / p.aetherMax) * 100}%`;
    el("span", "aether-label", this.aetherEl, `✦ ${p.aether}`);
    this.aetherEl.title = `Aether ${p.aether}/${p.aetherMax}: spent on summons, refills over time`;
    this.tierEl.textContent = `Tier ${p.tier}${p.shards ? ` · ◆ ${p.shards}` : ""}`;
    this.tierEl.title = `You can summon up to tier ${p.tier} (${TIER_NAMES[p.tier - 1]})${p.nextTierLevel ? `; tier ${p.tier + 1} at level ${p.nextTierLevel}` : ""}. ◆ aether shards: ${p.shards}`;
    (this.xpEl.firstChild as HTMLElement).style.width = `${p.next ? (p.xp / p.next) * 100 : 100}%`;
    this.xpEl.title = p.next ? `${p.xp}/${p.next} XP to level ${p.level + 1}` : "Top level";
    if (up) this.toast(`Level ${p.level}!${unlocked ? ` ${TIER_NAMES[p.tier - 1]} summons unlocked` : ""}`);
    return up;
  }

  // ------------------------------------------------------------------ spellbook

  get bookOpen(): boolean {
    return this.bookEl.classList.contains("show");
  }

  setScrolls(list: ScrollHud[]): void {
    this.scrolls = list;
    if (this.bookOpen) this.renderBook();
  }

  toggleBook(open = !this.bookOpen): void {
    this.bookEl.classList.toggle("show", open);
    if (open) this.renderBook();
  }

  private renderBook(): void {
    this.bookEl.innerHTML = "";
    el("h2", "", this.bookEl, "📜 Spellbook");
    if (!this.scrolls.length) el("p", "hint", this.bookEl, "No scrolls yet. /inscribe <name> = <what to summon>, or prepare them in ChatGPT or Claude with the LFG2 MCP server (/link).");
    for (const s of this.scrolls) {
      const row = el("div", "scroll", this.bookEl);
      el("div", "scroll-name", row, s.name);
      const btn = el("button", "", row, "Cast");
      btn.onclick = () => { this.cb.chat(`/cast ${s.name}`); this.toggleBook(false); this.cb.resume(); };
      el("div", "scroll-what", row, `${s.title} · tier ${s.tier} · ${s.aether} aether${s.shards ? ` + ${s.shards} shards` : ""}${s.castsAs ? ` · at your level: ${s.castsAs}` : ""}`);
    }
    el("p", "hint", this.bookEl, "K closes · say \"cast <name>\" to cast by voice");
  }

  /** Active powers: name, time left, spells with their keys and cooldowns. */
  setBuffs(buffs: BuffHud[]): void {
    this.buffsEl.innerHTML = "";
    this.buffsEl.classList.toggle("show", buffs.length > 0);
    for (const b of buffs) {
      const m = Math.floor(b.secondsLeft / 60), s = String(b.secondsLeft % 60).padStart(2, "0");
      el("div", "buff-title", this.buffsEl, `✦ ${b.name} · ${m}:${s}`);
      const fx = b.effects.filter((e) => e !== "giant").map((e) => ({ speed: "+20% speed", flight: "flight (double-tap Space)", night_vision: "night vision", water_breathing: "water breathing" })[e] ?? e);
      if (fx.length) el("div", "buff-effects", this.buffsEl, fx.join(" · "));
      for (const sp of b.spells) {
        const row = el("div", `spell${sp.cooldownLeft > 0 ? " cooling" : ""}`, this.buffsEl);
        el("b", "", row, sp.key);
        el("span", "", row, sp.name);
        if (sp.cooldownLeft > 0) el("i", "", row, `${sp.cooldownLeft.toFixed(sp.cooldownLeft < 2 ? 1 : 0)}s`);
      }
    }
  }

  // ------------------------------------------------------------------ voice

  /** Show the mic button when voice is available, and say how it transcribes. */
  voiceAvailable(provider: "server" | "browser" | null): void {
    this.micEl.hidden = !provider;
    this.micEl.title = provider ? `Hold to speak a command (or hold B) · transcribed by ${provider === "server" ? "the game server" : "your browser"}` : "";
  }

  voiceListening(on: boolean): void {
    this.micEl.classList.toggle("on", on);
    if (!on) return;
    clearTimeout(this.voiceTimer);
    this.voiceEl.className = "voice show listening";
    this.voiceEl.innerHTML = "";
    const top = el("div", "voice-top", this.voiceEl);
    el("span", "voice-dot", top);
    el("span", "", top, "Listening… release B when you're done");
    el("div", "voice-meter", this.voiceEl).appendChild(el("div", "voice-level"));
    el("div", "voice-text", this.voiceEl);
  }

  voiceLevel(v: number): void {
    const lv = this.voiceEl.querySelector(".voice-level") as HTMLElement | null;
    if (lv) lv.style.width = `${Math.round(v * 100)}%`;
  }

  voiceInterim(text: string): void {
    const t = this.voiceEl.querySelector(".voice-text");
    if (t) t.textContent = text ? `“${text}”` : "";
  }

  voiceWorking(): void {
    this.voiceEl.className = "voice show working";
    this.voiceEl.innerHTML = "";
    el("div", "voice-top", this.voiceEl, "Transcribing…");
  }

  /**
   * What was heard and what it will do. With `seconds`, it sends by itself after that
   * long (a bar runs down); without, it waits for Enter.
   */
  voicePending(heard: string, command: string, seconds: number | null): void {
    clearTimeout(this.voiceTimer);
    this.voiceEl.className = "voice show pending";
    this.voiceEl.innerHTML = "";
    el("div", "voice-heard", this.voiceEl, `“${heard}”`);
    el("div", "voice-command", this.voiceEl, command.startsWith("/") ? `→ ${command}` : `→ say in chat: ${command}`);
    el("div", "voice-keys", this.voiceEl, seconds ? `Sending in ${seconds}s · Enter: now · Esc: cancel` : "Enter: send · Esc: cancel");
    if (seconds) {
      const bar = el("div", "voice-countdown", this.voiceEl);
      bar.style.animationDuration = `${seconds}s`;
    }
  }

  voiceDone(note?: string): void {
    clearTimeout(this.voiceTimer);
    if (!note) { this.voiceEl.className = "voice"; return; }
    this.voiceEl.className = "voice show done";
    this.voiceEl.innerHTML = "";
    el("div", "voice-top", this.voiceEl, note);
    this.voiceTimer = window.setTimeout(() => (this.voiceEl.className = "voice"), 1500);
  }

  voiceError(message: string): void {
    clearTimeout(this.voiceTimer);
    this.voiceEl.className = "voice show error";
    this.voiceEl.innerHTML = "";
    el("div", "voice-top", this.voiceEl, `🎤 ${message}`);
    this.voiceTimer = window.setTimeout(() => (this.voiceEl.className = "voice"), 3500);
  }

  /** A ritual nearby: who's leading it, what, how many have joined, and how to join. */
  ritual(r: RitualHud | null): void {
    this.ritualHud = r;
    this.ritualEl.classList.toggle("show", !!r);
    if (!r) return;
    this.ritualEl.innerHTML = "";
    el("div", "ritual-title", this.ritualEl, `✦ ${r.by}'s ritual: ${r.title} (tier ${r.tier})`);
    el("div", "ritual-status", this.ritualEl, `${r.joined.length}/${r.needed} joined${r.joined.length ? ` (${r.joined.join(", ")})` : ""} · ${r.secondsLeft}s`);
    if (r.canJoin) el("div", "ritual-join", this.ritualEl, "Stand in the circle and press J to join");
  }

  /** The running scenario: title, wave, enemies left, a pointer to where it is, and the boss bar. */
  scenario(h: ScenarioHud | null): void {
    this.scenarioHud = h;
    this.scenarioEl.classList.toggle("show", !!h);
    if (!h) return;
    this.scenarioEl.innerHTML = "";
    const top = el("div", "scenario-top", this.scenarioEl);
    el("span", "scenario-title", top, `⚓ ${h.title}`);
    el("span", "scenario-status", top, h.countdown !== undefined ? `${h.status} in ${h.countdown}s` : h.status);
    if (h.enemiesLeft > 0) el("span", "scenario-left", top, `${h.enemiesLeft} left`);
    el("span", "scenario-dir", top);
    if (h.boss) {
      const bar = el("div", "boss", this.scenarioEl);
      el("div", "boss-name", bar, h.boss.name);
      const track = el("div", "boss-track", bar);
      el("div", "boss-fill", track).style.width = `${Math.max(0, Math.min(1, h.boss.health / h.boss.maxHealth)) * 100}%`;
    }
  }

  private raceEl!: HTMLElement;
  private happeningEl!: HTMLElement;

  /** What's happening to the world's rules, and for how much longer (the bar under the top). */
  happening(title: string, left: number, detail: string): void {
    this.happeningEl.classList.toggle("show", !!title);
    if (!title) return;
    const m = Math.floor(left / 60), s = left % 60;
    this.happeningEl.innerHTML = "";
    el("b", "", this.happeningEl, `✦ ${title}`);
    el("span", "", this.happeningEl, ` ${m}:${String(s).padStart(2, "0")} left`);
    this.happeningEl.title = detail;
  }
  private raceCountEl!: HTMLElement;
  private raceState: { next?: [number, number, number]; time: number; running: boolean; at: number } | null = null;

  /** The race HUD: lap, place, time, where the next checkpoint is; the countdown; the results. */
  race(m: Extract<ServerMessage, { t: "race" }>): void {
    const over = m.phase === "over";
    this.raceEl.classList.toggle("show", !over);
    if (over) { this.raceState = null; this.raceCountEl.className = "race-count"; return; }
    const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
    this.raceEl.innerHTML = "";
    const top = el("div", "scenario-top", this.raceEl);
    el("span", "scenario-title", top, `🏁 ${m.title}`);
    if (m.phase === "racing" || m.phase === "finished") {
      el("span", "scenario-status", top, `Lap ${m.lap}/${m.laps}`);
      el("span", "race-place", top, `${ord(m.place)} of ${m.of}`);
      el("span", "race-time", top, formatTime(m.time));
      el("span", "scenario-dir", top);
    } else el("span", "scenario-status", top, m.phase === "countdown" ? "Get ready" : "Drawing the course…");
    this.raceState = { next: m.next, time: m.time, running: m.phase === "racing", at: performance.now() };
    // The big countdown, then GO.
    if (m.phase === "countdown" && m.countdown) { this.raceCountEl.textContent = String(m.countdown); this.raceCountEl.className = "race-count show"; }
    else if (m.phase === "racing" && m.time < 1) { this.raceCountEl.textContent = "GO!"; this.raceCountEl.className = "race-count show go"; }
    else this.raceCountEl.className = "race-count";
    if (m.results) {
      const list = el("div", "race-results", this.raceEl);
      m.results.forEach((r, i) => el("div", "", list, `${i + 1}. ${r.name} ${r.time !== null ? formatTime(r.time) : "—"}`));
    }
  }

  /** Point the scenario arrow at where it's happening (called every frame). */
  updateScenario(x: number, z: number, yaw: number): void {
    // The race arrow: towards the next checkpoint, and the clock ticking between updates.
    const r = this.raceState;
    if (r?.next) {
      const dirEl = this.raceEl.querySelector(".scenario-dir") as HTMLElement | null;
      if (dirEl) {
        const dx = r.next[0] - x, dz = r.next[2] - z;
        const a = Math.atan2(-dx, -dz) - yaw;
        dirEl.innerHTML = `<b style="display:inline-block;transform:rotate(${(-a * 180) / Math.PI}deg)">↑</b> ${Math.round(Math.hypot(dx, dz))} m`;
      }
      const timeEl = this.raceEl.querySelector(".race-time") as HTMLElement | null;
      if (timeEl && r.running) timeEl.textContent = formatTime(r.time + (performance.now() - r.at) / 1000);
    }
    const h = this.scenarioHud;
    if (!h) return;
    const dirEl = this.scenarioEl.querySelector(".scenario-dir") as HTMLElement | null;
    if (!dirEl) return;
    const dx = h.at[0] - x, dz = h.at[2] - z, d = Math.hypot(dx, dz);
    if (d < 12) { dirEl.textContent = "here"; return; }
    // Screen angle: 0 = straight ahead (yaw 0 faces -Z).
    const a = Math.atan2(-dx, -dz) - yaw;
    dirEl.innerHTML = `<b style="display:inline-block;transform:rotate(${(-a * 180) / Math.PI}deg)">↑</b> ${Math.round(d)} m`;
  }

  worldEvent(e: WorldEventNotice): void {
    const icon = { gathering: "✦", arrival: "⚡", fizzle: "✧", undo: "⟲" }[e.phase];
    this.bannerEl.className = `banner show ${e.phase}`;
    this.bannerEl.innerHTML = "";
    el("div", "banner-title", this.bannerEl, `${icon} ${e.title}`);
    el("div", "banner-by", this.bannerEl, e.phase === "gathering"
      ? `${e.by} is changing the world${e.seconds ? ` · arrives in ${Math.round(e.seconds)}s` : "…"}`
      : `by ${e.by}`);
    if (e.detail) el("div", "banner-detail", this.bannerEl, e.detail);
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove("show"), 6000);
    this.addChat(`${icon} ${e.title} — ${e.by}${e.detail ? ` (${e.detail})` : ""}`, "event");
  }

  // ------------------------------------------------------------------ windows

  get windowOpen(): boolean {
    return !!this.window;
  }

  setWindow(w: WindowSnapshot | null, cursor: Slot): void {
    this.window = w;
    this.cursor = cursor;
    this.windowEl.hidden = !w;
    this.fillSlot(this.cursorEl, cursor);
    if (!w) this.tooltipEl.hidden = true;
    this.renderWindow();
  }

  private renderWindow(): void {
    const w = this.window;
    this.windowEl.innerHTML = "";
    if (!w) return;
    const panel = el("div", `window ${w.kind}`, this.windowEl);
    const title = { inventory: "Inventory", crafting: "Crafting Table", chest: "Chest", furnace: "Furnace" }[w.kind];
    el("div", "window-title", panel, title);
    let base = 0;
    const sectionEls = new Map<string, HTMLElement>();
    const indexOf = new Map<string, number>();
    for (const s of w.sections) {
      indexOf.set(s.id, base);
      base += s.slots.length;
    }
    const grid = (id: string, cols: number, cls = "") => {
      const s = w.sections.find((x) => x.id === id);
      if (!s) return el("div");
      const g = el("div", `grid ${cls}`);
      g.style.gridTemplateColumns = `repeat(${cols}, var(--slot))`;
      s.slots.forEach((st, i) => {
        const c = el("div", "slot", g);
        this.fillSlot(c, st);
        const idx = indexOf.get(id)! + i;
        c.onmousedown = (e) => {
          e.preventDefault();
          this.cb.click(idx, e.button === 2 ? 1 : 0, e.shiftKey);
        };
        c.oncontextmenu = (e) => e.preventDefault();
        c.onmouseenter = () => this.showTooltip(st);
        c.onmouseleave = () => (this.tooltipEl.hidden = true);
      });
      sectionEls.set(id, g);
      return g;
    };

    const top = el("div", "window-top", panel);
    if (w.kind === "inventory" || w.kind === "crafting") {
      const craft = grid("craft", w.kind === "crafting" ? 3 : 2);
      top.appendChild(craft);
      el("div", "arrow", top, "➜");
      top.appendChild(grid("result", 1, "result"));
    } else if (w.kind === "chest") {
      top.appendChild(grid("chest", 9));
    } else if (w.kind === "furnace") {
      const col = el("div", "furnace-col", top);
      col.appendChild(grid("input", 1));
      const flame = el("div", "flame", col);
      flame.style.setProperty("--p", String(w.fuel ?? 0));
      col.appendChild(grid("fuel", 1));
      const arrow = el("div", "progress", top);
      arrow.style.setProperty("--p", String(w.progress ?? 0));
      top.appendChild(grid("output", 1, "result"));
    }

    if (w.kind === "inventory" && this.self?.gameMode === "creative") {
      const pal = el("div", "creative", panel);
      el("div", "window-sub", pal, "All items — click: stack · right click: one");
      const g = el("div", "grid palette", pal);
      g.style.gridTemplateColumns = `repeat(9, var(--slot))`;
      for (const item of this.reg.items) {
        const c = el("div", "slot", g);
        this.fillSlot(c, { item: item.id, count: 1 });
        c.querySelector(".count")?.remove();
        c.onmousedown = (e) => {
          e.preventDefault();
          this.cb.creativePick(item.id, e.button === 2 ? 1 : item.maxStack);
        };
        c.oncontextmenu = (e) => e.preventDefault();
        c.onmouseenter = () => this.showTooltip({ item: item.id, count: 1 });
        c.onmouseleave = () => (this.tooltipEl.hidden = true);
      }
    }

    el("div", "window-sub", panel, "Inventory");
    panel.appendChild(grid("main", 9));
    const hb = grid("hotbar", 9, "hotbar-row");
    panel.appendChild(hb);
  }

  private showTooltip(st: Slot): void {
    if (!st) { this.tooltipEl.hidden = true; return; }
    const def = this.reg.itemById(st.item);
    if (!def) return;
    this.tooltipEl.hidden = false;
    let text = def.displayName;
    if (def.tool && st.durability !== undefined) text += `  (${st.durability}/${def.tool.durability})`;
    if (def.food) text += `  · restores ${def.food / 2} 🍗`;
    this.tooltipEl.textContent = text;
  }

  private fillSlot(c: HTMLElement, st: Slot | ItemStack): void {
    c.innerHTML = "";
    if (!st) return;
    const img = el("img", "icon", c);
    img.src = this.atlas.icon(st.item);
    img.draggable = false;
    if (st.count > 1) el("span", "count", c, String(st.count));
    const def = this.reg.itemById(st.item);
    if (def?.tool && st.durability !== undefined && st.durability < def.tool.durability) {
      const bar = el("div", "durability", c);
      const f = st.durability / def.tool.durability;
      bar.style.setProperty("--d", String(f));
      bar.style.setProperty("--c", f > 0.5 ? "#4caf50" : f > 0.2 ? "#e0b030" : "#e04030");
    }
  }
}

function loadSettings(): Settings {
  const d: Settings = { fov: 75, sensitivity: 1, volume: 0.6, renderDistance: 120, reducedMotion: false, voice: "auto", voiceConfirm: false, effects: true, shadows: true };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem("lfg2.settings") ?? "{}") };
  } catch {
    return d;
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem("lfg2.settings", JSON.stringify(s));
  } catch {
    /* storage may be unavailable */
  }
}

/** 83.4 → "1:23.4" */
function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}
