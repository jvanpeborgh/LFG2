---
name: lfg2-tentacled
description: Design a tentacled creature for LFG2 as a shape (parts of primitives). Octopuses, squid, krakens and jellyfish: a soft body and many tentacles.
---

# Tentacled creature

Octopuses, squid, krakens and jellyfish: a soft body and many tentacles.

## How to make one

- Tentacles as tubes that curl outward and down, thinning to a tip; mirror them for symmetry.
- Spots or suckers with repeat; glow for deep-sea or jellyfish.

## Parts and animation roles

- `body` (required): the mantle or bell, with big eyes
- `tail` (required): each tentacle a tail-role part with a curving tube: they become chains that sway

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- **sculpted**: Large blends (0.08–0.12) for soft, rubbery forms.

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
      1.25,
      -0.1
     ],
     "size": [
      0.95,
      1.15,
      1
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.2,
      1.4,
      0.3
     ],
     "size": [
      0.18,
      0.18,
      0.14
     ],
     "color": "accent",
     "mirror": true,
     "repeat": {
      "count": 2,
      "offset": [
       0,
       0.22,
       -0.1
      ]
     }
    },
    {
     "type": "ellipsoid",
     "at": [
      0.25,
      1,
      0.38
     ],
     "size": [
      0.2,
      0.22000000000000003,
      0.13999999999999999
     ],
     "color": "neutral8",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0.274,
      1,
      0.44
     ],
     "size": [
      0.11000000000000001,
      0.13,
      0.08000000000000002
     ],
     "color": "neutral1",
     "mirror": true
    }
   ]
  },
  {
   "name": "tentacle",
   "anim": "tail",
   "mirror": true,
   "pivot": [
    0.25,
    0.72,
    0.15
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
       0.72,
       0.18
      ],
      [
       0.45,
       0.4,
       0.4
      ],
      [
       0.55,
       0.15,
       0.6
      ],
      [
       0.7,
       0.05,
       0.85
      ]
     ],
     "radius": [
      0.14,
      0.035
     ],
     "color": "main"
    }
   ]
  },
  {
   "name": "side tentacle",
   "anim": "tail",
   "mirror": true,
   "pivot": [
    0.3,
    0.72,
    -0.15
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
       0.3,
       0.72,
       -0.15
      ],
      [
       0.65,
       0.4,
       -0.2
      ],
      [
       0.9,
       0.12,
       -0.15
      ],
      [
       1.15,
       0.05,
       -0.3
      ]
     ],
     "radius": [
      0.14,
      0.035
     ],
     "color": "main"
    }
   ]
  },
  {
   "name": "back tentacle",
   "anim": "tail",
   "mirror": true,
   "pivot": [
    0.2,
    0.72,
    -0.4
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
       0.18,
       0.72,
       -0.4
      ],
      [
       0.35,
       0.4,
       -0.75
      ],
      [
       0.4,
       0.12,
       -1
      ],
      [
       0.55,
       0.05,
       -1.3
      ]
     ],
     "radius": [
      0.14,
      0.035
     ],
     "color": "main"
    }
   ]
  }
 ]
}
```
