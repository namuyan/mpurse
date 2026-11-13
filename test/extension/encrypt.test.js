// Tests for extension_scripts/util.encrypt.ts (needs `npm ci`).
// The vault format must stay readable: existing users' wallets are stored in
// it. A future format change has to keep decrypting these fixtures.
const assert = require('assert');
const { test, load } = require('./harness');
const r = require('./reference');
const v = require('./vectors');

const { EncryptUtil } = load('util.encrypt');

test('encrypt: decrypts a vault written by crypto-js', () => {
  const plain = EncryptUtil.decrypt(v.vault.data, v.vault.password);
  assert.deepStrictEqual(JSON.parse(plain), v.vault.plain);
});

test('encrypt: checksum of the password', () => {
  assert.strictEqual(EncryptUtil.createCheckSum(v.vault.password), v.vault.checksum);
});

test('encrypt: output is the OpenSSL "Salted__" format with a random salt', () => {
  const message = JSON.stringify(v.vault.plain);
  const a = EncryptUtil.encrypt(message, v.vault.password);
  const b = EncryptUtil.encrypt(message, v.vault.password);
  assert.notStrictEqual(a, b);
  assert.strictEqual(Buffer.from(a, 'base64').slice(0, 8).toString(), 'Salted__');
  assert.strictEqual(r.opensslDecrypt(a, v.vault.password), message);
  assert.strictEqual(EncryptUtil.decrypt(b, v.vault.password), message);
});

test('encrypt: a wrong password does not give the vault back', () => {
  let plain = null;
  try {
    plain = EncryptUtil.decrypt(v.vault.data, 'wrong password');
  } catch (e) {
    // crypto-js may throw "Malformed UTF-8 data"
  }
  assert.notStrictEqual(plain, JSON.stringify(v.vault.plain));
});
