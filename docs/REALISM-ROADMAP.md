# Making the world more alive than Minecraft: what others did, and our roadmap

Research into Minecraft shader packs and mods, other voxel games and web voxel engines, and what
LFG2 takes from each. ✅ marks what's built.

## What LFG2 already does

- ✅ Smooth lighting and vertex ambient occlusion (the Minecraft baseline).
- ✅ A sky dome: a gradient from horizon to zenith, sunset glow towards the sun, fog tinted by the
  sun, clouds that catch the sunset, warm golden hour and cool moonlight.
- ✅ Wind: leaves rustle and plant tops sway, harder in storms. The idea comes from BSL and
  Complementary's waving foliage.
- ✅ Water: waves, fresnel sky reflection and sun glints (the cheap 80% of screen-space reflections).
- ✅ Fireflies on clear nights.
- ✅ Weather: rain, snow in cold places, and thunderstorms. Lightning is announced before it lands,
  and rain makes plants grow. Vintage Story's storms inspired this.
- ✅ Creatures with idle lives, characters, herds, voices and attacks (see the summons docs).

## The biggest wins still to take (in order)

| # | Idea | Who did it well | Cost in WebGL2 | Sketch |
|---|---|---|---|---|
| 1 | **Wet world**: rain darkens and glosses surfaces open to the sky, puddles, ripples, splashes | Complementary, BSL; Vintage Story's wetness | low | a `wetness` uniform. Up-facing, sky-exposed surfaces get darker, smoother and reflect the sky. Puddles are gated by world-space noise. |
| 2 | **HDR post pipeline**: bloom, tone mapping (ACES/AgX), colour grading per mood, eye adaptation | all major packs | low | render to a half-float target, then bloom → tone mapping → a LUT per mood (golden hour, storm, night). |
| 3 | **Coloured block light**: warm torches, cold ice-glow, magic in purple | Rethinking Voxels, Teardown | low–med | block light as RGB, flood-filled per channel in the meshing worker. |
| 4 | **Spatial ambient audio**: biome soundscapes, footsteps per material, caves that echo, rain muffled indoors | Dynamic Surroundings, Sound Physics Remastered, AmbientSounds | low | WebAudio panners, crossfaded beds by biome and sky openness, a few rays for enclosure → reverb and low-pass. |
| 5 | **Secondary motion**: blinking, foot planting, springy ears and tails, short ragdolls | Fresh Animations, Physics Mod | low | layers on the procedural animation every generated creature already has. |
| 6 | **Sun shadows** (cascaded shadow maps) | BSL, Complementary, Photon | med | three's CSM with 3 cascades. Fade with sky light so caves stay dark. |
| 7 | **God rays and height fog** | BSL, SEUS | med | a half-resolution ray march against the shadow map, denser in rain and at dawn. |
| 8 | **Volumetric clouds and storm fronts you can see coming** | Complementary, Photon, Vintage Story | med | a ray-marched cloud slab whose coverage follows the server's weather. |
| 9 | **PBR-lite materials** (emissive ores, glossy ice and metal) | LabPBR packs | med (art) | done: a per-block finish (gloss, metal, ore) in the face flags. Sun highlights, sky fresnel, and ore flecks that glint and glow. |
| 10 | **Far terrain** (level of detail to the horizon) | Distant Horizons, Divine Voxel Engine | med–high | greedy meshing, packed vertices, a worker pool, and heightfield LOD beyond 8 chunks. |

Not worth it in WebGL2 yet: screen-space reflections (the fresnel sky does most of it), path-traced
global illumination (wait for WebGPU), and SSAO for terrain (vertex AO already covers it).

## Going further than Minecraft (because the world is shared and its creatures are generated)

- **Weather fronts on the map**: storms you see on the horizon that move across the world. Everyone
  sees the same lightning, and creatures shelter, herd up, or get bold.
- **Seasons that rewrite the world**: foliage turns, leaves fall, lakes freeze and thaw, and
  creatures migrate, change coats and hibernate (Serene Seasons, TerraFirmaCraft).
- **Ecology**: herds graze grass down, predators follow herds, and trees grow over time.
- **Body and weather**: wetness, warmth and shelter you can read at a glance, such as breath fog in
  the cold and shivering (Vintage Story, The Forest).
- **Traces in the shared world**: footprints in snow and mud, scorch marks after lightning, nests and
  dens. Lightning can set a tree alight for everyone to see.
- **Structure stability** for builds, with debris when they fall (Valheim, Teardown).
- **Generated voices and moods**: the designer gives each species its own voice and behaviour profile.

## Sources

complementaryshaders.com · github.com/gri573/rethinking-voxels · github.com/rre36/lab-pbr/wiki ·
threejs.org/docs/pages/CSM.html · acko.net/blog/teardown-frame-teardown ·
modrinth.com/resourcepack/fresh-animations · modrinth.com/mod/sound-physics-remastered ·
curseforge.com/minecraft/mc-mods/dynamic-surroundings · gitlab.com/jeseibel/distant-horizons ·
wiki.vintagestory.at/index.php/Weather · curseforge.com/minecraft/mc-mods/serene-seasons ·
github.com/voxelize/voxelize · github.com/Divine-Star-Software/DivineVoxelEngine ·
nickmcd.me/2021/04/04/high-performance-voxel-engine
