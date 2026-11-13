// Builds a Firefox package from the Chrome build.
//   npm run build-all      (creates dist/mpurse)
//   npm run build-firefox  (creates dist/mpurse-firefox)
//
// Firefox does not support `background.service_worker`; it runs the same
// script as a (non-persistent) event page through `background.scripts`.
// Everything else is shared with the Chrome build.
//
// Environment:
//   MPURSE_GECKO_ID  add-on id for browser_specific_settings.gecko.id.
//                    Required to sign/publish on addons.mozilla.org (it must
//                    match the id of the existing listing). Not needed to try
//                    the build with about:debugging "Load Temporary Add-on".
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'dist', 'mpurse');
const dest = path.join(root, 'dist', 'mpurse-firefox');

if (!fs.existsSync(path.join(src, 'manifest.json'))) {
  console.error('dist/mpurse/manifest.json not found. Run `npm run build-all` first.');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

const manifestPath = path.join(dest, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (!manifest.background || !manifest.background.service_worker) {
  console.error('manifest.background.service_worker is missing; nothing to convert.');
  process.exit(1);
}
manifest.background = { scripts: [manifest.background.service_worker] };

// chrome.storage.session needs Firefox 115 or later.
const gecko = { strict_min_version: '115.0' };
if (process.env.MPURSE_GECKO_ID) {
  gecko.id = process.env.MPURSE_GECKO_ID;
} else {
  console.warn('MPURSE_GECKO_ID is not set: building without an add-on id (fine for a temporary add-on, not for AMO).');
}
manifest.browser_specific_settings = { gecko };

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Firefox build written to ' + path.relative(root, dest));
