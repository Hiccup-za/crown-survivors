# dev/

Local development output. Nothing here is deployed.

## reports/

Bug reports filed with **F8** in the game while dev mode is on (`localhost`, `127.0.0.1` or `?debug`, never production), written by the Workshop server (`npm run workshop`). The folder is git-ignored because screenshots are large.

Each report is one folder, `reports/<id>/`, where `<id>` is the time plus a slug of the note:

- `README.md`: start here. The note, a summary of the run (mode, hero, build, run time, HP, enemies, boss and phase, Night Rank), the captured errors with stacks, and the replay link.
- `screenshot.png`: the canvas when F8 was pressed.
- `report.json`: everything else, including `status` (`open` or `resolved`), the last 50 errors and the full state: `state.S` (the save) and `state.G` (the run).

### Reading `state`

Plain JSON with four markers:

| Marker | Meaning |
| --- | --- |
| `"$id": n` | This object is referenced elsewhere; it is written in full only here |
| `{"$r": n}` | A reference to the object with `"$id": n` (for example `G.boss` and `G.hw.live` point into `G.en`) |
| `{"$set": [...]}`, `{"$map": [[k, v], ...]}` | A Set or a Map |
| `{"$n": "Infinity"}` | A non-finite number (`NaN`, `Infinity`, `-Infinity`) |

Functions, canvases, ImageData and the floor blood cache (`G.blood`) are left out. An array that is referenced more than once is written as `{"$id": n, "$a": [...]}`.

### Reproducing a report

With `npm run workshop` running, open `http://localhost:8790/play?report=<id>` (or **Replay in game** in the Workshop's Reports tab). The game loads that exact moment frozen; resume or step it from the banner or the debug menu (backtick). A replay never writes to `localStorage`, syncs a cloud save or sends telemetry, and F8 in a replay files a follow-up report with `replayOf` set.

When a report is fixed, mark it resolved in the Reports tab (this writes `status` into `report.json`).

See [docs/development.md](../docs/development.md#workshop) for the Workshop, the debug menu and the dev-mode rules.
