# Audio & music

## 1. Default musical identity

| Setting | Default |
|---|---|
| Mood | Hopeful, playful, curious |
| Key / mode | D major, with D Dorian for mystery and night |
| Tempo | 96 BPM for exploring; 128 BPM for action; 72 BPM for calm/night |
| Instruments | Warm synth pads, plucked marimba/kalimba, soft bells, light hand percussion; brass and drums only for big moments |
| Structure | Loops of 8 or 16 bars that can cross-fade at bar lines |

All music in one key family and tempo set means music from different agents can
overlap or hand over without clashing. Local zones (horror dungeon, neon city)
may change these inside their own area.

## 2. Adaptive music

Music is owned by the `music-director` module, not by individual modules.
Modules don't play music directly; they **ask** for it.

- Music is made of **stems** (pads, melody, rhythm, percussion) that fade in and
  out with the game's **intensity level** (0–3), which comes from the pacing
  "director" (see `game-design-and-fun.md`).
- Modules can register:
  - a **theme** for their area or game mode,
  - a **stinger** (2–6 s) for world events: one for the build-up, one for the
    arrival, one for a fizzle.
- Switches happen on bar lines with cross-fades. No hard cuts except for
  stingers.
- **Silence is allowed.** At least 30 % of calm exploration time should have no
  music, only ambience. Constant music gets tiring.

## 3. Sound effects

- Every action that matters needs a sound: hits, damage taken, pick-up, place,
  break, ability ready, danger wind-up.
- **Danger must be heard before it hurts:** telegraph sounds at least 0.75 s
  before the hit.
- Sounds have variations (at least 3 for frequent ones, ±5 % random pitch) so
  they don't get annoying.
- Prefer short and punchy: most SFX under 1.5 s; loops must loop cleanly.

## 4. Spatial audio

- All world sounds are **3D/positional** with distance fade-out (default max
  32 m).
- **Only world events and the core UI** may play non-positional ("global")
  sounds.
- Priority system: when there are too many sounds, quieter/farther ones are
  dropped first. Danger cues and the player's own actions are never dropped.

## 5. Loudness & limits 🔒

| Rule | Value |
|---|---|
| Overall game mix target | about −18 LUFS integrated |
| Music bus | about −22 LUFS; ducks 4–6 dB under dialogue/stingers |
| True peak | ≤ −1 dBTP on every file |
| Max simultaneous voices per module | 8 (32 total) |
| Max length per sound file | 30 s for SFX, 3 min per music stem |
| Sudden loud sounds | No jump-scare-loud sounds in global events; the kernel limits any sound that jumps more than 12 dB above the current mix |

The asset pipeline measures loudness and normalizes automatically; files far
outside the target are rejected.

## 6. Making audio

Preferred order:

1. **Procedural / synthesized in code** (Web Audio / Tone.js-style patches):
   tiny, tweakable, always in key.
2. **Generated** with a music or SFX model, prompted with the defaults above
   (key, tempo, instruments), then normalized and checked.
3. **Uploaded**, through moderation.

🔒 **Licensing:** only audio that is generated, made in code, or clearly
CC0/owned may be used. No copyrighted songs or clips (that's how "someone
rickrolled the server" happens). The moderation step checks uploads against
audio fingerprinting.

## 7. Speech and voice

- Spoken lines need on-screen subtitles.
- Generated voices must not imitate real people.
- No player voice chat inside agent-made modules; voice chat (if any) is a
  kernel feature with its own moderation.
