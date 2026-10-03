---
name: lfg2-swimmer
description: Design a swimmer for LFG2 as a shape (parts of primitives). Fish, sharks, whales, dolphins, eels and other things that swim.
---

# Swimmer

Fish, sharks, whales, dolphins, eels and other things that swim.

## How to make one

- Spindle body: widest at a third from the front, tapering to the tail.
- Countershading: darker back (main), pale belly; the eye high and near the front.
- A vertical tail fin (forked = fast, round = slow) and a dorsal fin for sharks and dolphins.

## Parts and animation roles

- `body` (required): a spindle, thick near the front
- `tail` (required): sways side to side; the main motion
- `finL`: pectoral fins (mirror one)

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- **sculpted**: Blend fins into the body (0.04); gloss on the body reads as wet.

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
      1,
      0.95,
      2.2
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.82,
      0.1
     ],
     "size": [
      0.84,
      0.6,
      1.9
     ],
     "color": "belly"
    },
    {
     "type": "wedge",
     "at": [
      0,
      1.55,
      -0.15
     ],
     "size": [
      0.1,
      0.45,
      0.7
     ],
     "color": "accent"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.36,
      1.12,
      0.72
     ],
     "size": [
      0.24,
      0.26,
      0.24
     ],
     "color": "neutral8",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0.45,
      1.13,
      0.78
     ],
     "size": [
      0.12,
      0.15,
      0.12
     ],
     "color": "neutral1",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.86,
      1.08
     ],
     "size": [
      0.36,
      0.1,
      0.1
     ],
     "color": "neutral2",
     "cut": true
    }
   ]
  },
  {
   "name": "tail",
   "anim": "tail",
   "pivot": [
    0,
    1,
    -1.05
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.25,
      -1.35
     ],
     "size": [
      0.1,
      0.7,
      0.42
     ],
     "rotate": [
      40,
      0,
      0
     ],
     "color": "accent"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.78,
      -1.35
     ],
     "size": [
      0.1,
      0.7,
      0.42
     ],
     "rotate": [
      -40,
      0,
      0
     ],
     "color": "accent"
    }
   ]
  },
  {
   "name": "fin",
   "anim": "finL",
   "mirror": true,
   "pivot": [
    0.42,
    0.85,
    0.25
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0.68,
      0.78,
      0.18
     ],
     "size": [
      0.6,
      0.08,
      0.34
     ],
     "rotate": [
      0,
      30,
      -25
     ],
     "color": "accent"
    }
   ]
  }
 ]
}
```
