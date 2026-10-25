# Menu spacing

Every menu, overlay and panel uses one spacing system: the `UI` tokens and helpers next to `panel()` in `public/index.html`.
Values are in `U`, the game's screen unit (1 U = 1 px on a 360×640 phone).

| Token | Value | Used for |
| --- | --- | --- |
| `gap` | 10 | Space between buttons, down and across (stacks, rows, bottom-bar icons, curse picker) |
| `pad` | 16 | Inside panel edges: content and buttons stay this far from the panel border; a panel's last button sits `pad` above its bottom |
| `head` | 20 | Space above a panel heading |
| `list` | 8 | Between list rows (hero cards) |
| `pri` | 220 × 54 | Primary button (PLAY, HALLOWEEN ENDLESS, START RUN, AGAIN, RESUME) |
| `sec` | 105 × 42 | Secondary button; two plus a `gap` fill a primary's width. A single secondary spans that width |
| `back` | 120 × 42 | BACK / SKIP, including the leaderboard and events screens |

Helpers:

- `bPri(label, y, onTap, colour, pulse)` draws a centred primary button.
- `bRow(y, [label, onTap, colour], [label, onTap, colour])` draws a row of two secondaries (pass one item for a full-width row).
- `bBack(y, onTap)` draws a back button.
- `head(text, panelTop, size, …)` draws a panel heading.
- `titleStack(…)` lays out the title buttons: primary + rows, kept `pad` above the bottom bar. The hint line only shows if it fits.
- `overY()` returns the positions of the over-screen buttons, anchored to the panel bottom.
- Labels shrink to fit their button (`fitSz`).

Layout rules:

- Stacks anchor to the bottom of their panel (or to the bottom bar on the title), so short phones never push a button onto an edge.
- The same structure repeats across screens. Every title is one primary plus rows of two. Over screens are AGAIN + [UPGRADES | HOME]. Pause is RESUME + GIVE UP.
- The leaderboard, events archive and sign-in card are drawn in their own 390 × 844 design space. They use the same back size.

Checked at 360×640, 390×844 and 1280×800 on every screen: titles (Classic, event, after the event), choose hero (both modes),
upgrades, settings (title and pause), leaderboards (Classic and event), events archive, level-up, pause, and both over screens.
