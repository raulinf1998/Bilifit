import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-worker.mjs');
const destDir = path.join(root, 'public', 'vendor');
const dest = path.join(destDir, 'maplibre-gl-worker.mjs');

if (fs.existsSync(src)) {
  fs.mkdirSync(destDir, { recursive: true });
  const srcStat = fs.statSync(src);
  const needsCopy =
    !fs.existsSync(dest) || fs.statSync(dest).size !== srcStat.size;
  if (needsCopy) {
    fs.copyFileSync(src, dest);
  }
}
