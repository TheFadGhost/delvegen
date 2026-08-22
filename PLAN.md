# PLAN.md — scope decisions

Every candidate feature was judged against three tests: (1) does it serve the core purpose of
generating and understanding dungeons, (2) can it be finished to the same quality bar as the
core, (3) does it avoid expanding into a second product.

## Accepted

1. **Topology markers overlay** — entrance, exit, dead ends and chokepoints derived from the
   grid and drawn on the map. Pure analytics over existing data; strengthens the "understanding"
   half of the core purpose. (Ships as part of the renderer/legend.)
2. **Presets per algorithm** — curated parameter sets for common dungeon feels. Small,
   testable, directly serves generation.
3. **"Surprise me"** — randomized valid parameters + fresh seed in one click. Trivial over the
   existing param schema; great discovery surface.
4. **Seed history back/forward** — a small state stack of recent generations with keyboard
   navigation. Tiny, high daily-use value.
5. **Shareable configuration** — full config encoded in the URL hash plus JSON config files
   that import/export. Serialization exists anyway for determinism tests.
6. **Keyboard shortcuts + cheatsheet** — generate, step, pan, zoom, theme, copy seed;
   documented behind `?`. Step-through without keyboard control would feel broken.
7. **Batch seed sweep + distribution histogram** — run N seeds headlessly and show metric
   distributions. The best tool for understanding whether parameters produce consistent feels;
   reuses library API + metrics. Ships as CLI (`batch`) plus an in-app histogram panel.
8. **Determinism self-check** — one button that replays the current seed and verifies
   byte-identical output. Makes the headline promise inspectable by users.
9. **Template-pack validation** — the template-stitching algorithm ships with a documented
   pack format and automated validation (edge compatibility, connectivity) in the test suite
   and docs. Rigor for a core algorithm, not a separate linter product.

## Rejected

1. **Entity/loot placement** — crosses from geometry into gameplay-content authoring; a level
   design suite is a second product with its own schema, UI, and testing burden.
2. **Multi-floor dungeons** — touches every algorithm's contract, the visualizer, exports and
   metrics simultaneously; correct idea, wrong release; revisit post-1.0.
3. **Visual template/tile editor** — fails the second-product test outright; the pack format
   spec + validator covers the real need.
4. **Biome tinting** — decorative content layer, not comprehension; themes already cover
   palette variety without inventing game content.
5. **Animation export (GIF/WebM)** — capture/encoding pipelines are fragile across browsers
   and headless environments; risk of shipping half-baked outweighs visibility. Revisit if a
   deterministic frame-dump need appears (PNG export already covers stills).

## Non-goals (standing)

A game engine, a tile editor, a pathfinding sandbox, multiplayer anything.
