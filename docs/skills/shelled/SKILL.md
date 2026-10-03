---
name: lfg2-shelled
description: Design a shelled creature for LFG2 as a shape (parts of primitives). Creatures carrying a shell: turtles, tortoises, snails.
---

# Shelled creature

Creatures carrying a shell: turtles, tortoises, snails.

## How to make one

- The shell is most of the silhouette: give it a pattern (repeat plates, or rings for a spiral) in the accent colour.
- Gloss on the shell; matte skin.

## Parts and animation roles

- `body` (required): the shell (a high dome, or a spiral for snails) over a softer body
- `head` (required): pokes out at the front on a neck (or eye stalks, for snails)

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- **sculpted**: Gloss shells; soft blends where skin meets shell.

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
      0.45,
      0
     ],
     "size": [
      1.1,
      0.42,
      1.35
     ],
     "color": "belly"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.62,
      -0.05
     ],
     "size": [
      1.2,
      0.75,
      1.45
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.95,
      0.15
     ],
     "size": [
      0.3,
      0.12,
      0.3
     ],
     "color": "accent",
     "repeat": {
      "count": 3,
      "offset": [
       0,
       0.02,
       -0.35
      ]
     }
    },
    {
     "type": "ellipsoid",
     "at": [
      0.35,
      0.85,
      0
     ],
     "size": [
      0.26,
      0.12,
      0.3
     ],
     "color": "accent",
     "mirror": true,
     "repeat": {
      "count": 2,
      "offset": [
       0,
       -0.02,
       -0.4
      ]
     }
    }
   ]
  },
  {
   "name": "head",
   "anim": "head",
   "pivot": [
    0,
    0.5,
    0.6
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
       0.45,
       0.5
      ],
      [
       0,
       0.55,
       0.8
      ]
     ],
     "radius": [
      0.16,
      0.14
     ],
     "color": "belly"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.6,
      0.92
     ],
     "size": [
      0.34,
      0.3,
      0.38
     ],
     "color": "belly"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.12,
      0.66,
      1
     ],
     "size": [
      0.09,
      0.099,
      0.063
     ],
     "color": "neutral8",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0.1308,
      0.66,
      1.027
     ],
     "size": [
      0.0495,
      0.058499999999999996,
      0.036
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
    0.45,
    0.4,
    0.45
   ],
   "shapes": [
    {
     "type": "capsule",
     "at": [
      0.5,
      0.18,
      0.5
     ],
     "size": [
      0.24,
      0.36,
      0.26
     ],
     "color": "belly"
    }
   ]
  },
  {
   "name": "back leg",
   "anim": "legR",
   "mirror": true,
   "pivot": [
    0.45,
    0.4,
    -0.45
   ],
   "shapes": [
    {
     "type": "capsule",
     "at": [
      0.48,
      0.18,
      -0.5
     ],
     "size": [
      0.24,
      0.36,
      0.26
     ],
     "color": "belly"
    }
   ]
  }
 ]
}
```
