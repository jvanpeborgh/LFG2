---
name: lfg2-winged-creature
description: Design a winged creature for LFG2 as a shape (parts of primitives). Things that fly by flapping: birds, bats, moths, butterflies, bees, dragons and griffins in the air.
---

# Winged creature

Things that fly by flapping: birds, bats, moths, butterflies, bees, dragons and griffins in the air.

## How to make one

- Wingspan at least 1.2× the body's length (birds 2×, moths and bats 1.5×): the wings are the silhouette.
- Wings are flat ellipsoids or wedges (thickness ~5% of their width), pivoting at the shoulder, tilted up 10–20° (a V reads as flight).
- Two-tone wings (an accent on the tips or a spot) make the flap visible.
- Keep the body small and light; the head at the front with a beak, snout or antennae.

## Parts and animation roles

- `body` (required): a compact, light body
- `wingL` (required): wings flap from the shoulder; mirror one wing
- `head`: optional but makes it look around
- `tail`: steers and balances the silhouette

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- **lowpoly**: Wedges for wings read beautifully as folded paper.
- **sculpted**: Blend the wing roots into the body (0.05); glow on spots for night flyers.

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
      1,
      0
     ],
     "size": [
      0.55,
      0.55,
      1.3
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.9,
      0.05
     ],
     "size": [
      0.42,
      0.36,
      1.05
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
    1.12,
    0.55
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.2,
      0.78
     ],
     "size": [
      0.48,
      0.46,
      0.48
     ],
     "color": "main"
    },
    {
     "type": "cone",
     "axis": "z",
     "at": [
      0,
      1.14,
      1.08
     ],
     "size": [
      0.14,
      0.12,
      0.3
     ],
     "color": "accent"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.15,
      1.27,
      0.94
     ],
     "size": [
      0.12,
      0.13,
      0.08
     ],
     "color": "neutral1",
     "mirror": true
    }
   ]
  },
  {
   "name": "wing",
   "anim": "wingL",
   "mirror": true,
   "pivot": [
    0.22,
    1.12,
    0.1
   ],
   "shapes": [
    {
     "type": "tube",
     "at": [
      0.85,
      1.25,
      0.1
     ],
     "size": [
      1.4,
      0.4,
      0.3
     ],
     "points": [
      [
       0.22,
       1.12,
       0.12
      ],
      [
       0.8,
       1.3,
       0.16
      ],
      [
       1.5,
       1.38,
       -0.05
      ]
     ],
     "radius": [
      0.07,
      0.025
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.85,
      1.22,
      -0.12
     ],
     "size": [
      1.3,
      0.04,
      0.62
     ],
     "rotate": [
      0,
      -6,
      12
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      1.3,
      1.31,
      -0.2
     ],
     "size": [
      0.48,
      0.05,
      0.4
     ],
     "rotate": [
      0,
      -6,
      12
     ],
     "color": "accent"
    }
   ]
  },
  {
   "name": "tail",
   "anim": "tail",
   "pivot": [
    0,
    1,
    -0.6
   ],
   "shapes": [
    {
     "type": "wedge",
     "at": [
      0,
      1.02,
      -0.85
     ],
     "size": [
      0.5,
      0.05,
      0.5
     ],
     "rotate": [
      0,
      180,
      0
     ],
     "color": "accent"
    }
   ]
  }
 ]
}
```
