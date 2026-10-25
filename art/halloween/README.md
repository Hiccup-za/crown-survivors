# Halloween Event — V0 Direction Sheet

Review artifact for Christopher before any in-game Halloween implementation.

| File | Purpose |
|------|---------|
| `halloween-v0-direction.html` | Canvas source (forks live `enemyS` / UI chrome from `public/index.html`) |
| `halloween-v0-direction-1920.png` | 1920×1080 contact sheet export |

## Regenerate PNG

```bash
google-chrome --headless=new --disable-gpu --window-size=1920,1080 \
  --screenshot=art/halloween/halloween-v0-direction-1920.png \
  "file://$PWD/art/halloween/halloween-v0-direction.html?export=1"
```

Or open the HTML locally and use **Download PNG**.
