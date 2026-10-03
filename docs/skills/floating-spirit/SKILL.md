---
name: lfg2-floating-spirit
description: Design a floating spirit for LFG2 as a shape (parts of primitives). Ghosts, wisps, slimes, jellyfish, spirits and anything that hovers or drifts.
---

# Floating spirit

Ghosts, wisps, slimes, jellyfish, spirits and anything that hovers or drifts.

## How to make one

- One big rounded mass, a face low on the front, and a trailing tail or tentacles.
- Glow finish on the core or eyes makes it a light at night.

## Parts and animation roles

- `body` (required): one soft mass that bobs
- `tail`: a trailing wisp or tentacles that sway

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- **sculpted**: Large blends (0.15) for a gooey, soft look.

## The loop

1. `interpret_prompt` with the player's words: you get a brief (skill, mood, style, size, colours, what must read from 20 m) and a starting design from this skill's template.
2. Change the starting design to fit the request: proportions for the mood first, then the features that must read, then colours and finishes.
3. `check_design` with the prompt: rule checks must pass; the critique scores it against this skill.
4. `render_design` (try `style: "sculpted"` for the close-up look) and compare with the brief. Fix, repeat.
5. `save_design`.

## Starting shape

```json
{
 "blend": 0.12,
 "parts": [
  {
   "name": "body",
   "anim": "body",
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.2,
      0
     ],
     "size": [
      1,
      1.05,
      1
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.1,
      0.12
     ],
     "size": [
      0.6,
      0.6,
      0.7
     ],
     "color": "belly",
     "finish": "glow"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.2,
      1.35,
      0.44
     ],
     "size": [
      0.16,
      0.22,
      0.1
     ],
     "color": "neutral1",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.12,
      0.47
     ],
     "size": [
      0.22,
      0.1,
      0.08
     ],
     "color": "neutral1",
     "blend": 0
    }
   ]
  },
  {
   "name": "tail",
   "anim": "tail",
   "pivot": [
    0,
    0.8,
    0
   ],
   "shapes": [
    {
     "type": "cone",
     "at": [
      0,
      0.45,
      -0.1
     ],
     "size": [
      0.55,
      0.8,
      0.55
     ],
     "rotate": [
      180,
      0,
      0
     ],
     "color": "main"
    }
   ]
  }
 ]
}
```
