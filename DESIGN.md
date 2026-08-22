# DESIGN.md — Delvegen visual language and interface design

## Look and feel (decision)

Delvegen is a **clean technical instrument**: a dark, precise, engineering-tool surface whose
entire job is to make the generated map the brightest thing on screen. Chrome is quiet
near-black panels with a single amber accent used only for selection, focus, and primary
action; numerals are tabular monospace so metric columns never shift; every control shows its
exact numeric value and valid range. **Rejected:** the evocative old-map aesthetic (parchment,
sepia ink, compass roses). It cannot be executed honestly on a zoomable pixel grid without real
texture assets and it fights the tool's purpose — comparing algorithms precisely. The one
stylised theme we ship ("Relic") is a deliberate exception kept honest by pattern-based tile
roles, not by gradient-and-serif cosplay. Also rejected: purple-blue gradients, glassmorphism
panels floating over the map, emoji icons, framework-default indigo, card-per-control layouts,
decorative chrome animation, and legends built from six similar mid-tones.

## The map itself

Tile rendering style — **committed: minimal vector**. Tiles are flat rectangles drawn at
integer device-pixel alignment; walls carry a subtle top-edge highlight line, floors are flat.
No textures, no noise, no bevels. Crispness rule: the canvas backing store is sized at
`devicePixelRatio`, camera offsets snap to device pixels, and zoom snaps to clean stops
(1×–16×) so a tile is always whole physical pixels. No blurry upscaled tiles, ever.

Tile roles must be distinguishable at a glance **without relying on hue alone**, in every
theme. Roles and their redundant encodings:

| Role | Base encoding (lightness) | Pattern/shape encoding |
|---|---|---|
| Wall | darkest mass in palette | solid block, top highlight edge |
| Room floor | clearly lighter than corridor | flat solid fill |
| Corridor floor | mid tone, visibly darker than room | small centred dot at zoom ≥ 3× |
| Door | room-lightness fill | thick perpendicular bar across opening |
| Dead end | corridor tone | diagonal cross mark at zoom ≥ 3× |
| Entrance | distinct accent hue | circle outline marker |
| Exit | second accent hue (hue-blind safe pair) | diamond outline marker |
| Unreachable region | desaturated tint | diagonal hatch overlay |

Markers (entrance circle, exit diamond, door bar, dead-end cross, hatching) are drawn in an
ink colour that always contrasts with both floor tones of the active theme. Because shape and
lightness carry the roles, deuteranopic and protanopic users lose nothing; hues are tuned so
the two accents sit on opposite sides of the confused axis (teal vs orange, never red vs green).

## Chrome

Layout is a fixed instrument frame, no floating glass:

```
┌──────────────────────────────────────────────────────────────┐
│ toolbar: name · algorithm · seed(+copy,+dice) · Generate ·    │
│          step mode · compare · export ▾ · theme ▾ · ?        │ 48px
├────────────┬──────────────────────────────────┬──────────────┤
│ parameters │            map canvas            │ metrics      │
│ (per-alg.) │      (empty state / failure      │ (tabular,    │
│ post-proc  │       state render here)         │  fixed col)  │
│ presets    │                                  │ legend       │
│ surprise   ├──────────────────────────────────┤              │
│            │ transport: ◀ ▶ play ▥ scrubber   │ (step mode)  │ 44px
└────────────┴──────────────────────────────────┴──────────────┘
   280px                 flexible                    264px
```

- Parameters are grouped: **Generation** (algorithm-specific, dynamically swapped),
  **Post-processing** (four independent toggles, each exposing its own numeric param inline
  only when enabled), **Presets** (chips), **Surprise me**.
- Every slider is paired with a numeric input showing the live value; the valid range is
  printed under the slider (`min – max`). Both controls are keyboard-operable and stay in sync.
- Buttons and toggles are flat, 1px-border, no shadows; hover changes background one step;
  selected states use the amber accent border, never a glow.
- Metrics panel uses a two-column table: label (sans) and value (mono, tabular-nums, right-
  aligned, fixed-width column) — a changing digit count cannot shift layout.
- Legend sits below metrics and renders its swatches with the exact same painter code as the
  map, so it can never drift from reality.

## Type scale

Sans stack for labels/UI: `"Inter", "Segoe UI", system-ui, sans-serif`.
Mono stack for values/seeds/code: `"JetBrains Mono", "Cascadia Mono", Consolas, monospace`.

| Token | Size | Weight | Use |
|---|---|---|---|
| display | 22px | 650 | app name |
| title | 15px | 600 | panel section headers |
| body | 13px | 400 | labels, descriptions |
| value | 13px | 500 | mono values, seed |
| small | 11px | 400 | ranges, hints, axis text |

## Spacing scale

4px base: 4 · 8 · 12 · 16 · 24 · 32 · 48. Panels pad 16px; groups separated by 24px;
controls spaced 8px; control-label gaps 4px. Radii: 6px controls, 10px panels. Border width:
1px everywhere; focus ring 2px accent at 2px offset.

## Colour tokens

Tokens are CSS custom properties (`--bg`, `--panel`, ... ) plus a JS palette object consumed
by the canvas painter. **No component hardcodes a colour.** Four themes ship; each defines
chrome + full tile palette and must pass the role-distinguishability check (any two roles
differ by ≥ 18% relative luminance OR have distinct patterns/shapes):

| Token | Dark Technical (default) | Light | High Contrast | Relic (map) |
|---|---|---|---|---|
| bg | #101419 | #eceef1 | #000000 | #171310 |
| panel | #171d24 | #f7f8f9 | #0a0a0a | #201a14 |
| panelBorder | #232c36 | #d4d9de | #555555 | #3a2f22 |
| ink | #e8edf2 | #1b2127 | #ffffff | #e9dcc3 |
| inkMuted | #8fa0ae | #5a6672 | #cccccc | #a8977d |
| accent | #e0a53c | #b07908 | #ffd23c | #c89b4b |
| focusRing | #e0a53c | #b07908 | #ffe066 | #c89b4b |
| tileWall | #26303b | #3d4753 | #1a1a1a | #45372a |
| tileWallEdge | #33404d | #4d5866 | #333333 | #57462f |
| tileRoom | #5b6b7c | #ffffff | #f2f2f2 | #e3d3ac |
| tileCorridor | #3c4956 | #cfd6dc | #a6a6a6 | #cdb98e |
| tileDoorFill | #5b6b7c | #ffffff | #f2f2f2 | #e3d3ac |
| tileDoorBar | #101419 | #1b2127 | #000000 | #241c10 |
| tileDeadEnd | #3c4956 | #cfd6dc | #a6a6a6 | #cdb98e |
| markerInk | #f2f6fa | #101419 | #ffffff | #1d150b |
| entrance | #43b8a5 (teal) | #0e8a77 | #37ffd0 | #1f6e60 |
| exit | #ef9d45 (orange) | #c05f00 | #ffb300 | #a34d12 |
| unreachableTint | #6e5a80 | #b3a3c4 | #7a6a8c | #7d6a52 |
| unreachableHatch | #b39ecb | #6a5880 | #d0bce8 | #9c8763 |

Accent pairs teal/orange were chosen to survive deuteranopia and protanopia; role identity
never depends on them because shapes and lightness already separate every role.

## Step-through animation rules

- Entering step mode re-runs generation while recording frames; the transport bar appears
  (it is part of the layout flow, so the map never jumps).
- Scrubber spans frame 0 → N; dragging scrubs instantly (no animation lag).
- Play advances frames at a rate set by a 3-position speed control (½× / 1× / 4×, base
  30 fps equivalent pacing by frame, not wall-clock decoration).
- Frame label ("carving corridors", "smoothing pass 3"…) renders in the transport bar — this
  is the teaching surface, keep it accurate per-frame.
- At the end of a run: playback stops on the final frame, the status reads
  "generation complete — N frames", nothing pulses, glows, or restarts.
- `prefers-reduced-motion: reduce` disables auto-play entirely: the scrubber remains the only
  transport, and the play button is hidden rather than merely inert.
- Recording is capped (adaptive stride keeps memory bounded); when capped, the scrubber still
  reaches the true final state and a note states frames were sampled.

## Required states (audited)

- **Empty state:** before any generation the canvas area shows a faint blueprint grid, the
  wordmark, one sentence of guidance ("choose an algorithm and press Generate"), and the
  keyboard hint. No fake data, no spinner.
- **Failure state:** validation/generation failures render as a bordered banner over the
  canvas area with the reason and the parameter most likely to fix it (messages come from the
  library's `ValidationError`s, which must name the offending parameter and its valid range).
- **Legend accuracy:** the legend lists exactly the roles present in the current view
  (e.g., the Door row disappears when door placement is off).
