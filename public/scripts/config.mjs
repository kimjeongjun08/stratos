// STRATOS — resolves the backend base URL from window.STRATOS_CONFIG (config.js).
// When a backendUrl is set, API calls and the WebSocket point there (enabling
// real cross-origin live data on a static host). Otherwise everything is
// same-origin (full-stack `npm start`) or falls back to the simulator.

const cfg = (typeof window !== 'undefined' && window.STRATOS_CONFIG) || {};
export const BACKEND = String(cfg.backendUrl || '').replace(/\/+$/, '');

/** Build an API URL for a path like "api/stats". */
export function apiUrl(path) {
  const p = String(path).replace(/^\/+/, '');
  return BACKEND ? `${BACKEND}/${p}` : p;
}

/** Build the WebSocket URL. */
export function wsUrl() {
  if (BACKEND) return BACKEND.replace(/^http/i, 'ws') + '/ws';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** True when a dedicated backend is configured. */
export const HAS_BACKEND = Boolean(BACKEND);
