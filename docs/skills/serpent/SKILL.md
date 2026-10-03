---
name: lfg2-serpent
description: Design a serpent for LFG2 as a shape (parts of primitives). Things with no legs that slither: snakes, worms, eels on land, basilisks.
---

# Serpent

Things with no legs that slither: snakes, worms, eels on land, basilisks.

## How to make one

- The body is one long tube in a gentle S, thickest behind the head and thinning to a point; it slithers by itself.
- A belly stripe (a flatter, lighter ellipsoid) and a pattern along the back (repeat) make it read as a snake, not a rope.

## Parts and animation roles

- `head` (required): a wedge-shaped head that leads; the eyes high on its sides
- `tail` (required): the whole body as a tube with 4–6 points in an S: it becomes a chain that slithers

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- **sculpted**: Blend the head into the neck (0.08) for a smooth snake.

## The loop

1. `interpret_prompt` with the player's words: you get a brief (skill, mood, style, size, colours, what must read from 20 m) and a starting design from this skill's template.
2. Change the starting design to fit the request: proportions for the mood first, then the features that must read, then colours and finishes.
3. `check_design` with the prompt: rule checks must pass; the critique scores it against this skill.
4. `render_design` (try `style: "sculpted"` for the close-up look) and compare with the brief. Fix, repeat.
5. `save_design`.

## Starting shape

```json
{
 "blend": 0.08,
 "parts": [
  {
   "name": "body",
   "anim": "body",
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.2,
      0.6
     ],
     "size": [
      0.34,
      0.3,
      0.6
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.12,
      0.6
     ],
     "size": [
      0.26,
      0.14,
      0.55
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
    0.25,
    0.85
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.27,
      1.05
     ],
     "size": [
      0.36,
      0.24,
      0.48
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.12,
      0.34,
      1.12
     ],
     "size": [
      0.1,
      0.11000000000000001,
      0.06999999999999999
     ],
     "color": "neutral8",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0.132,
      0.34,
      1.1500000000000001
     ],
     "size": [
      0.05500000000000001,
      0.065,
      0.04000000000000001
     ],
     "color": "neutral1",
     "mirror": true
    },
    {
     "type": "box",
     "at": [
      0,
      0.21,
      1.31
     ],
     "size": [
      0.03,
      0.02,
      0.14
     ],
     "color": "red3"
    }
   ]
  },
  {
   "name": "tail",
   "anim": "tail",
   "pivot": [
    0,
    0.2,
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
       0,
       0.2,
       0.42
      ],
      [
       0.16,
       0.18,
       0
      ],
      [
       -0.16,
       0.17,
       -0.45
      ],
      [
       0.13,
       0.15,
       -0.9
      ],
      [
       0,
       0.12,
       -1.3
      ]
     ],
     "radius": [
      0.16,
      0.04
     ],
     "color": "main"
    }
   ]
  }
 ]
}
```
