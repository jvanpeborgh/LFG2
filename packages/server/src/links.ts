import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writeAtomic } from "./world";

/**
 * Linking a player to an outside tool (the MCP server, used from ChatGPT,
 * Claude…): the player types /link in game and gets a short one-time code;
 * the tool redeems it for a token that acts for that player, in that world
 * only. Tokens are stored hashed and can be revoked with /unlink.
 */
export interface Link {
  world: string;
  player: string;
}

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const CODE_TTL_MS = 10 * 60 * 1000;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export class LinkRegistry {
  private codes = new Map<string, Link & { expires: number }>();
  private tokens = new Map<string, Link & { created: string }>();

  constructor(private file: string | null) {
    if (file && existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, Link & { created: string }>;
        for (const [h, l] of Object.entries(saved)) this.tokens.set(h, l);
      } catch { /* start fresh */ }
    }
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeAtomic(this.file, JSON.stringify(Object.fromEntries(this.tokens)));
  }

  /** A new one-time code for a player (replaces any unused code of theirs). */
  newCode(link: Link): string {
    for (const [c, l] of this.codes) if (l.world === link.world && l.player === link.player) this.codes.delete(c);
    let code = "";
    do code = Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
    while (this.codes.has(code));
    this.codes.set(code, { ...link, expires: Date.now() + CODE_TTL_MS });
    return `${code.slice(0, 3)}-${code.slice(3)}`;
  }

  /** Redeem a code for a token (codes work once, for 10 minutes). */
  redeem(code: string): (Link & { token: string }) | null {
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const l = this.codes.get(c);
    this.codes.delete(c);
    if (!l || l.expires < Date.now()) return null;
    const token = randomBytes(24).toString("base64url");
    this.tokens.set(hash(token), { world: l.world, player: l.player, created: new Date().toISOString() });
    this.save();
    return { world: l.world, player: l.player, token };
  }

  resolve(token: string): Link | null {
    const l = this.tokens.get(hash(token));
    return l ? { world: l.world, player: l.player } : null;
  }

  /** Revoke every token of a player in a world. */
  revoke(link: Link): number {
    let n = 0;
    for (const [h, l] of this.tokens) if (l.world === link.world && l.player.toLowerCase() === link.player.toLowerCase()) { this.tokens.delete(h); n++; }
    if (n) this.save();
    return n;
  }
}
