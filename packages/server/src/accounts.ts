import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeAtomic } from "./world";

/**
 * Names, kept by the people who chose them. There are no passwords: the browser makes a secret key
 * the first time it plays and keeps it; the first key to play a name claims it, and from then on
 * that name needs one of its keys (so nobody else can turn up as a world's owner). Another device
 * signs in with a one-time code from /device. Keys are stored hashed.
 */
export interface Account {
  name: string;
  keys: string[];
  created: string;
  /** Who invited them (their first invite), for the "a friend joined" reward. */
  invitedBy?: string;
  lastWorld?: string;
  /** Friends (both ways), and friend requests waiting for this player's answer. */
  friends?: string[];
  requests?: string[];
}

const MAX_FRIENDS = 200;

const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_KEYS = 6;

export class Accounts {
  private byName = new Map<string, Account>();
  private codes = new Map<string, { name: string; expires: number }>();

  constructor(private file: string | null) {
    if (file && existsSync(file)) {
      try { for (const a of JSON.parse(readFileSync(file, "utf8")) as Account[]) this.byName.set(a.name.toLowerCase(), a); } catch { /* start fresh */ }
    }
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeAtomic(this.file, JSON.stringify([...this.byName.values()]));
  }

  get(name: string): Account | undefined {
    return this.byName.get(name.toLowerCase());
  }

  /** Whether this key may play this name. */
  verify(name: string, key: string | undefined): boolean {
    const a = this.get(name);
    return !!a && !!key && a.keys.includes(hash(key));
  }

  /**
   * May `key` play `name`? A free name is claimed by the key (when there is one); a claimed name
   * needs one of its keys. Returns why not, or null.
   */
  admit(name: string, key: string | undefined): string | null {
    const a = this.get(name);
    if (!a) {
      if (key && key.length >= 16 && key.length <= 128) {
        this.byName.set(name.toLowerCase(), { name, keys: [hash(key)], created: new Date().toISOString() });
        this.save();
      }
      return null;
    }
    if (key && a.keys.includes(hash(key))) return null;
    return `The name ${a.name} belongs to someone else. If it's yours, use "Sign in with a code" (type /device where you already play) or pick another name`;
  }

  /** A one-time code to sign this name in on another device (replaces any unused code). */
  signinCode(name: string): string {
    for (const [c, v] of this.codes) if (v.name.toLowerCase() === name.toLowerCase()) this.codes.delete(c);
    let code = "";
    for (let i = 0; i < 6; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
    this.codes.set(code, { name, expires: Date.now() + CODE_TTL_MS });
    return code;
  }

  /** Redeem a sign-in code: a new key for that name on this device. */
  redeem(code: string): { name: string; key: string } | null {
    const c = this.codes.get(code.trim().toUpperCase());
    this.codes.delete(code.trim().toUpperCase());
    if (!c || c.expires < Date.now()) return null;
    const a = this.get(c.name);
    if (!a) return null;
    const key = randomBytes(24).toString("base64url");
    a.keys = [...a.keys, hash(key)].slice(-MAX_KEYS);
    this.save();
    return { name: a.name, key };
  }

  /** Remember who invited a player (the first invite only). Returns true if this was the first. */
  setInvitedBy(name: string, by: string): boolean {
    const a = this.get(name);
    if (!a || a.invitedBy || by.toLowerCase() === name.toLowerCase()) return false;
    a.invitedBy = by;
    this.save();
    return true;
  }

  // ---------------------------------------------------------------- friends
  /** Their friends (display names). */
  friendsOf(name: string): string[] {
    return (this.get(name)?.friends ?? []).map((n) => this.get(n)?.name ?? n);
  }
  requestsOf(name: string): string[] {
    return (this.get(name)?.requests ?? []).map((n) => this.get(n)?.name ?? n);
  }
  areFriends(a: string, b: string): boolean {
    return !!this.get(a)?.friends?.includes(b.toLowerCase());
  }
  /** Make two players friends (both ways), clearing any requests between them. */
  befriend(a: string, b: string): boolean {
    const A = this.get(a), B = this.get(b);
    if (!A || !B || A === B || this.areFriends(a, b)) return false;
    if ((A.friends?.length ?? 0) >= MAX_FRIENDS || (B.friends?.length ?? 0) >= MAX_FRIENDS) return false;
    A.friends = [...(A.friends ?? []), b.toLowerCase()];
    B.friends = [...(B.friends ?? []), a.toLowerCase()];
    A.requests = (A.requests ?? []).filter((n) => n !== b.toLowerCase());
    B.requests = (B.requests ?? []).filter((n) => n !== a.toLowerCase());
    this.save();
    return true;
  }
  /**
   * Ask to be friends. If they'd already asked you, you're friends now. Returns what happened, or
   * why not.
   */
  request(from: string, to: string): "sent" | "friends" | "already" | string {
    const A = this.get(from), B = this.get(to);
    if (!B) return `nobody called ${to} has played here`;
    if (!A) return "your name isn't kept yet; rejoin from the title screen";
    if (A === B) return "that's you";
    if (this.areFriends(from, to)) return "already";
    if (A.requests?.includes(to.toLowerCase())) { this.befriend(from, to); return "friends"; }
    if (!B.requests?.includes(from.toLowerCase())) {
      B.requests = [...(B.requests ?? []), from.toLowerCase()].slice(-50);
      this.save();
    }
    return "sent";
  }
  unfriend(a: string, b: string): boolean {
    const A = this.get(a), B = this.get(b);
    if (!A || !B || !this.areFriends(a, b)) return false;
    A.friends = A.friends!.filter((n) => n !== b.toLowerCase());
    B.friends = (B.friends ?? []).filter((n) => n !== a.toLowerCase());
    this.save();
    return true;
  }
  decline(name: string, from: string): boolean {
    const A = this.get(name);
    if (!A?.requests?.includes(from.toLowerCase())) return false;
    A.requests = A.requests.filter((n) => n !== from.toLowerCase());
    this.save();
    return true;
  }

  setLastWorld(name: string, world: string): void {
    const a = this.get(name);
    if (!a || a.lastWorld === world) return;
    a.lastWorld = world;
    this.save();
  }
}
