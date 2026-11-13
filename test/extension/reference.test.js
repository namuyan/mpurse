// Checks reference.js against published vectors and the fixed test data.
// Needs no installed packages.
const assert = require('assert');
const crypto = require('crypto');
const { test, electrum1Words } = require('./harness');
const r = require('./reference');
const v = require('./vectors');

const hex = b => Buffer.from(b).toString('hex');

test('reference: BIP32 test vector 1 (master, m/0H, m/0H/1)', () => {
  const seed = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
  const m = r.masterKey(seed);
  assert.strictEqual(hex(m.chainCode), '873dff81c02f525623fd1fe5167eac3a55a049de3d314bb42ee227ffed37d508');
  assert.strictEqual(hex(m.key), 'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35');
  const a = r.derive(seed, "m/0'");
  assert.strictEqual(hex(a.chainCode), '47fdacbd0f1097043b78c63c20c34ef4ed9a111d980047ad16282c7ae6236141');
  assert.strictEqual(hex(a.key), 'edb2e14f9ee77d26dd93b4ecede8d16ed408ce149b6cd80b0715a2d911a0afea');
  const b = r.derive(seed, "m/0'/1");
  assert.strictEqual(hex(b.chainCode), '2a7857631386ba23dacac34180dd1983734e444fdbf774041578e9b6adb37c19');
  assert.strictEqual(hex(b.key), '3c6cb8d0f6a264c91ea8b5030fadaa8e538b020f0a387421a12de9319dc93368');
});

test('reference: BIP39 Trezor vector (passphrase TREZOR)', () => {
  const mn = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  assert.strictEqual(
    hex(r.bip39Seed(mn, 'TREZOR')),
    'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04'
  );
});

test('reference: secp256k1 generator and hash160', () => {
  const one = Buffer.alloc(32);
  one[31] = 1;
  const pub = r.publicKey(one);
  assert.strictEqual(hex(pub), '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
  assert.strictEqual(hex(r.hash160(pub)), '751e76e8199196d454941c45d1b3a323f1433bd6');
  // the same key as a Bitcoin address (version 0)
  assert.strictEqual(
    r.base58check(Buffer.concat([Buffer.alloc(1), r.hash160(pub)])),
    '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'
  );
});

test('reference: non-compliant derivation only differs for a leading 0x00 key', () => {
  const seed = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');
  assert.strictEqual(hex(r.derive(seed, "m/0'/1", true).key), hex(r.derive(seed, "m/0'/1").key));
  const w = v.wallets[1];
  const s = r.bip39Seed(w.mnemonic);
  assert.notStrictEqual(
    r.address(r.derive(s, w.basePath + '0').key),
    r.address(r.mpurseKey(s, w.basePath, 0))
  );
});

test('reference: crypto-js passphrase format round trip', () => {
  const salt = Buffer.from('0123456789abcdef', 'hex');
  const ct = r.opensslEncrypt('{"hello":"モナ"}', 'pass word', salt);
  // body checked against `openssl enc -aes-256-cbc -md md5 -S 0123456789abcdef`
  assert.strictEqual(
    hex(Buffer.from(ct, 'base64').slice(16)),
    '2283959d450be2801ce5b0e26796b0b889f25077908be8f9b0796ac0213b2845'
  );
  assert.strictEqual(r.opensslDecrypt(ct, 'pass word'), '{"hello":"モナ"}');
});

test('vectors: wallet addresses and WIFs match the reference', () => {
  const words = electrum1Words();
  for (const w of v.wallets) {
    const seed = w.seedVersion === 'Bip39' ? r.bip39Seed(w.mnemonic) : r.electrum1Seed(w.mnemonic, words);
    w.accounts.forEach(([address, wif], i) => {
      const k = r.mpurseKey(seed, w.basePath, i);
      assert.strictEqual(r.address(k), address, w.name + ' #' + i);
      assert.strictEqual(r.wif(k), wif, w.name + ' #' + i);
    });
  }
});

test('vectors: imported key and vault fixture match the reference', () => {
  const k = Buffer.from(v.imported.hex, 'hex');
  assert.strictEqual(r.address(k), v.imported.address);
  assert.strictEqual(r.wif(k), v.imported.wif);
  assert.deepStrictEqual(JSON.parse(r.opensslDecrypt(v.vault.data, v.vault.password)), v.vault.plain);
  assert.strictEqual(
    crypto.createHash('sha256').update(v.vault.password, 'utf8').digest('base64'),
    v.vault.checksum
  );
});
