---
name: lfg2-elemental
description: Design a elemental for LFG2 as a shape (parts of primitives). Beings of an element: fire, ice, stone, water, storm, crystal.
---

# Elemental

Beings of an element: fire, ice, stone, water, storm, crystal.

## How to make one

- The element sets the colours and the accents: flames (glow cones) for fire, crystals (gloss cones) for ice, rough blocks for stone.

## Parts and animation roles

- `body` (required): a core that glows, tapering to nothing below (it floats)
- `armL` (required): arms of the element, ending in a glowing hand
- `head`: small, with glowing eyes

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- **sculpted**: Large blends; glow on the core and the crown.

## The loop

1. `interpret_prompt` with the player's words: you get a brief (skill, mood, style, size, colours, what must read from 20 m) and a starting design from this skill's template.
2. Change the starting design to fit the request: proportions for the mood first, then the features that must read, then colours and finishes.
3. `check_design` with the prompt: rule checks must pass; the critique scores it against this skill.
4. `render_design` (try `style: "sculpted"` for the close-up look) and compare with the brief. Fix, repeat.
5. `save_design`.

## Starting shape

```json
{
 "blend": 0.1,
 "parts": [
  {
   "name": "body",
   "anim": "body",
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.25,
      0
     ],
     "size": [
      0.9,
      1,
      0.7
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.25,
      0.12
     ],
     "size": [
      0.5,
      0.55,
      0.4
     ],
     "color": "accent",
     "finish": "glow"
    },
    {
     "type": "cone",
     "at": [
      0,
      0.5,
      0
     ],
     "size": [
      0.7,
      0.9,
      0.55
     ],
     "rotate": [
      180,
      0,
      0
     ],
     "color": "main"
    },
    {
     "type": "cone",
     "at": [
      0.25,
      1.95,
      -0.1
     ],
     "size": [
      0.22,
      0.6,
      0.22
     ],
     "rotate": [
      -10,
      0,
      -15
     ],
     "color": "accent",
     "finish": "glow",
     "mirror": true
    },
    {
     "type": "cone",
     "at": [
      0,
      2.05,
      -0.05
     ],
     "size": [
      0.26,
      0.7,
      0.26
     ],
     "color": "accent",
     "finish": "glow"
    }
   ]
  },
  {
   "name": "head",
   "anim": "head",
   "pivot": [
    0,
    1.7,
    0
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.85,
      0.05
     ],
     "size": [
      0.5,
      0.48,
      0.45
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.11,
      1.88,
      0.25
     ],
     "size": [
      0.12,
      0.08,
      0.06
     ],
     "color": "neutral8",
     "finish": "glow",
     "mirror": true
    }
   ]
  },
  {
   "name": "arm",
   "anim": "armL",
   "mirror": true,
   "pivot": [
    0.42,
    1.5,
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
       0.4,
       1.5,
       0
      ],
      [
       0.7,
       1.2,
       0.1
      ],
      [
       0.78,
       0.85,
       0.2
      ]
     ],
     "radius": [
      0.16,
      0.1
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.8,
      0.8,
      0.22
     ],
     "size": [
      0.26,
      0.26,
      0.26
     ],
     "color": "accent",
     "finish": "glow"
    }
   ]
  }
 ]
}
```
