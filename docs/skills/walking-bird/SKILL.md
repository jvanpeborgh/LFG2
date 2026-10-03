---
name: lfg2-walking-bird
description: Design a walking bird for LFG2 as a shape (parts of primitives). Birds that walk more than they fly: penguins, chickens, ducks, flamingos.
---

# Walking bird

Birds that walk more than they fly: penguins, chickens, ducks, flamingos.

## How to make one

- Upright and round; the beak and feet in the accent colour.
- It waddles: short legs, a body that rolls side to side.

## Parts and animation roles

- `body` (required): an egg-shaped upright body with a pale front
- `head` (required): round, with a beak (a cone pointing forward)
- `legL` (required): short legs with flat feet (mirror)
- `wingL`: small wings at the sides (mirror) that flap when it hurries

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- (no special notes)

## The loop

1. `interpret_prompt` with the player's words: you get a brief (skill, mood, style, size, colours, what must read from 20 m) and a starting design from this skill's template.
2. Change the starting design to fit the request: proportions for the mood first, then the features that must read, then colours and finishes.
3. `check_design` with the prompt: rule checks must pass; the critique scores it against this skill.
4. `render_design` (try `style: "sculpted"` for the close-up look) and compare with the brief. Fix, repeat.
5. `save_design`.

## Starting shape

```json
{
 "parts": [
  {
   "name": "body",
   "anim": "body",
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.75,
      0
     ],
     "size": [
      0.8,
      1.1,
      0.75
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.7,
      0.14
     ],
     "size": [
      0.6,
      0.9,
      0.52
     ],
     "color": "belly"
    }
   ]
  },
  {
   "name": "head",
   "anim": "head",
   "pivot": [
    0,
    1.2,
    0
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.42,
      0.04
     ],
     "size": [
      0.52,
      0.5,
      0.5
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.12,
      1.5,
      0.22
     ],
     "size": [
      0.12,
      0.132,
      0.08399999999999999
     ],
     "color": "neutral8",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0.1344,
      1.5,
      0.256
     ],
     "size": [
      0.066,
      0.078,
      0.048
     ],
     "color": "neutral1",
     "mirror": true
    },
    {
     "type": "cone",
     "axis": "z",
     "at": [
      0,
      1.38,
      0.38
     ],
     "size": [
      0.14,
      0.1,
      0.24
     ],
     "color": "accent"
    }
   ]
  },
  {
   "name": "wing",
   "anim": "wingL",
   "mirror": true,
   "pivot": [
    0.36,
    1,
    0
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0.42,
      0.75,
      -0.02
     ],
     "size": [
      0.12,
      0.62,
      0.42
     ],
     "rotate": [
      0,
      0,
      10
     ],
     "color": "main"
    }
   ]
  },
  {
   "name": "leg",
   "anim": "legL",
   "mirror": true,
   "pivot": [
    0.16,
    0.28,
    0
   ],
   "shapes": [
    {
     "type": "cylinder",
     "at": [
      0.16,
      0.14,
      0
     ],
     "size": [
      0.07,
      0.28,
      0.07
     ],
     "color": "accent"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.16,
      0.02,
      0.08
     ],
     "size": [
      0.2,
      0.05,
      0.24
     ],
     "color": "accent"
    }
   ]
  }
 ]
}
```
