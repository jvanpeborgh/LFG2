# Creature loot: gear made from what you defeat

Everything players imagine can now drop **gear made from itself**:
- a red dragon's scales become an *Emberscale Helm*;
- a shark's tooth becomes *Sharkfang*;
- a ghost leaves a *Wraith Lantern*.

The gear looks like the creature (its colours, its pattern) and wears its powers (fire resistance
from a fire creature, water breathing from a fish, lighter falls from a bird). Its lore names the
creature, who imagined it and who brought it down. How good it is depends on how strong the
creature was and how experienced the player is.

## How it works

**When it drops.** A creature that fights (hostile, or neutral and provoked) has a chance to drop
something when a player defeats it. The chance:
- grows with its tier;
- is certain from bosses, which drop two pieces;
- is small from passive creatures (a trophy, never armour, so pets aren't hunted for loot).

**What it is.** Read from the creature's spec:

| The creature has… | It gives… |
| --- | --- |
| scales (fish, dragons, serpents, lizards) | scale armour |
| fur or hide (most four-legged things) | hide armour |
| a shell (crabs, turtles, snails, beetles) | shell helm and plate |
| feathers (birds, griffins) | a plume cloak (chest) and boots |
| bones (skeletons) | bone armour |
| metal (robots, knights, golems) | steel armour |
| spirit (ghosts, wraiths) | a lantern charm |
| teeth or a bite | a fang sword |
| horns or tusks | a horn spear |
| a breath or a shot | a staff of its element |

**How good.** Its *level* is the creature's tier and the player's level, averaged. *Rarity* is
rolled with the level tipping the odds:

| Rarity | Stat multiplier |
| --- | --- |
| common | ×1.0 |
| uncommon | ×1.15 |
| rare | ×1.3 |
| epic | ×1.5 |
| legendary | ×1.8 |

- **Armour** gives defence; the whole set together blocks at most 60% of a hit.
- **Weapons** give damage, never more than one hit's cap.

**Its powers (perks)** come from what the creature is. Each piece carries one or two:

| From | Perk |
| --- | --- |
| a fire, frost, poison or lightning element | resistance to it (armour) or burning, chilling or shocking hits (weapons) |
| swimmers | water breathing (helm) |
| flyers | lighter falls (boots, chest) |
| fast or hopping creatures | swiftness or spring (legs, boots) |
| big, heavy creatures | sturdiness (less knockback, more defence) |
| nocturnal creatures | night eyes (helm) |
| glowing creatures | light (charm) |

**What it looks like.**
- The item's icon is its kind's shape (helm, plate, legs, boots, sword, spear, staff, lantern),
  painted in the creature's main and accent colours.
- Worn armour shows on the player model in those colours: a helm, a chest plate, leg guards,
  boots. Everyone sees it.
- The rarity colours the name: white, green, blue, purple or gold.

**Its lore.** Two lines:
1. Where it came from: "Shed by Mira's Red Dragon, felled by Rex on day 12."
2. A line of flavour from what the creature is: "Still warm to the touch."

The agent writes richer lore later, the same way it designs creatures.

**Sets.** Pieces from the same creature, imagined by the same player, add up when worn together:

| Pieces | Bonus |
| --- | --- |
| 2 | +20% defence from the set |
| 3 | every perk of the set works for all of it |
| 4 (head to feet) | sturdy, and that creature's own weapon hits 20% harder (never past one hit's cap) |

**Salvage.** `/salvage` breaks the piece in your hand down into aether:
(2 + level × 0.8) × 1 (common), 1.5 (uncommon), 2.5 (rare), 4 (epic) or 7 (legendary). It needs
room in your aether to take it.

**Wearing it.** Right-click with a piece in hand to put it on (what you wore goes back in your
hand). `/gear` shows what you wear and your totals; `/gear off <slot>` takes a piece off. Gear is
saved with the player and can be gifted (`/gift`) like anything else.

## Build steps

1. **Data:**
   - `ItemStack.meta` (a gear record: name, rarity, level, slot, look, stats, perks, lore,
     source);
   - base items for each kind (unstackable);
   - `rollCreatureLoot` in shared, with tests.
2. **Server:**
   - drops on death;
   - equipment slots saved with the player;
   - equip on use, `/gear`;
   - armour reduces damage, weapons use their damage and element;
   - perks apply (speed, water breathing, night vision, light falls, resistances).
3. **Client:**
   - tinted icons;
   - tooltips with the rarity-coloured name, stats, perks and lore;
   - worn armour on the player models (yours in third person, and everyone else's).
4. **Later:**
   - the designer agent writes lore and can design a piece's look as a shape;
   - set bonuses for a full set from one creature (done);
   - salvaging gear for aether (done);
   - trading.
