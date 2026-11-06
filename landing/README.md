# The landing page (parked) — rebranded for Grace Cafe

The magazine landing page — cover, cake lab, story, diet wheel, gallery, visit —
used to be the app's front door. The app now serves only the table-ordering flow,
so this folder holds the page intact but **off the route tree**: nothing in `app/`
imports it, so Next never builds it and it costs the running site nothing.

Nothing was deleted. This is the same code that used to live in `app/`.

## What's here

| File | Was |
| --- | --- |
| `page.tsx` | `app/page.tsx` — the `/` route |
| `landing.css` | the landing half of `app/globals.css` (lines 99–2954) |
| `pieces.json` | `app/pieces.json` — the cake-slice sprite map |
| `components/Landing.tsx` | `app/_components/Landing.tsx` |
| `components/FX.tsx` | scroll progress, reveals, cursor, sprinkles |
| `components/HeroStage.tsx` | the exploding cake in the cover |
| `components/MenuIndex.tsx` | section 01 |
| `components/CakeLab.tsx` | section 02 — build-your-cake |
| `components/SliceWheel.tsx` | section 04 — the diet wheel |

`components/bits.tsx` is **not** here: the small shared pieces (`Cherry`, `Arrow`,
`Split`, `Roll`, `Drip`, the social icons…) stayed at `app/_components/bits.tsx`
because the menu uses them too. The moved components import them from there via
`@/app/_components/bits`.

The palette, type and easing tokens these styles build on stay in
`app/globals.css`, which every route loads — so `landing.css` only carries the
landing's own paint.

## Putting it back at `/`

1. `git mv landing/page.tsx app/page.tsx`
2. In that file, change the two relative imports to point back at this folder:
   `@/landing/components/Landing` and `@/landing/landing.css`.
   (Or move `components/`, `landing.css` and `pieces.json` into `app/` as well and
   restore the original relative paths — `HeroStage.tsx` reads `../pieces.json`.)
3. The images it uses are still in `public/` (`cake_bg.png`, `pieces/p0…p32.png`).

## Note

This page was written for the old table-ordering app (per-table QR cards and a
table picker). Tables are gone — guests now order from `/` by phone number — so
the `table` / `tables` props and the `.tbar` order bar here are leftovers. The bar's
CSS still lives at the top of `app/menu.css`.


> Rebranded for Grace Cafe: `Landing.tsx` and `MenuIndex.tsx` are rewritten for the cafe. `CakeLab.tsx`, `HeroStage.tsx` and `SliceWheel.tsx` are no longer used by the page. The gallery and menu photos are stock images — swap in real ones.
