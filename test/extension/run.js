// Runs the extension script tests in Node.
//   npm run test:extension             all tests (needs `npm ci` first)
//   node test/extension/run.js reference   only reference.test.js
const fs = require('fs');
const path = require('path');
const { run, test } = require('./harness');

const only = process.argv.slice(2);
const files = fs
  .readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => only.length === 0 || only.some(o => f.startsWith(o)))
  .sort((a, b) => (a === 'reference.test.js' ? -1 : b === 'reference.test.js' ? 1 : a.localeCompare(b)));

for (const f of files) {
  try {
    require(path.join(__dirname, f));
  } catch (e) {
    // e.g. node_modules missing: report it as a failure instead of crashing
    test(f + ' (loading)', () => {
      throw e;
    });
  }
}

run().then(failed => {
  process.exitCode = failed ? 1 : 0;
});
