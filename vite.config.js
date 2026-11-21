import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Same-origin development proxy for public ArcGIS REST services.
// Rewriting to full remote paths avoids ambiguity when proxy targets contain
// their own URL pathname segments.
const serviceProxy = (target, prefix, remotePath) => ({
  target,
  changeOrigin: true,
  secure: true,
  rewrite: (path) => path.replace(prefix, remotePath),
  timeout: 45000,
  proxyTimeout: 45000,
});

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    open: true,
    proxy: {
      '/gis/campus': serviceProxy(
        'https://services6.arcgis.com',
        '/gis/campus',
        '/eohpBf8Xt7P2A4up/ArcGIS/rest/services/USF_Campus_Boundaries/FeatureServer',
      ),
      '/gis/buildings': serviceProxy(
        'https://services6.arcgis.com',
        '/gis/buildings',
        '/eohpBf8Xt7P2A4up/ArcGIS/rest/services/USF_Building_Footprints/FeatureServer',
      ),
      '/gis/parking': serviceProxy(
        'https://services6.arcgis.com',
        '/gis/parking',
        '/eohpBf8Xt7P2A4up/ArcGIS/rest/services/Parking_Lots_Garages/FeatureServer',
      ),
      '/gis/canopy': serviceProxy(
        'https://gis.waterinstitute.usf.edu',
        '/gis/canopy',
        '/arcgis/rest/services/Maps/Tampa_2021_TreeCanopy/MapServer',
      ),
      '/gis/lst': serviceProxy(
        'https://gis.waterinstitute.usf.edu',
        '/gis/lst',
        '/arcgis/rest/services/Maps/Tampa_2021_TreeCanopy/MapServer',
      ),
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
