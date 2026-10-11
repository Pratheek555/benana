# benana site

Landing page for benana. A live, procedurally generated Minecraft-style world fills the screen and keeps orbiting on its own; scrolling swaps the copy in place and moves the camera between shots (the page itself never moves).

- **Light mode → Overworld:** an island continent with snowy peaks, a cherry grove, birch and oak forests, flower meadows and beaches, under a golden-hour sun.
- **Dark mode → Nether:** crimson and warped forests of huge fungi, basalt deltas and nether wastes around a lava sea, closed in by cliffs and a glowstone-studded ceiling.

The toggle sits in the nav; the choice persists, and the first visit follows the system colour scheme.

## Rendering ("shaders" look, after Solas)

`src/world/`:

- `voxels.js` — block registry, voxel storage and a mesher that emits only visible faces with per-vertex ambient occlusion (Minecraft's smooth lighting). Block textures come from one texture array, so mipmaps never bleed between tiles. Leaves and plants sway in the wind in the vertex shader.
- `textures.js` — 16×16 built-in block textures in the vanilla style, drawn in code (no game assets) and seamlessly tileable; lit Voronoi "pebbles" for lumpy blocks; plus the resource-pack loader, lava texture and water normal map.
- `overworld.js`, `nether.js` — world generation, lights and particles (petals and pollen; embers, ash and spores).
- `sky.js` — sky dome with a round HDR sun, a stacked-slice volumetric-looking cloud deck, and GPU-animated particles.
- `post.js` — depth-aware height fog that scatters warm light toward the sun, screen-space crepuscular rays occluded by terrain and trees, rising Nether smoke, bloom on HDR emissives (lava, glowstone, shroomlight), and a filmic grade.
- `index.js` — builds the chosen dimension, water/lava, the orbiting camera, resolution and adaptive quality.

Resolution: at least ~2560×1440 internally (supersampled on 1080p screens, native on HiDPI). If frames stay slow it steps down in tiers (resolution to native density → fewer ray samples and smaller shadows → below native → no bloom).

Text can't be selected or copied, by design.

## Using a resource pack

The built-in textures are drawn in code. To use real-looking pack textures instead, copy a pack's block textures into `site/public/textures/block/` with vanilla file names (`stone.png`, `grass_block_top.png`, `oak_log.png`, `crimson_nylium_side.png`, …). Anything missing falls back to the built-in tile; greyscale grass and leaves are tinted with vanilla's plains colours, and animated strips use their first frame. Any resolution works (16×, 32×, 64×…).

Only use a pack you're allowed to redistribute: Mojang's own textures can't be published on a website. Openly licensed vanilla-style packs exist, e.g. *Pixel Perfection: Chorus Edit* (CC BY-SA 4.0). Put the attribution the licence requires in `site/public/textures/credit.txt`; the page shows it in the bottom-left corner.

## Run

```sh
cd site
npm install
npm run dev      # http://localhost:5173
npm run build    # → site/dist
```

`?preview` renders at low resolution with a fixed camera; it exists only for headless screenshots on CPU-only machines.

## Deploy to Vercel

1. vercel.com → Add New → Project → import `0xzcr/benana`.
2. Set **Root Directory** to `site` (framework: Vite is detected; `vercel.json` sets build and output).
3. Name the project `benana` to get `benana.vercel.app`.
