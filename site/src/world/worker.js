// Builds a dimension off the main thread: terrain generation + meshing take 1–2 s, which would
// otherwise freeze the page (and its text animations) while the world loads.
import { mesh, transferables } from './voxels.js';
import { generateOverworld } from './overworld.js';
import { generateNether } from './nether.js';

self.onmessage = ({ data: { theme, size } }) => {
  const { vox } = theme === 'dark' ? generateNether(size) : generateOverworld(size);
  const m = mesh(vox);
  const v = { sx: vox.sx, sy: vox.sy, sz: vox.sz, ox: vox.ox, oz: vox.oz, data: vox.data, top: vox.top };
  self.postMessage({ mesh: m, vox: v }, [...transferables(m.solid), ...transferables(m.cutout), vox.data.buffer, vox.top.buffer]);
};
