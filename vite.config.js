import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import { GIS_UPSTREAMS } from './shared/gis-upstreams.js';

// Same-origin development proxy for public ArcGIS REST services (production uses the Express
// proxy in server/app.js). Both read the same upstream table in shared/gis-upstreams.js.
const gisProxy = Object.fromEntries(
  Object.entries(GIS_UPSTREAMS).map(([name, { origin, path }]) => [
    `/gis/${name}`,
    {
      target: origin,
      changeOrigin: true,
      secure: true,
      rewrite: (p) => p.replace(`/gis/${name}`, path),
      timeout: 45000,
      proxyTimeout: 45000,
    },
  ]),
);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    open: true,
    proxy: {
      ...gisProxy,
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false },
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { chunkSizeWarningLimit: 2500 },
});
