// Single table of public ArcGIS upstreams. Used by the Vite dev proxy, the Express
// production proxy and the snapshot script, so they can never drift apart.

const USF_ARC = '/eohpBf8Xt7P2A4up/ArcGIS/rest/services';
const WATER = 'https://gis.waterinstitute.usf.edu';
const CANOPY_PATH = '/arcgis/rest/services/Maps/Tampa_2021_TreeCanopy/MapServer';

export const GIS_UPSTREAMS = {
  campus: { origin: 'https://services6.arcgis.com', path: `${USF_ARC}/USF_Campus_Boundaries/FeatureServer` },
  buildings: { origin: 'https://services6.arcgis.com', path: `${USF_ARC}/USF_Building_Footprints/FeatureServer` },
  parking: { origin: 'https://services6.arcgis.com', path: `${USF_ARC}/Parking_Lots_Garages/FeatureServer` },
  canopy: { origin: WATER, path: CANOPY_PATH },
  lst: { origin: WATER, path: CANOPY_PATH },
  // USF University Facilities "Community Maps Layers": sidewalks/footpaths (11), green space (18)
  usfmaps: { origin: 'https://maps.usf.edu', path: '/server/rest/services/University_Facilities/Community_Maps_Layers/MapServer' },
};

/** Paths the proxy is willing to forward: layer metadata, layer query, MapServer export. */
export const ALLOWED_GIS_PATH = /^\/(?:\d+(?:\/query)?|export)$/;
