import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { ProgressionService } from "./progression";

/**
 * Starting out, and playing together.
 *
 *   first steps   a short checklist for someone new to a world (look around, summon something,
 *                 imagine something if the server can, invite a friend, play together), with a
 *                 little XP for each; shown in the corner until it's done (/steps hides or shows it)
 *   invites       a friend who comes in through your invite link (/invite) arrives next to you;
 *                 everyone hears who invited them, and the first time, you both get XP
 *
 * Other modules tick steps off through the "firststeps" service: mark(player, id).
 */
export interface FirstSteps { mark(p: Player, id: StepId): void }
type StepId = "walk" | "summon" | "imagine" | "invite" | "friend";
interface StepsState { done: StepId[]; start: [number, number]; hidden?: boolean; rewards?: { day: string; n: number } }

const STEP_XP = 25, ALL_DONE_XP = 50, INVITER_XP = 100, INVITED_XP = 50, INVITER_REWARDS_PER_DAY = 5;

export const social: ServerModule = {
  id: "social", name: "Social", version: "1.0.0", author: "LFG2",
  description: "First steps for new players, and invites that bring friends to you",
  setup(api) {
    const imagineOn = () => !!api.use<{ enabled: boolean }>("imagine:status")?.enabled;
    const steps = (): { id: StepId; label: string; hint: string }[] => [
      { id: "walk", label: "Look around", hint: "Walk 20 blocks: WASD to move, the mouse to look" },
      { id: "summon", label: "Summon a creature", hint: "Press T and type /summon a fox (or hold B and say it)" },
      ...(imagineOn() ? [{ id: "imagine" as const, label: "Imagine something new", hint: "/imagine and describe anything: Claude designs it" }] : []),
      { id: "invite", label: "Invite a friend", hint: "Esc → Invite friends, or type /invite" },
      { id: "friend", label: "Play together", hint: "A friend joins with your link and arrives next to you" },
    ];
    const state = (p: Player): StepsState => {
      const d = p.data as { firstSteps?: StepsState };
      return (d.firstSteps ??= { done: [], start: [p.entity.x, p.entity.z] });
    };
    const send = (p: Player) => {
      const s = state(p), list = steps();
      const all = list.every((x) => s.done.includes(x.id));
      p.send({ t: "steps", steps: s.hidden || all ? null : list.map((x) => ({ ...x, done: s.done.includes(x.id) })) });
    };
    const prog = () => api.use<ProgressionService>("progression");
    const mark = (p: Player, id: StepId) => {
      const s = state(p);
      if (s.done.includes(id) || !steps().some((x) => x.id === id)) return;
      s.done.push(id);
      const label = steps().find((x) => x.id === id)!.label;
      prog()?.award(p, STEP_XP, `first steps: ${label.toLowerCase()}`);
      if (steps().every((x) => s.done.includes(x.id))) {
        prog()?.award(p, ALL_DONE_XP, "first steps done");
        api.tell(p, "✔ First steps done! The world is yours: build, summon, and bring friends.");
      }
      send(p);
    };
    api.provide("firststeps", { mark } satisfies FirstSteps);

    const friends = () => api.use<{ areFriends(a: string, b: string): boolean; presence(n: string): { world: string; title: string } | null }>("friends");
    api.on("player:join", ({ player, firstTime, invitedBy, near }) => {
      const s = state(player);
      if (firstTime) s.start = [player.entity.x, player.entity.z];
      send(player);
      // Joining a friend (from the friends list): arrive next to them.
      const buddy = !invitedBy && near ? api.playerByName(near) : undefined;
      if (buddy && buddy !== player && friends()?.areFriends(player.name, buddy.name)) {
        const [x, y, z] = besideOf(buddy.entity.x, buddy.entity.y, buddy.entity.z);
        api.teleport(player, x, y, z);
        api.tell(player, `You're next to ${buddy.name}`);
        api.tell(buddy, `★ ${player.name} came to join you`);
      }
      if (!invitedBy) {
        if (firstTime) api.tell(player, `Welcome, ${player.name}! Your first steps are in the corner. Press H for the controls.`);
        return;
      }
      const host = api.playerByName(invitedBy);
      if (host && !host.dead) {
        // Arrive next to the friend who invited you: a free spot beside them (room to stand, ground
        // underfoot), or right where they are if there's none.
        const [x, y, z] = besideOf(host.entity.x, host.entity.y, host.entity.z);
        api.teleport(player, x, y, z);
        api.tell(player, `${host.name} invited you: you're right next to them`);
        api.tell(host, `${player.name} came with your invite link and is right next to you`);
      } else api.tell(player, `${invitedBy} invited you; they aren't here right now. Welcome!`);
      api.broadcast(`🎉 ${player.name} joined, invited by ${invitedBy}`, "event");
      if (firstTime) {
        prog()?.award(player, INVITED_XP, `came with ${invitedBy}'s invite`);
        if (host) {
          const hs = state(host), day = new Date().toISOString().slice(0, 10);
          if (hs.rewards?.day !== day) hs.rewards = { day, n: 0 };
          if (hs.rewards.n < INVITER_REWARDS_PER_DAY) { hs.rewards.n++; prog()?.award(host, INVITER_XP, `${player.name} joined with your invite`); }
          mark(host, "friend");
        }
      }
    });

    const free = (x: number, y: number, z: number) => !api.table.solid[api.world.getBlock(x, y, z)] && !api.table.liquid[api.world.getBlock(x, y, z)];
    function besideOf(hx: number, hy: number, hz: number): [number, number, number] {
      const start = api.rand() * Math.PI * 2;
      for (const r of [2, 1.5, 3]) for (let k = 0; k < 8; k++) {
        const a = start + (k / 8) * Math.PI * 2;
        const x = Math.floor(hx + Math.cos(a) * r), z = Math.floor(hz + Math.sin(a) * r);
        for (const dy of [0, 1, -1]) {
          const y = Math.floor(hy) + dy;
          if (free(x, y, z) && free(x, y + 1, z) && api.table.solid[api.world.getBlock(x, y - 1, z)]) return [x + 0.5, y, z + 0.5];
        }
      }
      return [hx, hy, hz];
    }

    // Walking about ticks off the first step.
    api.every(1, () => {
      for (const p of api.players()) {
        const s = state(p);
        if (!s.done.includes("walk") && Math.hypot(p.entity.x - s.start[0], p.entity.z - s.start[1]) >= 20) mark(p, "walk");
      }
    });

    // Going to a friend in this world.
    const lastVisit = new Map<string, number>();
    api.command({
      name: "visit",
      usage: "/visit <friend>",
      help: "Go to a friend who's in this world",
      admin: false,
      run(p, [who]) {
        if (!p) return "Players only";
        if (!who) return "Usage: /visit <friend>";
        const f = friends();
        if (!f?.areFriends(p.name, who)) return `${who} isn't your friend (/friend ${who} to ask)`;
        const them = api.playerByName(who);
        if (!them) {
          const at = f.presence(who);
          return at ? `${who} is in ${at.title}: use the friends list (Esc) to go there` : `${who} isn't online`;
        }
        const since = (Date.now() - (lastVisit.get(p.name) ?? 0)) / 1000;
        if (since < 20) return `You can visit again in ${Math.ceil(20 - since)} s`;
        lastVisit.set(p.name, Date.now());
        const [x, y, z] = besideOf(them.entity.x, them.entity.y, them.entity.z);
        api.teleport(p, x, y, z);
        api.tell(them, `★ ${p.name} came to see you`);
        return `You're next to ${them.name}`;
      },
    });

    api.command({
      name: "steps",
      usage: "/steps",
      help: "Show or hide your first steps",
      admin: false,
      run(p) {
        if (!p) return "Players only";
        const s = state(p);
        s.hidden = !s.hidden;
        send(p);
        return s.hidden ? "First steps hidden (/steps shows them again)" : "First steps shown";
      },
    });
  },
};
