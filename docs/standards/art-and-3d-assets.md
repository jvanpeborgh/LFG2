# Art & 3D assets

## 1. Default style: "Chunky Daylight"

A warm, readable voxel style. Think toy-like blocks under soft sunlight.
It's chosen because it's cheap to render in a browser, easy for agents to
generate as code, and forgiving when 30 people add things to it.

- **Shapes:** chunky, slightly exaggerated proportions; big readable
  silhouettes; heads and hands a bit oversized on characters.
- **Surfaces:** flat colours from the shared palette, with subtle per-voxel
  colour variation (±4% brightness) and baked ambient occlusion. No
  photographic textures, no realistic noise.
- **Light:** soft sun, warm key light, cool sky fill, gentle fog that tints
  toward the sky colour with distance.
- **Mood:** friendly by default. Dark or scary is fine *locally* (a dungeon, a
  storm event) and should return to normal afterwards.

Any of this can be changed through a world event (see `README.md`).

## 2. Units, axes and scale 🔒

| Rule | Value |
|---|---|
| Unit | 1 block = 1 metre |
| Up axis | +Y |
| Forward | +Z (glTF convention) |
| Model pivot | bottom centre, on the ground |
| Player | 0.6 × 1.8 × 0.6 m, eye height 1.62 m |
| Detail grid | 1/16 block ("micro-voxels") for props and characters |
| Doors / corridors | at least 1 × 2 blocks, so players always fit |

Consistent scale matters more than anything else in this file: a chair that's
3 metres tall breaks the world for everyone.

## 3. Palette

- A shared **48-colour master palette** (in `defaults.json`): 8 hue ramps
  × 5 shades + 8 neutrals.
- **Reserved meanings**, used the same way by everyone:

| Token | Meaning |
|---|---|
| `danger` (red-orange) | Hurts you. Lava, enemy attacks, traps |
| `interact` (warm gold) | You can use / pick up this |
| `heal` (green) | Restores health |
| `magic` (violet) | Agent-made / world-event effects |
| `water`, `ice` (blues) | Fluids, slow surfaces |
| `team1…team4` | Team colours, colour-blind-safe set |

- **Materials** (`art.materials` in `defaults.json`) say which palette colour each natural
  material uses: grass, leaves, dirt, wood, bark, stone, sand, snow, glass, wool, and the sky.
  Textures use these slots, so a world's theme can make sakura-pink leaves without pink grass.
- Don't use reserved colours for decoration if it could be mistaken for their
  meaning (no red-orange glowing decoration that looks like lava).
- Local palettes (a neon zone) can swap the ramps, but must keep the reserved
  meanings.

## 4. Making 3D assets — preferred order

1. **Procedural code (preferred).** The agent writes a TypeScript function that
   fills a micro-voxel grid, e.g. `buildChicken(seed)`. Benefits: small,
   reviewable, deterministic, easy to vary and to restyle when the palette
   changes.
2. **Composed from shared parts.** Reuse the shared parts library (heads,
   limbs, wheels, wings, trees, rocks, furniture) and recolour/scale them.
3. **Generated mesh → voxelized.** Use a text-to-3D or image-to-3D service,
   then voxelize to the 1/16 grid and snap colours to the palette. Use this for
   complex organic shapes only.
4. **Uploaded.** Player uploads go through the same voxelize + palette snap +
   moderation pipeline.

Whatever the source, the result is stored as a **glTF 2.0 binary (`.glb`)** with
vertex colours, in the content-addressed asset store.

## 5. Asset budgets 🔒

| Asset type | Max size (blocks) | Max triangles (LOD0) | LODs required |
|---|---|---|---|
| Small prop | 1 × 1 × 1 | 1,500 | no |
| Large prop / vehicle | 4 × 4 × 4 | 6,000 | yes, 2 |
| Character / creature | 2 × 3 × 2 | 4,000 | yes, 2 |
| Boss / giant | 16 × 16 × 16 | 20,000 | yes, 3 |
| Building (as a model, not blocks) | 32 × 32 × 32 | 30,000 | yes, 3 |

- Merge faces (greedy meshing) before counting triangles.
- At most **one** custom material per asset; use the shared materials where
  possible.
- Textures, if any: 16 px per block face, power-of-two atlas, max 256 × 256.

## 6. Readability checks (soft)

The asset pipeline renders a thumbnail and these views automatically:

- **Silhouette test:** black silhouette at 20 m. Should still be recognizable.
- **Value test:** greyscale render. The important part (face, weapon, handle)
  should stand out from the rest.
- **Context test:** placed next to the player and a standard tree, to catch
  scale mistakes.

The renders go into the agent's report.

## 7. Characters & animation

- **Shared humanoid rig** with standard bone names (`root, hips, spine, head,
  arm.L/R, forearm.L/R, hand.L/R, leg.L/R, shin.L/R, foot.L/R`). Creatures can
  add bones, but should keep these where they apply so shared animations work.
- **Standard animation names:** `idle, walk, run, jump, fall, land, attack,
  hit, die, emote_*`. Other modules can trigger these on any character.
- Style: snappy, few keyframes, a bit of anticipation and overshoot; 12–24 fps
  "stepped" feel is welcome.
- Crowds use the shared vertex-animation system (GPU), not individual
  skeletons.

## 8. Lighting, sky and post-processing

- Owned by the `lighting` and `sky` modules; the default is a day/night cycle
  of 20 minutes.
- Tone mapping: AgX (or ACES), exposure locked per scene so events don't blind
  people.
- **Bloom** for emissive things only, threshold so normal surfaces never bloom.
- Fog on by default (also hides chunk loading).
- **Max dynamic lights per module:** 8. Use emissive colour + bloom instead of
  real lights where you can.

## 9. Shaders

- Write materials in **Three.js TSL** (TypeScript) so the kernel can validate
  them; raw WGSL only when TSL can't express it.
- Build on the shared base material (palette, AO, fog, lighting) so new
  materials react to time of day and fog like everything else.
- 🔒 Bounded loops only, instruction count cap, full-screen effects limited to
  1 per module (see `ux-accessibility-and-comfort.md` for flashing limits).

## 10. VFX

- Particles from the shared GPU particle system; per-module caps in
  `defaults.json`.
- Voxel-style particles (small cubes), not soft smoke sprites, unless the
  local style says otherwise.
- **Effects must say what they mean:** danger effects use `danger`, healing
  uses `heal`, agent-made magic uses `magic`.
- World-event build-ups (rifts, gathering storms) have a shared base effect
  agents can customize, so players learn to recognize "something is coming".

## 11. Generated summons

Summoned creatures and things are generated by code from a spec
(`packages/shared/src/summons/generate.ts`), following this document:

- **Body plans**: cloud (domes on a flat base, shaded underside), fish (spindle body,
  countershading, dorsal fin, two-lobed tail, pectoral fins, eyes, gills, mouth and teeth),
  bird (body, head, beak, wings, tail; dragons add horns and spines), quadruped (body, four legs,
  head with eyes and snout, tail), blob (rounded cube, or dome with tentacles), biped
  (legs, body, arms, head with a face; bandanas, hats, horned helmets, beards, coats, crowns, a
  sword in the right hand; skeletons show ribs; bosses are bulkier so they read as bosses in
  silhouette), ship (tapered hull with a raised stern, deck, rails, one or two masts with sails,
  a flag; pirate ships get a skull and crossbones).
- **Resolution**: the finest voxel size (1/16, 1/8, 1/4… of a block) that keeps the longest side
  within 48 voxels (clouds 67, because their outline is everything).
- **Size**: the model measures itself and rebuilds smaller if fins, tails or wings overshoot.
- **Colours**: only palette keys, so a palette rule change restyles summons too; the danger
  colour is reserved for the warning pulse of things that can hurt you.
- **Checks**: triangle budget for its size category, palette, back/belly contrast, and for
  clouds at least 3 bumps along the top outline (silhouette test).
- **Review**: `npm run view:summons "<prompt>"` renders angles, a 20 m silhouette and a scale
  comparison with a player and a tree. Scenario casts too: `"<scenario> :: final"` (or `ship`,
  `grunt`, `brute`, `boss`).

## 12. Model styles

`art.modelStyle` (a world rule): how creatures and summons are drawn. The terrain is always blocks.

| Style | Look | How |
|---|---|---|
| `voxel` (default) | blocky, like the world | greedy-meshed cubes |
| `smooth` | rounded, "claymation" | surface nets over a blurred density field, smoothed, smooth normals |
| `lowpoly` | faceted, "origami" | the same surface at coarser detail, flat-shaded |
| `sculpted` | fine, blended forms, "figurine" | designs' primitives as distance fields with smooth joins; a close-up version (up to `locked.closeUp.multiplier` × the budget within `withinBlocks`) and a distant one within the budget. Models without a shape are drawn smooth |

- Every style starts from the **same voxel model**, so size, hitbox, palette, animation parts and
  checks don't change. Only the surface does.
- **Detail fits the budget**: smooth uses 2×, 1× or ½× the voxel grid, low-poly ½× or ⅓×. The
  finest that fits the size category's triangle budget wins, and the check says when it had to
  step down.
- **Thin parts survive**: one-voxel fins and wings stay inside the surface.
- **Colours stay crisp**: each triangle takes the colour of the voxel nearest its middle (no
  smearing across stripes or eyes).
- **Finishes** per primitive: `matte`, `gloss`, `metal`, `glow` (lit from within: shows at night).
  Glow is for eyes, lanterns and magic, not whole bodies.
- **Who chooses**: the world sets the default (`art.modelStyle`) and whether prompts may choose
  (`art.promptStyles`). A prompt (*"a low-poly wolf"*) or a design (`"style"`) can then pick its
  own. It's part of the summon, so every player sees it the same, and its budget is checked in
  that style.
- Theme words choose a style: *sculpted, figurine, porcelain, high-detail* → sculpted; *low-poly, faceted, polygonal, origami, papercraft* → lowpoly;
  *smooth, organic, claymation, soft, rounded, sculpted* → smooth; *voxel, blocky, pixel* →
  voxel. A live change redraws creatures already in the world.

## 13. Designs: models written as shapes

An agent (or a person) can write a model directly instead of picking a body plan. A shape is
named **parts**, each made of **primitives** (`box`, `ellipsoid`, `cylinder`, `cone`, `capsule`,
`torus`, `wedge`), placed (`at`, the centre), sized (`size`, full extents), rotated (`rotate`,
degrees) and coloured (`main`/`belly`/`accent` or a palette key). Later primitives paint over
earlier ones, and `cut: true` carves. The whole shape is scaled so its longest side is the
design's `length`, voxelized at the usual resolution, and stood on its feet. From there it's an
ordinary summon model.

- **Axes**: +y up, +z forward, +x its left (as in §2).
- **Parts that move** get a role (`tail`, `wingL`, `finL`, `legL`, `armL`, `head`, `jaw`,
  `body`) and a `pivot` where they join. `mirror: true` on a part adds the other side with
  the role swapped. On a primitive, it adds a mirrored copy in the same part (eyes, horns).
- **Limits**: 16 parts, 96 primitives. Primitives thinner than 1/40 of their length get a
  warning.
- **Checks** (on top of §5–6, with JSON paths and hints): unknown types, roles and colours
  (with the nearest valid ones), empty parts, parts that don't touch the rest, and **camouflage**
  (things that walk shouldn't be mostly the grass, sand or stone colour from above).
- **Sculpted joins**: `blend` on a primitive (or the shape) sets how softly it joins what came
  before (shape units). Soft necks and shoulders; hard (0) for belts, armour and paws.
- **Skills**: the design skills in [../skills/](../skills/) (one per archetype) give proportions
  per mood, required parts and templates. `interpret_prompt` turns words into a brief, and
  `check_design` with the prompt critiques against it.
- **Good designs** use 3–8 parts and 8–40 primitives: big simple forms first, then a few details
  that read at 20 m (eyes, a contrasting belly, a crest).

See [../AI-INTEGRATION.md](../AI-INTEGRATION.md) for the design loop (guide → check → render →
save) and the examples in `scripts/designs/`.
