import { describe, expect, it } from "vitest";
import { interpretVoice } from "../src/index";

const said = (t: string) => interpretVoice(t)?.text;

describe("voice commands", () => {
  it("turns spoken summons into /summon", () => {
    expect(said("Summon a huge kraken.")).toBe("/summon a huge kraken");
    expect(said("Can you summon a flying shark, please?")).toBe("/summon a flying shark");
    expect(said("Um, conjure three angry wolves")).toBe("/summon three angry wolves");
    expect(said("Bring forth a big cloud!")).toBe("/summon a big cloud");
    expect(said("Let's summon a swarm of pirate ships that attack the coast in waves with bosses")).toBe("/summon a swarm of pirate ships that attack the coast in waves with bosses");
  });

  it("understands rituals, joining, events and stopping", () => {
    expect(said("Start a ritual to summon a red dragon")).toBe("/ritual a red dragon");
    expect(said("Ritual: a huge kraken")).toBe("/ritual a huge kraken");
    expect(said("Join the ritual!")).toBe("/join");
    expect(said("I'll join")).toBe("/join");
    expect(said("Start an event where vikings raid the coast in three waves")).toBe("/event vikings raid the coast in three waves");
    expect(said("Stop the raid.")).toBe("/event stop");
    expect(said("Unsummon my creatures")).toBe("/unsummon");
    expect(said("What's my level?")).toBe("/progress");
    expect(said("slash summon a pig")).toBe("/summon a pig");
    expect(said("Make me a wizard!")).toBe("/summon become a wizard");
    expect(said("How much would a huge kraken cost?")).toBe("/cost a huge kraken");
    expect(said("What would summoning a village cost?")).toBe("/cost a village");
    expect(said("I want to fly")).toBe("/summon give me the power to fly");
  });

  it("leaves anything else as chat, as it was said", () => {
    const i = interpretVoice("Nice castle, Bob!")!;
    expect(i.kind).toBe("chat");
    expect(i.text).toBe("Nice castle, Bob!");
    expect(interpretVoice("   ")).toBeNull();
  });
});
