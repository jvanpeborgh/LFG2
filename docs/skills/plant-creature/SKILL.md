---
name: lfg2-plant-creature
description: Design a plant creature for LFG2 as a shape (parts of primitives). Living plants: mushrooms, treants, cacti, flower creatures.
---

# Plant creature

Living plants: mushrooms, treants, cacti, flower creatures.

## How to make one

- A face low on the stem or trunk (glowing eyes in bark for treants).
- Spots on caps; leaf clusters as overlapping ellipsoids.

## Parts and animation roles

- `body` (required): a stem or trunk; the cap or crown is the silhouette
- `legL`: stubby feet or roots
- `armL`: branches, for trees

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
 "blend": 0.05,
 "parts": [
  {
   "name": "body",
   "anim": "body",
   "shapes": [
    {
     "type": "capsule",
     "at": [
      0,
      0.55,
      0
     ],
     "size": [
      0.6,
      0.9,
      0.6
     ],
     "taper": 0.85,
     "color": "belly"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.15,
      0
     ],
     "size": [
      1.4,
      0.75,
      1.4
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.95,
      0
     ],
     "size": [
      1.25,
      0.2,
      1.25
     ],
     "color": "belly",
     "cut": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0.35,
      1.38,
      0.2
     ],
     "size": [
      0.2,
      0.1,
      0.2
     ],
     "color": "neutral8",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.5,
      -0.15
     ],
     "size": [
      0.24,
      0.1,
      0.24
     ],
     "color": "neutral8"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.15,
      1.3,
      -0.45
     ],
     "size": [
      0.18,
      0.1,
      0.18
     ],
     "color": "neutral8",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0.11,
      0.65,
      0.28
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
      0.1244,
      0.65,
      0.316
     ],
     "size": [
      0.066,
      0.078,
      0.048
     ],
     "color": "neutral1",
     "mirror": true
    }
   ]
  },
  {
   "name": "foot",
   "anim": "legL",
   "mirror": true,
   "pivot": [
    0.15,
    0.2,
    0
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0.16,
      0.08,
      0.06
     ],
     "size": [
      0.22,
      0.16,
      0.3
     ],
     "color": "belly"
    }
   ]
  }
 ]
}
```
