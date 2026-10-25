# Sprite Kit v2: Halloween enemy redesign (plan + style guide)

**Why:** the v0 Halloween enemies were quick stubs: one pumpkin shape reused with different extras. They should become real characters.
**Scope:** all nine event enemies, redesigned from the ground up. Names, roles, hitbox sizes, behaviour and balance stay as locked in
`docs/halloween-event.md`; only the art and the animation change.
**Bar:** a middle ground. Clearly more character and detail than Classic, still flat and readable at phone size, and cheap enough
to draw 300+ at once. This kit is meant to become the standard that Classic heroes and enemies are upgraded to after the event.

## 1. Keep / change against the current style

| Keep (the Crown Survivors idiom) | Change (the Tier-2 upgrade) |
| --- | --- |
| Ink `#3b2a1a` underlay rim around every shape | Rim weight by tier: 1.5 trash, 2 elite, 3 boss (world units) |
| Flat fills, no gradients on bodies | **Three tones per material** (light / base / shade). Light comes from the top-left; shade is a crescent on the lower-right |
| White rectangular eyes, ink pupils | Pupils look the way the sprite faces; **brows** and **lids** carry mood |
| Soft oval ground shadow | Unchanged |
| Gold crowns mean "boss" | Unchanged; the Night Gourd's crown is the Pumpkin Crown motif |
| Continuous sine wobble | **Discrete 4-frame cycles** (walk / flap / roll) + flash frame + tell pose, the same frame count the Artist pipeline uses |
| Sprites never flip | Sprites **face the player** (horizontal flip) |

## 2. Detail budget (what "middle ground" means)

| Tier | Size (radius) | Allowed | Not allowed |
| --- | --- | --- | --- |
| Trash | 7–10 | 1 silhouette hook, 3 tones on the main material, 1 secondary detail (ribs, bones, membrane), face | Text-thin lines under 1 unit, more than one accent colour |
| Elite | 8–11 | + 1 extra detail layer (vines, flame, cracks), brows, a tell pose | Glow on more than one element |
| Mini-boss | 30–34 | 2–3 detail layers, readable story detail (a sewn patch, a split, a wheel), tell pose per attack | Fine texture noise, photo-like shading |
| Final | 46 | Phase art (intact → cracked → burning), per-attack tells, one dominant accent glow | Covering the HUD bands (art stays within about 1.4× the radius) |

Readability rules:
- Each character must read as a **solid ink silhouette** alone; the review sheet checks this.
- Orange on deep purple is the core contrast. Faces must survive at 1× game scale on a phone (about 20 device px radius for trash).
- **One accent glow max** per enemy (artist brief). Props stay faceless so they never read as enemies.
- No gore, no candy mascots, no licensed characters. Pumpkin-first.
- **Menacing, not goofy** (revision 2). Lids and brows slant down toward the face centre (`eye` with `glare`). Carved eyes are angled
  (`slit`), never upright triangles. Mouths scowl with the corners down and show fangs (`snarl`). No upturned smiles, no buck teeth.
  Stay in the house style: chunky, readable and mean, never horror-realistic.

## 3. Palette ramps (`RAMP` in code)

| Ramp | Light | Base | Shade | Deep / line |
| --- | --- | --- | --- | --- |
| pumpkin | `#ffad55` | `#e8792a` | `#b8561a` | `#8a3a0c` (ribs) |
| gourd (Night Gourd) | `#d26a2a` | `#a8501c` | `#743010` | `#4a1d06` |
| stem / vine | `#7cc25a` | `#4f9a3a` | `#2f6a28` | — |
| bone | `#fffaea` | `#e8e0cc` | `#b6a888` | — |
| night (bat fur, iron) | `#6a5a8a` | `#3e3260` | `#241c3a` | — |
| wood | `#b08452` | `#86602f` | `#5e411d` | — |
| accents | carve glow `#ffe86a` / hot `#ff6a3a` | thorn `#e85a9a` | pulp `#ffc27a` | seed `#fff1c9` |

## 4. Character briefs

Every brief lists the silhouette hook, the detail layers, the 4-frame cycle and the tells. Radius = hitbox (unchanged).

| Character | Concept | Silhouette hook | Detail layers | 4-frame cycle | Tell |
| --- | --- | --- | --- | --- | --- |
| **Pip** (trash, r8) | Mean little rolling pumpkin | squat ball + curly stem | ribs that scroll to fake the roll; glaring square eyes; fanged scowl | bounce squash/stretch, ribs scroll, leaf flips | — |
| **Shade Bat** (trash, r7) | Purple-black bat with pumpkin-orange wing membranes and a stem curl on its head | wide scalloped wings | finger bones over orange membrane; ears, long fangs; angled orange slit eyes (its accent) | up / mid / down / mid flap, body bobs opposite | — |
| **Candy Skel** (trash, r10) | Bone skeleton with a carved pumpkin head, ragged candy-corn scarf, rusty sickle | tall: head on top + sickle hook | ribcage + pelvis; pumpkin head with angled carved eyes and a stitched frown; scarf; sickle | 2-step walk (legs alternate, head bobs, scarf swings) | — |
| **Jack Wisp** (elite, r8) | Jack-o'-lantern whose lid is knocked open; a flame climbs out of the top and trails behind as it floats | teardrop: lantern + flame tail | cracked lid; three-tongue flame; glowing angled eyes and fanged scowl (its one glow); ghost-flame tail away from the player | flame flickers through 4 shapes, bob | flicker to half alpha (elusive) |
| **Vine Gourd** (elite, r11) | Lumpy warty gourd strangled by thorn vines; one big eye peers out between them | lumpy blob + 3 lashing tendrils | smooth lobed body; green mottles; one strangling vine; V-glaring cyclops eye; fanged scowl | tendrils writhe through 4 poses | tendrils dig into the ground, eye flares green before a snare |
| **Patch Lord** (M1, r30) | Fat pumpkin tyrant with a crown of curled stems and a sewn-on patch | wide squat body + stem crown | 6 ribs, stitched cheek patch, glaring lids, wide fanged scowl, root feet | feet shuffle, body sways | rears up tall, eyes wide, roars, glow ring → slam squash |
| **Hollow Twin** (M2, r30) | One pumpkin split down a jagged crack: a glowing glare and scowl on one half, a stitched frown and one red eye in a hollow socket on the other | jagged split, halves offset | pulp + seeds in the split; carved glowing half-face; stitched half-face | halves breathe apart/together | fan: halves part and seeds glow. Dash: halves clamp and lean in |
| **Harvest Wheel** (M3, r34) | Angry pumpkin hub inside a spiked wooden cartwheel, straw sticking out | spiked ring | wood rim + iron band + 8 spokes + iron spikes; straw tufts; glaring lids + interlocking fangs | wheel rotates with travel | rev-up: spoke blur arcs + sparks, face strains |
| **The Night Gourd** (final, r46) | A massive dark pumpkin with a fused gold crown, a jagged fanged maw glowing from inside, thorn vines draping like roots | huge body + crown + root skirt | 8 deep ribs, brow ridge, snarling fanged maw (its glow), crown on a twisted stem, vine roots | body breathes, roots curl | volley: maw opens. Vines: roots glow. Rain: eyes flare. Charge: leans in |

Night Gourd phase art: **P1** intact. **P2** glowing crack seams and a chipped ridge. **P3** the top of the shell is broken open,
flames lick out around the crown, and the glow turns hot `#ff6a3a`.

## 5. How the code changes (`public/index.html`)

1. **Kit helpers** (`// ===== sprite kit v2 =====`), drawing at the origin in world units:
   - `RAMP` (the table above) and `F(c)` flash mapping (every non-ink fill turns white on a hit).
   - `shaded(path, ramp, rim)`: ink rim, then base, then a shade crescent (clipped offset copy of the shape), then a light dab.
   - `face` pieces: `eyesV2` (lids/brows/pupil look), `grin` (carved zigzag), `stitches`, `curlStem`, `leaf`, `thorns`, `seeds`.
2. **Character drawers**: one pure function per character, `(r, frame, state, fl)`, with no `e` or `G` inside. That keeps
   them cacheable and lets the review sheet draw them without a run.
3. **Sprite cache** for trash and elites: each frame is rendered once per (type, r, frame, state, flash, device scale) to an
   offscreen canvas at the *exact* device scale. It is then blitted 1:1 with `drawImage` (flipped toward the player), with image
   smoothing off for the enemy pass. Keys carry the scale, so a resize just starts new entries (capped at 900). Each type has a
   tight box (`SPRR`) to keep blits small. This is what pays for the extra detail with 300+ enemies on a phone. It is also where
   Artist PNG sheets can drop in later: same keys, image source instead of a draw call.
4. **Bosses** draw live (at most 3 on screen) with the same helpers, reading `e.tell / e.next / e.bph / e.vol` for poses.
5. Wire-up: `enemyS` routes Halloween types through the cache, `hwBossS` is replaced, and the title/menu orbiters use the new
   drawers. The v0 helpers (`pumpkin`, `pStem`, `sqEyes`, `carve`, `lashes`, `HWS`) are removed; `pcrown` and `soulEmber` move
   onto the kit. Hitboxes, AI and balance are untouched.

## 6. Review sheet

`?sheet=halloween` (off production, like `?event=`) opens a contact-sheet scene drawn with the live code. Each character gets
4 frames, the flash frame, the tell pose, an ink-only silhouette, a 1× in-game-scale strip on the arena ground, and a 3× zoom.
The Night Gourd also shows all three phases. The export lives at `art/halloween/halloween-v1-enemies.png` for review in the PR.
The same scene can later host `?sheet=classic` while Classic characters are upgraded.

## 7. Order of work (all done)

1. Kit helpers + cache + review-sheet scene (empty grid).
2. Trash: Pip, Shade Bat, Candy Skel.
3. Elite: Jack Wisp, Vine Gourd (+ Vine Gourd tell state).
4. Mini-bosses: Patch Lord, Hollow Twin, Harvest Wheel (tell poses).
5. The Night Gourd (phases + tells).
6. Wire into the game and menus, remove the v0 stubs, update `docs/halloween-event.md`.
7. Verify (below), export the sheet, and push to PR #6.

## 8. Verification

- Review sheet at phone and desktop sizes: silhouettes distinct, faces readable at 1×, flash and tell frames clear.
- In-game screenshots at 390×844: every enemy on the arena ground, mid-horde, with the HUD.
- Performance: frame time with ~300 Halloween enemies before (v0, live draw) and after (v2, cached), same headless run.
- Regression: the Classic run and Classic enemies are unchanged; there are no console errors. The existing browser tests (ritual
  ladder, auto-summon, boards) still pass.

Measured on 25 Oct 2026: draw-only frame rate with 320 Halloween enemies, 390×844 phone viewport, CPU throttled, simulation frozen.

| Renderer | v0 (live vector stubs) | v2 (cached frames) |
| --- | --- | --- |
| GPU canvas (Chrome, DPR 3, 6× throttle) | 27–50 fps | 59–60 fps (vsync cap), 51 cached frames |
| CPU raster (headless shell, DPR 2, 4× throttle) | 14–15 fps | 23–26 fps |

Review exports: `art/halloween/halloween-v1-enemies.png` (the `?sheet=halloween` scene) and `art/halloween/halloween-v1-in-game.png`.
Per-character model sheets with before/after renders: `__cs.art(id, opts)` returns a transparent PNG of any character, frame or pose
(used to build the Halloween Bestiary review page).

## 9. Upgrading Classic later (not in this PR)

Port each Classic character to a pure drawer on the same helpers and ramps, add it to `?sheet=classic`, and route it through the
cache. Heroes follow the same rules: 3 tones, brows/lids, 4-frame walk, with the crown kept as the hero identity.
