# Halloween Event — V0 Direction

Poster sheet for review before any Halloween gameplay. One field, the pumpkin roster, and the Soul Embers pickup.

| File | Purpose |
|------|---------|
| `halloween-v0-direction.html` | Canvas source. Drawing follows live `enemyS` / `bossS` (ink `#3b2a1a`, flat fills, rect eyes, oval shadows). |
| `halloween-v0-direction-1920.png` | 1920×1080 export |

Roster, labelled on the sheet: Pip, Shade Bat, Candy Skel, Jack Wisp, Vine Gourd, Patch Lord, Hollow Twin, Harvest Wheel, The Night Gourd.

Pickup: **Soul Embers** — 32×32 summon currency enemies drop.

## Regenerate PNG

```bash
google-chrome --headless=new --disable-gpu --no-sandbox --force-device-scale-factor=1 \
  --user-data-dir=/tmp/chrome-halloween --window-size=1920,1080 \
  --screenshot=art/halloween/halloween-v0-direction-1920.png \
  "file://$PWD/art/halloween/halloween-v0-direction.html?export=1"
```
