import { cp, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const requested = process.argv[2];
for (const site of requested ? [requested] : ['logic-lab', 'gate-quest']) {
  if (!['logic-lab', 'gate-quest'].includes(site)) throw new Error('Unknown site');
  const web = path.join(root, site, 'web'), dist = path.join(root, site, 'dist');
  await mkdir(path.join(web, 'shared'), { recursive: true });
  for (const name of ['engine.mjs', 'editor.mjs', 'editor.css']) await cp(path.join(root, 'shared', name), path.join(web, 'shared', name));
  await mkdir(dist, { recursive: true });
  for (const entry of await readdir(web)) await cp(path.join(web, entry), path.join(dist, entry), { recursive: true });
  console.log(`Built ${site}/dist`);
}
