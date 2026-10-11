# benana site

Landing page for benana: a live, procedurally generated voxel world fills the screen, and scrolling swaps the copy in place (the page itself never moves).

- `src/world.js` — three.js world: terrain, trees, lake, drifting clouds, pollen, golden-hour sky. All textures are generated pixel art (no game assets), sampled with nearest filtering so blocks stay sharp at any resolution. Renders at ≥2560×1440 internally (supersampled on 1080p screens, native on HiDPI), and steps quality down automatically if the GPU can't keep up.
- `src/main.js` — split-text reveals (masked rise, blur-in, per-character stagger), scroll-snap scene sequence, keyboard stepping, camera shot per scene.
- `src/style.css` — transparent nav, glow on hover for all text (per-character on headlines), `prefers-reduced-motion` support.

The nav's pricing / download / marketplace links are intentionally inactive ("soon" on hover).

## Run

```sh
cd site
npm install
npm run dev      # http://localhost:5173
npm run build    # → site/dist
```

`?preview` renders the world at low resolution; it exists only for headless screenshots on CPU-only machines.

## Deploy to Vercel

1. vercel.com → Add New → Project → import `0xzcr/benana`.
2. Set **Root Directory** to `site` (framework: Vite is detected; `vercel.json` sets build and output).
3. Name the project `benana` to get `benana.vercel.app` (if the name is taken, Vercel appends a suffix; pick another under Settings → Domains).

Or from a machine logged in to the Vercel CLI:

```sh
cd site && npx vercel --prod --name benana
```
