// Tests for extension_scripts/util.bitcore.ts (needs `npm ci`).
const assert = require('assert');
const { webcrypto } = require('crypto');
const { test, load, electrum1Words } = require('./harness');
const r = require('./reference');
const v = require('./vectors');

const { BitcoreUtil } = load('util.bitcore');

// This build uses Monacoin testnet. The fixed vectors are mainnet; key
// derivation does not depend on the network, so the vector tests run with
// the mainnet network and the testnet setting is checked separately below.
const SHIPPED_NETWORK = BitcoreUtil.NETWORK;
BitcoreUtil.NETWORK = require('bitcore-lib').Networks.mainnet;

function withShippedNetwork(fn) {
  const old = BitcoreUtil.NETWORK;
  BitcoreUtil.NETWORK = SHIPPED_NETWORK;
  try {
    return fn();
  } finally {
    BitcoreUtil.NETWORK = old;
  }
}

function mpurseAddress(mnemonic, seedVersion, basePath, index) {
  const hd = BitcoreUtil.getHDPrivateKey(mnemonic, seedVersion);
  return BitcoreUtil.getAddress(BitcoreUtil.getPrivateKey(hd, basePath, index));
}

// The Electrum 1 generator reads window.crypto, as in the browser.
function withWindowCrypto(fn) {
  const had = 'window' in globalThis;
  const old = globalThis.window;
  globalThis.window = { crypto: webcrypto };
  try {
    return fn();
  } finally {
    if (had) {
      globalThis.window = old;
    } else {
      delete globalThis.window;
    }
  }
}

test('bitcore: the network is Monacoin testnet', () => {
  assert.strictEqual(SHIPPED_NETWORK.pubkeyhash, 111);
  assert.strictEqual(SHIPPED_NETWORK.privatekey, 239);
});

test('bitcore: testnet address and WIF match the reference', () => {
  const priv = Buffer.from(v.imported.hex, 'hex');
  withShippedNetwork(() => {
    const key = BitcoreUtil.getPrivateKeyFromHex(v.imported.hex);
    assert.strictEqual(BitcoreUtil.getAddress(key), r.address(priv, 'testnet'));
    assert.strictEqual(BitcoreUtil.hex2WIF(v.imported.hex), r.wif(priv, 'testnet'));
  });
});

for (const w of v.wallets) {
  test('bitcore: addresses and WIFs of ' + w.name, () => {
    const hd = BitcoreUtil.getHDPrivateKey(w.mnemonic, w.seedVersion);
    w.accounts.forEach(([address, wif], i) => {
      const key = BitcoreUtil.getPrivateKey(hd, w.basePath, i);
      assert.strictEqual(BitcoreUtil.getAddress(key), address, 'account ' + i);
      assert.strictEqual(BitcoreUtil.hex2WIF(key.toString()), wif, 'account ' + i);
    });
  });
}

test('bitcore: Electrum1 words are case-insensitive', () => {
  const w = v.wallets[2];
  assert.strictEqual(
    mpurseAddress(w.mnemonic.toUpperCase(), 'Electrum1', w.basePath, 0),
    w.accounts[0][0]
  );
});

test('bitcore: WIF import gives the same key and address', () => {
  const key = BitcoreUtil.getPrivateKeyFromWIF(v.imported.wif);
  assert.strictEqual(key.toString(), v.imported.hex);
  assert.strictEqual(BitcoreUtil.getAddress(key), v.imported.address);
  assert.strictEqual(BitcoreUtil.hex2WIF(v.imported.hex), v.imported.wif);
});

test('bitcore: generated BIP39 mnemonics (English, Japanese) derive like the reference', () => {
  for (const lang of ['ENGLISH', 'ENGLISH', 'ENGLISH', 'JAPANESE', 'JAPANESE']) {
    const mn = BitcoreUtil.generateRandomMnemonic('Bip39', lang);
    assert.strictEqual(mn.normalize('NFKD').split(' ').length, 12, lang);
    const seed = r.bip39Seed(mn);
    for (let i = 0; i < 2; i++) {
      assert.strictEqual(
        mpurseAddress(mn, 'Bip39', v.BIP39_PATH, i),
        r.address(r.mpurseKey(seed, v.BIP39_PATH, i)),
        lang + ' ' + JSON.stringify(mn) + ' #' + i
      );
    }
  }
});

test('bitcore: generated Electrum1 mnemonics derive like the reference', () => {
  const words = electrum1Words();
  for (let n = 0; n < 3; n++) {
    const mn = withWindowCrypto(() => BitcoreUtil.generateRandomMnemonic('Electrum1', ''));
    assert.strictEqual(mn.split(' ').length, 12);
    const seed = r.electrum1Seed(mn, words);
    for (let i = 0; i < 2; i++) {
      assert.strictEqual(
        mpurseAddress(mn, 'Electrum1', v.ELECTRUM1_PATH, i),
        r.address(r.mpurseKey(seed, v.ELECTRUM1_PATH, i)),
        JSON.stringify(mn) + ' #' + i
      );
    }
  }
});

test('bitcore: unknown seed versions give no key', () => {
  assert.strictEqual(BitcoreUtil.generateRandomMnemonic('Electrum2', ''), '');
  assert.strictEqual(BitcoreUtil.getHDPrivateKey('x', 'Unknown'), null);
});

test('bitcore: signMessage verifies for the signer only', () => {
  const [w, other] = [v.wallets[0].accounts[0], v.wallets[0].accounts[1]];
  const key = BitcoreUtil.getPrivateKeyFromWIF(w[1]);
  const message = 'Mpurse テスト message';
  const sig = BitcoreUtil.signMessage(message, key.toString());
  assert.strictEqual(Buffer.from(sig, 'base64').length, 65);
  assert.strictEqual(BitcoreUtil.verify(w[0], message, sig), true);
  assert.strictEqual(BitcoreUtil.verify(other[0], message, sig), false);
  assert.strictEqual(BitcoreUtil.verify(w[0], message + '!', sig), false);
});
