// Fetch small public GeoJSON snapshots of the campus layers (run on a machine with network
// access to the USF/ArcGIS services):   npm run snapshot
//
// Writes public/data/<layer>.geojson (+ bullsMeta provenance) and public/data/source-manifest.json
// so the app can fall back to a clearly labelled cached snapshot when a live service is down.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import {
  DATASETS, loadCampusBoundary, loadDataset, readLayerMeta, setGisBase,
} from '../src/lib/data.js';
import { SOURCES } from '../shared/sources.js';

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
await fs.mkdir(outDir, { recursive: true });

// Reuse the production proxy so the snapshot uses exactly the same upstream table as the app.
const server = createApp({ env: {} }).listen(0);
const { port } = server.address();
setGisBase(`http://127.0.0.1:${port}`);

const manifest = { generatedAt: new Date().toISOString(), note: 'Public cached snapshots; provenance travels with the data.', layers: {} };
try {
  const { campus, featureCollection } = await loadCampusBoundary();
  await fs.writeFile(path.join(outDir, 'campus.geojson'), JSON.stringify(featureCollection));
  for (const key of ['buildings', 'parking', 'canopy', 'paths', 'greenspace']) {
    try {
      const meta = await readLayerMeta(key);
      const { collection, count } = await loadDataset(key, campus);
      const retrievedAt = new Date().toISOString();
      const sourceId = DATASETS[key].sourceId || (key === 'canopy' ? 'src-canopy' : `src-${key}`);
      const entry = {
        sourceId, sourceUrl: SOURCES[sourceId]?.url ?? null, title: meta.name, layerKey: key,
        crsRequested: 'EPSG:4326 (outSR=4326)', crsNative: meta.wkid, count, retrievedAt,
      };
      await fs.writeFile(path.join(outDir, `${key}.geojson`), JSON.stringify({ ...collection, bullsMeta: entry }));
      manifest.layers[key] = entry;
      console.log(`✔ ${key}: ${count} features`);
    } catch (error) {
      manifest.layers[key] = { error: String(error.message || error) };
      console.warn(`✖ ${key}: ${error.message || error}  → GO/YELLOW/RED: mark RED/YELLOW for this layer`);
    }
  }
} finally {
  server.close();
}
await fs.writeFile(path.join(outDir, 'source-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Manifest written to ${path.join(outDir, 'source-manifest.json')}`);
