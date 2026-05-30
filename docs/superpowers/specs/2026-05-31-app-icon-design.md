# Pansutong app icon — design record

**Date:** 2026-05-31
**Status:** Implemented
**Source of truth:** `src-tauri/icons/icon.svg`

## Goal

A professional app icon for Pansutong that communicates **life task tracking** at a
glance and holds up from 512px down to 16px, on both Windows desktop and Android
(including circular/adaptive masks).

## Concept

A **golden leaf shaped like a quill pen** writing into an **empty white checkbox**,
on a rounded app tile:

- The hero is one bold **golden leaf** whose bottom tapers to a **pen nib**, with a
  central **ink-slit / midrib** line running up from the nib. It reads as both a
  **leaf** (the *"life"* in *life task tracking*) and a **quill pen** (the
  *writing / tracking*), in one shape.
- It is **tilted 45°** — nib at the lower-right, feather body sweeping up to the
  upper-left — the natural angle of a pen held mid-stroke.
- A small **empty white rounded checkbox** sits in the **bottom-right**,
  **equidistant from the bottom and right edges**, with the leaf's **nib resting on
  top of it** — the quill "writing"/ticking into a task box. This adds the task
  meaning without a literal checklist.
- On the indigo→violet tile with a soft top-left sheen for depth — which keeps the
  mark bold and crisp at every size.

The design is the result of many rounds of direction from the owner: the leaf must
be the **main visual**, **large**, **detailed**, **look like a pen**, **tilted
45°**, stay **visible at small sizes**, and rest on a **small white checkbox** that
is evenly inset from the bottom-right corner.

### Rejected directions

- **Goldfish** — an early free-association from the gold palette. Playful but says
  nothing about task tracking; reads as a toy, not a tool. Dropped.
- **Tag + checkmark**, **bare checkbox**, **pen + check** — on-theme but generic or
  weak when small.
- **Checklist note** (dog-ear fold / clipboard-clip / corner leaf / quill in the
  corner) — a long line of iterations. The note made the leaf a secondary accent
  that vanished at 16px, conflicting with the brief that the **leaf be the hero**.
  Dropped entirely.
- **Leaf + check / leaf + mountain compositions** — check *on* the leaf, check
  *knocked out*, a white check *peeking from behind*, and two checks arranged as a
  **mountain** base were all tried. They split focus from the leaf and/or muddied at
  small sizes; that element was dropped.
- **Detail studies** — smooth leaf with veins, glossy-sheen leaf, and a
  serrated-edge leaf were compared, then refined toward a **quill** by tapering the
  base into a nib. Quill variants (clean nib, feather barbs, carved nib-split V)
  were rendered at 16–512px; the **clean central nib-slit** won for staying sharp at
  small sizes.
- **Checkbox treatments** — a filled white box *with* a tick (under the nib) was
  tried first, then simplified per the owner to an **empty white box with the leaf
  nib resting on top of it**, finally positioned equidistant from the bottom-right
  edges (the leaf was mirrored to suit).

## Palette

Indigo → deep-violet gradient tile, golden quill-leaf, white checkbox — chosen to
(a) sit next to the in-app accent (`--c-accent` `#4338ca` / dark `#818cf8`) and
(b) keep the gold + purple identity the owner asked for. Depth comes from the
gradients and sheen, not from added detail:

| Element        | Value(s)                                   |
|----------------|--------------------------------------------|
| Tile gradient  | `#5B53F0` → `#4326B0` (diagonal)           |
| Top-left sheen | white radial, 20% → 0% opacity             |
| Leaf gradient  | `#EA8C0B` → `#FBBF24` → `#FDE68A` (diagonal)|
| Leaf size/tilt | ~440/512 tall, tapered nib, rotated −45°   |
| Ink-slit / midrib | `#B45309`, 11px stroke @ 50% opacity, round caps |
| Checkbox       | empty `#FFFFFF` rounded square, 118px, r≈31; inset 64px from bottom & right; nib overlaps its top |

Tile corner radius `114/512` matches the Windows squircle / Android conventions.

## Production

The single `src-tauri/icons/icon.svg` (512×512, transparent) is the master.
Regenerate every platform asset with:

```
npm run tauri -- icon src-tauri/icons/icon.svg
```

This produces the desktop set (`.ico`, `.icns`, `32/64/128/128@2x/icon` PNGs,
`Square*Logo` / `StoreLogo` for Windows Store), the iOS `AppIcon-*` set, and —
because `src-tauri/gen/android` exists — the Android adaptive-icon assets
(`mipmap-*` launcher/foreground/round PNGs, plus the `mipmap-anydpi-v26` and
`values/ic_launcher_background.xml` config).

> Note: only `src-tauri/gen/schemas` is gitignored (see `src-tauri/.gitignore`),
> **not** `gen/android` — so the regenerated Android launcher assets are tracked
> and committed alongside the desktop/iOS icons in this change.

## Verification

Rendered concepts in a headless browser at 16–512px and circle-masked throughout
design (concept, leaf size/tilt/detail, quill shape, checkbox placement). After
generation, the **actual** Tauri output PNGs (resvg renderer, not the browser) were
regenerated from the final SVG: the golden quill-leaf fills the tile as the
dominant shape, the nib + ink-slit keep the pen read, the white checkbox stays
visible under the nib and evenly inset from the bottom-right, and it all stays
recognizable through 32px and inside the circular Android mask.
