---
name: lfg2-humanoid
description: Design a humanoid for LFG2 as a shape (parts of primitives). Anything that stands on two legs with two arms: knights, samurai, villagers, goblins, robots, golems, skeletons, bosses.
---

# Humanoid

Anything that stands on two legs with two arms: knights, samurai, villagers, goblins, robots, golems, skeletons, bosses.

## How to make one

- Stack: legs (about 45% of the height), torso, head. Shoulders wider than hips reads as strong.
- Arms hang from the top corners of the torso; hands slightly lighter or a contrasting glove colour.
- A face needs only eyes (and maybe a mouth or visor) on the front of the head.
- Silhouette props sell the role: a hat, horns, a sword, a cape (wedge), a backpack.

## Parts and animation roles

- `body` (required): torso and hips
- `head` (required): looks around; head-to-height ratio sets the mood (heroic ~1/7, cute ~1/2)
- `armL` (required): arms swing and strike (the right arm raises a weapon while winding up an attack)
- `legL` (required): legs walk (mirror one to get both)

## Moods

- **cute** (head ratio 0.38–0.75, 65%+ rounded primitives, 0–3 cones/wedges): Big head (about half the height for upright creatures), big eyes low on the face, short limbs. Round forms (ellipsoids, capsules), soft blends, no sharp spikes. Light, warm or pastel colours; a pale belly.
- **menacing** (head ratio 0.1–0.32, 2+ cones/wedges): Small head low and forward, heavy shoulders, long claws or horns. Sharp forms: cones and wedges for horns, spines and claws (at least two). Dark main colour; eyes small, or glowing (finish: glow).
- **heroic** (head ratio 0.12–0.3): Broad chest and shoulders, upright posture, a small head. Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim.
- **elegant** (head ratio 0.1–0.3, 50%+ rounded primitives): Long and slender: long neck, tail or wings; thin limbs. Few, flowing forms with soft blends; gloss finishes; a restrained palette.
- **comic** (head ratio 0.3–0.8, 50%+ rounded primitives): Exaggerate one feature (a huge nose, tiny wings on a big body). Bright colours; big eyes that don't match (one bigger).

## Styles

- **voxel**: Heads at least 6 voxels across so a face fits.
- **sculpted**: Blend the neck and shoulders (0.05); keep belt and armour edges hard (blend 0) and use metal for armour.

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
     "type": "capsule",
     "at": [
      0,
      1.15,
      0
     ],
     "size": [
      0.7,
      0.85,
      0.45
     ],
     "color": "main"
    },
    {
     "type": "box",
     "at": [
      0,
      0.82,
      0
     ],
     "size": [
      0.72,
      0.1,
      0.47
     ],
     "color": "accent",
     "blend": 0
    }
   ]
  },
  {
   "name": "head",
   "anim": "head",
   "pivot": [
    0,
    1.6,
    0
   ],
   "shapes": [
    {
     "type": "ellipsoid",
     "at": [
      0,
      1.86,
      0.02
     ],
     "size": [
      0.52,
      0.55,
      0.5
     ],
     "color": "orange5"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.11,
      1.9,
      0.27
     ],
     "size": [
      0.1,
      0.12,
      0.07
     ],
     "color": "neutral1",
     "mirror": true
    },
    {
     "type": "ellipsoid",
     "at": [
      0,
      2.06,
      -0.02
     ],
     "size": [
      0.56,
      0.24,
      0.54
     ],
     "color": "accent"
    }
   ]
  },
  {
   "name": "arm",
   "anim": "armL",
   "mirror": true,
   "pivot": [
    0.42,
    1.45,
    0
   ],
   "shapes": [
    {
     "type": "capsule",
     "at": [
      0.41,
      1.12,
      0
     ],
     "size": [
      0.19,
      0.72,
      0.19
     ],
     "color": "main"
    },
    {
     "type": "ellipsoid",
     "at": [
      0.42,
      0.73,
      0.02
     ],
     "size": [
      0.17,
      0.17,
      0.17
     ],
     "color": "orange5"
    }
   ]
  },
  {
   "name": "leg",
   "anim": "legL",
   "mirror": true,
   "pivot": [
    0.17,
    0.75,
    0
   ],
   "shapes": [
    {
     "type": "capsule",
     "at": [
      0.17,
      0.4,
      0
     ],
     "size": [
      0.22,
      0.8,
      0.22
     ],
     "color": "accent"
    },
    {
     "type": "box",
     "at": [
      0.17,
      0.05,
      0.06
     ],
     "size": [
      0.22,
      0.1,
      0.32
     ],
     "color": "neutral2",
     "blend": 0
    }
   ]
  }
 ]
}
```
