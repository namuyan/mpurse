// Minimal test runner and loader for the extension scripts.
//
// The extension scripts are TypeScript that webpack bundles for the browser.
// To test them in Node without a build, `.ts` files are transpiled on require
// with the project's TypeScript, and two bundling details are reproduced:
//  - bitcore-lib resolves to the top-level copy (see webpack.config.js), since
//    bitcore-lib throws when a second copy is loaded;
//  - external/mnemonic.js is a UMD file that webpack loads through its AMD
//    branch, so its module value is the Mnemonic function itself.
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(__dirname, '../..');

let tsHookInstalled = false;
function installTsHook() {
  if (tsHookInstalled) {
    return;
  }
  tsHookInstalled = true;
  const ts = require(path.join(ROOT, 'node_modules/typescript'));

  Module._extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const out = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2017,
        experimentalDecorators: true
      }
    });
    module._compile(out.outputText, filename);
  };

  const bitcoreLib = require.resolve('bitcore-lib', { paths: [ROOT] });
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function(request, ...rest) {
    if (request === 'bitcore-lib') {
      return bitcoreLib;
    }
    return originalResolve.call(this, request, ...rest);
  };

  const mnemonicFile = path.join(ROOT, 'extension_scripts/external/mnemonic.js');
  const originalJs = Module._extensions['.js'];
  Module._extensions['.js'] = (module, filename) => {
    originalJs(module, filename);
    if (filename === mnemonicFile && module.exports.Mnemonic) {
      module.exports = module.exports.Mnemonic;
    }
  };
}

// Loads extension_scripts/<name>.ts and returns its exports.
function load(name) {
  installTsHook();
  return require(path.join(ROOT, 'extension_scripts', name));
}

// The Electrum 1 word list, read without running Mpurse's code paths.
function electrum1Words() {
  const file = path.join(ROOT, 'extension_scripts/external/mnemonic.js');
  const m = { exports: {} };
  new Function('module', 'exports', 'define', fs.readFileSync(file, 'utf8')).call(
    m.exports,
    m,
    m.exports,
    undefined
  );
  return m.exports.Mnemonic.words;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log('ok   ' + t.name);
    } catch (e) {
      failed++;
      console.log('FAIL ' + t.name);
      console.log('     ' + String((e && e.stack) || e).replace(/\n/g, '\n     '));
    }
  }
  console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  return failed;
}

module.exports = { ROOT, load, electrum1Words, test, run };
