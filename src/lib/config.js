// Optional vector layers (tree-canopy polygons, walkways, green space). They live on servers
// that were unreachable in the field ("Failed to fetch"), so they are OFF by default and the app
// scores with what is available. Set VITE_ENABLE_EXTRA_LAYERS=true in .env to turn them back on.
export const EXTRA_LAYERS = import.meta.env.VITE_ENABLE_EXTRA_LAYERS === 'true';
export const CORE_VECTOR_KEYS = ['buildings', 'parking'];
export const EXTRA_VECTOR_KEYS = ['canopy', 'paths', 'greenspace'];
export const VECTOR_KEYS = EXTRA_LAYERS ? [...CORE_VECTOR_KEYS, ...EXTRA_VECTOR_KEYS] : CORE_VECTOR_KEYS;
