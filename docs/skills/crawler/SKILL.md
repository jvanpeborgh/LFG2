---
name: lfg2-crawler
description: Design a crawler for LFG2 as a shape (parts of primitives). Many-legged things: spiders, crabs, scorpions, ants, beetles, insects on the ground.
---

# Crawler

Many-legged things: spiders, crabs, scorpions, ants, beetles, insects on the ground.

## How to make one

- Low and wide: the body sits between knees that rise above it; legs are tubes with a knee point (up, then down to the ground).
- Alternate legL and legR down each side, so the legs move in waves.
- Pincers are the front legs made thicker, with a claw (two ellipsoids) at the end; a scorpion's tail is a tube curling up over its back to a stinger.

## Parts and animation roles

- `body` (required): a thorax and a bigger abdomen behind it
- `legL` (required): three (or four) leg pairs that bend up at the knee and down to the ground; mirror them, alternate legL/legR so they scuttle
- `head`: small, low and at the front, with several eyes or eye stalks

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- **sculpted**: Thin, tapering leg tubes; gloss on shells (crabs, beetles).

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
      0.6,
      -0.4
     ],
     "size": [
      0.95,
      0.65,
      1.05
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.58,
      0.3
     ],
     "size": [
      0.6,
      0.45,
      0.55
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.48,
      -0.4
     ],
     "size": [
      0.75,
      0.4,
      0.85
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
    0.6,
    0.55
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.62,
      0.75
     ],
     "size": [
      0.42,
      0.36,
      0.38
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.11,
      0.7,
      0.88
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
      0.7,
      0.916
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
   "name": "front leg",
   "anim": "legL",
   "mirror": true,
   "pivot": [
    0.22,
    0.58,
    0.4
   ],
   "shapes": [
    {
     "type": "tube",
     "at": [
      0,
      0,
      0
     ],
     "size": [
      0,
      0,
      0
     ],
     "points": [
      [
       0.22,
       0.58,
       0.4
      ],
      [
       0.65,
       0.9,
       0.65
      ],
      [
       0.95,
       0.03,
       0.9
      ]
     ],
     "radius": [
      0.065,
      0.035
     ],
     "color": "accent"
    }
   ]
  },
  {
   "name": "middle leg",
   "anim": "legR",
   "mirror": true,
   "pivot": [
    0.28,
    0.58,
    0.2
   ],
   "shapes": [
    {
     "type": "tube",
     "at": [
      0,
      0,
      0
     ],
     "size": [
      0,
      0,
      0
     ],
     "points": [
      [
       0.28,
       0.58,
       0.2
      ],
      [
       0.8,
       0.92,
       0.2
      ],
      [
       1.15,
       0.03,
       0.15
      ]
     ],
     "radius": [
      0.065,
      0.035
     ],
     "color": "accent"
    }
   ]
  },
  {
   "name": "back leg",
   "anim": "legL",
   "mirror": true,
   "pivot": [
    0.28,
    0.58,
    0
   ],
   "shapes": [
    {
     "type": "tube",
     "at": [
      0,
      0,
      0
     ],
     "size": [
      0,
      0,
      0
     ],
     "points": [
      [
       0.28,
       0.58,
       0
      ],
      [
       0.75,
       0.9,
       -0.3
      ],
      [
       1,
       0.03,
       -0.6
      ]
     ],
     "radius": [
      0.065,
      0.035
     ],
     "color": "accent"
    }
   ]
  }
 ]
}
```
