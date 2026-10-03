---
name: lfg2-four-legged-creature
description: Design a four-legged creature for LFG2 as a shape (parts of primitives). Animals and beasts that walk on four legs: dogs, cats, wolves, bears, lions, dragons on the ground, boars, foxes.
---

# Four-legged creature

Animals and beasts that walk on four legs: dogs, cats, wolves, bears, lions, dragons on the ground, boars, foxes.

## How to make one

- Body is a horizontal ellipsoid or capsule; legs are capsules under its four corners, slightly inside the body's width.
- Head at the front (+z), a little above the back; a snout or muzzle in a lighter colour makes the face read.
- Legs reach the ground; paws or hooves in a darker accent.
- Ears, horns or a mane change the species more than the body does.

## Parts and animation roles

- `body` (required): the torso: everything else hangs off it
- `head` (required): turns to look; its size sets the mood
- `legL` (required): front and back legs walk in a diagonal gait (mirror each to get the other side)
- `legR` (required): the other diagonal
- `tail`: sways; a strong silhouette cue

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- **voxel**: Keep legs at least 2 voxels thick.
- **lowpoly**: Fewer, larger primitives; let the facets show the forms.
- **sculpted**: Use blend 0.05–0.1 for a soft neck; keep a hard join (blend 0) at paws.

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
      0.9,
      0.8,
      1.6
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      0.86,
      0.05
     ],
     "size": [
      0.7,
      0.5,
      1.3
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
    1.25,
    0.65
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.45,
      0.95
     ],
     "size": [
      0.7,
      0.65,
      0.7
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.32,
      1.28
     ],
     "size": [
      0.4,
      0.3,
      0.35
     ],
     "color": "belly"
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.38,
      1.46
     ],
     "size": [
      0.12,
      0.09,
      0.06
     ],
     "color": "neutral1"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.2,
      1.56,
      1.23
     ],
     "size": [
      0.16,
      0.18,
      0.1
     ],
     "color": "neutral8",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0.21,
      1.56,
      1.28
     ],
     "size": [
      0.09,
      0.11,
      0.05
     ],
     "color": "neutral1",
     "mirror": true
    },
    {
     "type": "cone",
     "at": [
      0.22,
      1.83,
      0.92
     ],
     "size": [
      0.18,
      0.3,
      0.12
     ],
     "rotate": [
      0,
      0,
      -15
     ],
     "color": "accent",
     "mirror": true
    }
   ]
  },
  {
   "name": "front leg",
   "anim": "legL",
   "mirror": true,
   "pivot": [
    0.28,
    0.85,
    0.5
   ],
   "shapes": [
    {
     "type": "capsule",
     "at": [
      0.28,
      0.42,
      0.5
     ],
     "size": [
      0.24,
      0.86,
      0.24
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.28,
      0.06,
      0.56
     ],
     "size": [
      0.28,
      0.13,
      0.34
     ],
     "color": "accent"
    }
   ]
  },
  {
   "name": "back leg",
   "anim": "legR",
   "mirror": true,
   "pivot": [
    0.28,
    0.85,
    -0.5
   ],
   "shapes": [
    {
     "type": "capsule",
     "at": [
      0.28,
      0.42,
      -0.5
     ],
     "size": [
      0.26,
      0.86,
      0.26
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.28,
      0.06,
      -0.44
     ],
     "size": [
      0.28,
      0.13,
      0.34
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
    1.1,
    -0.75
   ],
   "shapes": [
    {
     "type": "capsule",
     "axis": "z",
     "at": [
      0,
      1.25,
      -1.05
     ],
     "size": [
      0.14,
      0.14,
      0.62
     ],
     "rotate": [
      -30,
      0,
      0
     ],
     "color": "accent"
    }
   ]
  }
 ]
}
```
