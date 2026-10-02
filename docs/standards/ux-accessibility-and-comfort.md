# UX, accessibility & comfort

## 1. Screen layout

The screen is split into zones. The kernel owns some; modules get their own
area to draw in.

```
┌───────────────────────────────────────────────────────────┐
│ [event banner — kernel]                    [module HUD 1] │
│                                            [module HUD 2] │
│                                                           │
│                      (game view)                          │
│                    keep centre clear                      │
│                                                           │
│ [chat — kernel]                       [mode score/timer]  │
│ [health/hotbar — kernel]          [inspector "?" — kernel]│
└───────────────────────────────────────────────────────────┘
```

- 🔒 Modules can't draw over kernel zones, the centre of the screen (except
  crosshair-style markers), or imitate kernel UI (menus, system messages,
  login prompts).
- Module HUD widgets get a box of at most 20 % of the screen in total, sorted
  by priority. If there are too many, low-priority ones collapse into icons.
- Prefer **in-world UI** (signs, floating labels, glowing objects) over screen
  overlays.

## 2. Text

- Shared font and sizes (in `defaults.json`); minimum 14 px at 1080p.
- Short: banners ≤ 8 words, tooltips ≤ 25 words.
- Text must be readable on any background (shadow or panel behind it).
- All text passes through moderation and the content rating (default: suitable
  for ages 13+).

## 3. Accessibility (kernel-provided settings modules must respect)

- **Colour-blind safe:** the reserved colours (danger, heal, team colours)
  differ by shape/icon or brightness too, not only by hue.
- **Subtitles** for speech and for important sound cues ("[rumbling below]").
- **Remappable controls:** modules ask for *actions* ("use", "ability 1"),
  never specific keys.
- **Reduced-motion setting:** when on, modules must reduce screen shake, camera
  sway and flashing to the minimum.
- **Text size and UI scale** settings that modules must respect.
- Touch/mobile: every action must also work with on-screen buttons.

## 4. Photosensitivity & motion comfort 🔒

These are locked because they protect players' health.

| Rule | Limit |
|---|---|
| Flashing | No more than 3 flashes per second (WCAG 2.3.1); large red flashes not at all |
| Full-screen brightness change | Max 2 per 10 s, each fading over ≥ 150 ms |
| Screen shake | Max amplitude 0.3 m equivalent, max 1 s, never when reduced motion is on |
| Field of view changes | ±10° max, eased over ≥ 200 ms |
| Camera control taken away | ≤ 3 s (same rule as player control) |
| Forced camera roll / spinning | Not allowed |

The kernel enforces these at runtime (it clamps the values), and the render test
in the gathering checks flags changes that hit the limits.

## 5. Onboarding & clarity

- A new player gets a short, kernel-owned intro (move, jump, chat, inspector,
  how world events work).
- Modules that add new controls or mechanics should teach them **in the world**
  the first time (a hint near the thing, a demo), not with a wall of text.
- The **inspector** (kernel) lets anyone point at something and see what made
  it, who cast it, and when. That's how players learn what the agents built.
