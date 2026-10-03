/**
 * Voice: turning what a player said into what they meant. Speech recognisers
 * return natural sentences ("Summon a huge kraken, please."), so this maps
 * them onto the game's commands, and leaves anything else as a chat message.
 * Shared so it can be tested without a microphone.
 */

export interface VoiceIntent {
  /** What gets sent: a /command or a chat line. */
  text: string;
  kind: "summon" | "event" | "ritual" | "join" | "unsummon" | "stop" | "progress" | "chat";
  /** What was heard, tidied up. */
  heard: string;
}

/** Words that steer the recogniser towards the game's vocabulary (sent as a hint where supported). */
export const VOICE_HINT =
  "Voice commands in a block-building game: summon a flying shark, summon a big cloud, a huge kraken, a red dragon, " +
  "a pirate raid in five waves with bosses, start a ritual, join the ritual, unsummon, stop the event.";

const POLITE = /\b(please|now|for me|thanks|thank you|okay|ok|um+|uh+|hey|could you|can you|would you|i want to|i'd like to|let's|lets)\b/g;

/** Tidy a transcript: lower case, no trailing punctuation or filler. */
export function tidyTranscript(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/[.!?,;:]+/g, " ")
    .replace(POLITE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function interpretVoice(raw: string): VoiceIntent | null {
  const heard = tidyTranscript(raw);
  if (!heard) return null;
  const rest = (re: RegExp) => heard.replace(re, "").trim();
  let m: RegExpMatchArray | null;
  if (/^(join|join (the|this|that) ritual|i'?ll join|count me in)$/.test(heard)) return { kind: "join", text: "/join", heard };
  if (/^(unsummon|dismiss|send away|remove) (my |all my )?(summons?|creatures?|them|it|everything)?$/.test(heard) || heard === "unsummon")
    return { kind: "unsummon", text: "/unsummon", heard };
  if (/^(stop|end|cancel|call off) (the )?(event|raid|invasion|scenario|attack)$/.test(heard)) return { kind: "stop", text: "/event stop", heard };
  if (/^(what'?s my level|my level|show (my )?progress|progress|how much aether( do i have)?)$/.test(heard)) return { kind: "progress", text: "/progress", heard };
  if ((m = heard.match(/^(?:start |begin |perform |do )?(?:a |the )?ritual(?: to| and)? (?:summon |call |conjure |bring )?(.+)$/))) return { kind: "ritual", text: `/ritual ${m[1]}`, heard };
  if ((m = heard.match(/^(?:start |begin |launch |trigger )(?:an? |the )?(?:event|scenario)(?: where| of| with)? (.+)$/))) return { kind: "event", text: `/event ${m[1]}`, heard };
  if ((m = heard.match(/^(?:event|scenario) (.+)$/))) return { kind: "event", text: `/event ${m[1]}`, heard };
  if ((m = heard.match(/^(?:summon|conjure|spawn|call forth|call|bring forth|bring me|bring|create|make|give me) (.+)$/))) {
    const what = m[1].replace(/^(up|in|forth) /, "");
    return { kind: "summon", text: `/summon ${what}`, heard };
  }
  // A typed slash command spoken out loud ("slash summon a pig").
  if ((m = heard.match(/^slash (\w+)(?: (.*))?$/))) return { kind: m[1] === "summon" ? "summon" : "chat", text: `/${m[1]}${m[2] ? ` ${m[2]}` : ""}`, heard };
  // Otherwise it's something to say in chat (keep the original capitalisation).
  return { kind: "chat", text: raw.trim().replace(/\s+/g, " ").slice(0, 256), heard };
}
