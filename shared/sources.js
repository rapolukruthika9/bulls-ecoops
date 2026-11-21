// Curated source registry. Every metric carries one of these IDs, and the proposal
// validator only allows URLs that appear here. The server holds the authoritative copy;
// the client copy is only used for display.

export const SOURCES = {
  'src-canopy': {
    id: 'src-canopy',
    title: 'Tampa Urban Tree Canopy 2021 — land-cover polygons (layer 9, Tree Canopy)',
    url: 'https://gis.waterinstitute.usf.edu/arcgis/rest/services/Maps/Tampa_2021_TreeCanopy/MapServer/9',
    kind: 'public-gis',
    note: 'Regional 2021 study polygons; not a live measurement.',
  },
  'src-paths': {
    id: 'src-paths',
    title: 'USF Community Maps — Sidewalks/Footpaths (layer 11)',
    url: 'https://maps.usf.edu/server/rest/services/University_Facilities/Community_Maps_Layers/MapServer/11',
    kind: 'public-gis',
    note: 'Pedestrian line network; not a routing or ADA assessment.',
  },
  'src-green': {
    id: 'src-green',
    title: 'USF Community Maps — Campus Green Space (layer 18)',
    url: 'https://maps.usf.edu/server/rest/services/University_Facilities/Community_Maps_Layers/MapServer/18',
    kind: 'public-gis',
    note: 'Green-space polygons; adjacency is planning context, not evidence of soil suitability.',
  },
  'src-buildings': {
    id: 'src-buildings',
    title: 'USF Building Footprints (FeatureServer layer 1)',
    url: 'https://services6.arcgis.com/eohpBf8Xt7P2A4up/ArcGIS/rest/services/USF_Building_Footprints/FeatureServer/1',
    kind: 'public-gis',
    note: 'Footprint area is a roof-area proxy; roof geometry has not been verified.',
  },
  'src-parking': {
    id: 'src-parking',
    title: 'USF Surface Parking Lots (FeatureServer layer 1)',
    url: 'https://services6.arcgis.com/eohpBf8Xt7P2A4up/ArcGIS/rest/services/Parking_Lots_Garages/FeatureServer/1',
    kind: 'public-gis',
    note: 'Mapped parking surface; not all area can be covered.',
  },
  'src-openspace': {
    id: 'src-openspace',
    title: 'Derived open-space screening (USF campus boundary minus building footprints, parking lots and stadium/athletic buildings)',
    url: null,
    kind: 'method',
    note: 'Computed in code from public USF GIS polygons. May still include roads, ponds, athletic fields or utilities — field verification required.',
  },
  'src-pvwatts': {
    id: 'src-pvwatts',
    title: 'NLR PVWatts V8 (modelled annual AC output)',
    url: 'https://developer.nlr.gov/docs/solar/pvwatts/v8/',
    kind: 'model',
    note: 'Model estimate from declared system inputs and solar-resource data.',
  },
  'src-epa-swc': {
    id: 'src-epa-swc',
    title: 'EPA National Stormwater Calculator (reference methodology only)',
    url: 'https://www.epa.gov/water-research/national-stormwater-calculator',
    kind: 'reference',
    note: 'BULLS ECOOPS uses a simpler transparent formula; it is not EPA SWC.',
  },
  'src-assumption': {
    id: 'src-assumption',
    title: 'User-declared scenario assumption',
    url: null,
    kind: 'assumption',
    note: 'Entered by the user in EcoPlanner; not measured or sourced.',
  },
  'src-method': {
    id: 'src-method',
    title: 'BULLS ECOOPS screening formula (computed in code)',
    url: null,
    kind: 'method',
    note: 'Transparent project-screening heuristic with adjustable weights.',
  },
};

export const SOURCE_IDS = Object.keys(SOURCES);
export const ALLOWED_URLS = new Set(
  Object.values(SOURCES).map((s) => s.url).filter(Boolean),
);

export function getSource(id) {
  return SOURCES[id] || null;
}

export const SCENARIO_LABEL = 'SCENARIO ESTIMATE';
export const SCREENING_DISCLAIMER =
  'Screening candidate — engineering, facilities, stormwater and arborist review required. Not an official USF recommendation.';
