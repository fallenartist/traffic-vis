// The browser token comes only from local/build environment configuration.
// GitHub Actions supplies it from an encrypted repository secret.
export const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN || '').trim();
export const MAPBOX_STYLE = import.meta.env.VITE_MAPBOX_STYLE || 'mapbox://styles/fallenartist/cm7sxk04k00oq01sb1bbf0xf6';
