/* STRATOS — runtime config (plain script, loaded before the app).
 *
 * To make the LIVE features (visitor presence, real-time metrics, persistent
 * waitlist) 100% real on the static GitHub Pages site, deploy the Node backend
 * (see README → Deploy) and paste its URL here, e.g.:
 *
 *     backendUrl: "https://stratos-xxxx.onrender.com"
 *
 * Leave it empty to use the same origin (works when you run `npm start`
 * locally or host the full stack). When empty on a static host, the app
 * falls back to an in-browser simulator so nothing looks broken.
 */
window.STRATOS_CONFIG = {
  backendUrl: ""
};
