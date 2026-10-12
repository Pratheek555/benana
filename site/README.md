# benana site

Landing page for benana. A live, procedurally generated Minecraft-style world fills the screen and keeps orbiting on its own; scrolling swaps the copy in place and moves the camera between shots (the page itself never moves).

- **Light mode → Overworld:** an island continent with snowy peaks, a cherry grove, birch and oak forests, flower meadows and beaches, under a golden-hour sun.
- **Dark mode → Nether:** crimson and warped forests of huge fungi, basalt deltas and nether wastes around a lava sea, closed in by cliffs and a glowstone-studded ceiling.

The toggle sits in the nav and the choice persists; first visits always open in the Overworld.

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

## Real gameplay footage (optional)

If `public/video/overworld.{webm,mp4}` / `public/video/nether.{webm,mp4}` exist, the page plays that footage as the background instead of the live 3D world (each dimension falls back independently). Scrolling eases the footage slightly closer per scene. WebM (VP9) is used where the browser supports it, otherwise MP4.

Use footage you recorded yourself and check [Mojang's usage guidelines](https://www.minecraft.net/en-us/usage-guidelines) before publishing it on a product site (don't imply Mojang endorses benana).

Recording tips for the "running on shaders" look:

1. Minecraft Java + Iris + the Solas shader pack, render distance 24+, FOV ~70, hide the HUD (F1).
2. Record smooth, slow camera paths with the Replay Mod (keyframed camera) at 2560×1440 or 4K, 60 fps, 20–40 s, ideally ending where it began so the loop is seamless.
3. Encode (no audio; the video is muted anyway):

```sh
# VP9 WebM, ~1440p, small enough for git/Vercel
ffmpeg -i raw.mov -an -vf "scale=2560:-2,fps=30" -c:v libvpx-vp9 -b:v 0 -crf 34 -row-mt 1 -deadline good -cpu-used 2 public/video/overworld.webm
# H.264 MP4 fallback (Safari)
ffmpeg -i raw.mov -an -vf "scale=2560:-2,fps=30" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart public/video/overworld.mp4
```

Keep each file well under 50 MB (GitHub rejects files over 100 MB); for longer or 4K clips, host the files on a CDN and adjust the paths in `src/main.js`.

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
