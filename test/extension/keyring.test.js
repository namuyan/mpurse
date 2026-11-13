// Tests for extension_scripts/keyring.ts (needs `npm ci`).
const assert = require('assert');
const { test, load } = require('./harness');
const v = require('./vectors');

const { Keyring } = load('keyring');

const w = v.wallets[0];

function restored() {
  const k = new Keyring();
  k.deserialize(w.mnemonic, w.seedVersion, w.basePath, 2, [v.imported.wif]);
  return k;
}

test('keyring: deserialize restores HD and imported accounts', () => {
  const accounts = restored().getAccounts();
  assert.deepStrictEqual(
    accounts.map(a => [a.index, a.address]),
    [
      [0, w.accounts[0][0]],
      [1, w.accounts[1][0]],
      [-1, v.imported.address]
    ]
  );
});

test('keyring: serialize returns what was deserialized', () => {
  assert.deepStrictEqual(restored().serialize(), {
    hdkey: {
      seedVersion: w.seedVersion,
      basePath: w.basePath,
      mnemonic: w.mnemonic,
      numberOfAccounts: 2
    },
    privatekeys: [v.imported.wif]
  });
});

test('keyring: addAccount derives the next index', () => {
  const k = restored();
  const added = k.addAccount();
  assert.strictEqual(added.index, 2);
  assert.strictEqual(added.address, w.accounts[2][0]);
  assert.strictEqual(k.serialize().hdkey.numberOfAccounts, 3);
});

test('keyring: getPrivatekey returns the WIF, empty for unknown', () => {
  const k = restored();
  assert.strictEqual(k.getPrivatekey(w.accounts[1][0]), w.accounts[1][1]);
  assert.strictEqual(k.getPrivatekey(v.imported.address), v.imported.wif);
  assert.strictEqual(k.getPrivatekey('MUnknownAddress'), '');
});

test('keyring: importAccount and duplicates', () => {
  const k = new Keyring();
  k.deserialize(w.mnemonic, w.seedVersion, w.basePath, 1, []);
  assert.strictEqual(k.containsPrivatekey(v.imported.wif), false);
  const a = k.importAccount(v.imported.wif);
  assert.strictEqual(a.index, -1);
  assert.strictEqual(a.address, v.imported.address);
  assert.strictEqual(k.containsPrivatekey(v.imported.wif), true);
  assert.strictEqual(k.containsPrivatekey(w.accounts[0][1]), true);
  assert.deepStrictEqual(k.serialize().privatekeys, [v.imported.wif]);
});

test('keyring: removeAccount drops an imported key from the vault', () => {
  const k = restored();
  k.removeAccount(v.imported.address);
  assert.strictEqual(k.getAccount(v.imported.address), undefined);
  assert.deepStrictEqual(k.serialize().privatekeys, []);
});

test('keyring: Electrum1 wallets restore with their own path', () => {
  const e = v.wallets[2];
  const k = new Keyring();
  k.deserialize(e.mnemonic, e.seedVersion, e.basePath, 3, []);
  assert.deepStrictEqual(
    k.getAccounts().map(a => a.address),
    e.accounts.map(a => a[0])
  );
});

test('keyring: signing with an unknown address fails clearly', async () => {
  const k = restored();
  await assert.rejects(k.signTransaction('00', 'MUnknownAddress'), e => e === 'Account Not Found');
  assert.throws(() => k.signMessage('hello', 'MUnknownAddress'), /Account Not Found/);
  // an empty keyring is what the background has while locked
  await assert.rejects(new Keyring().signTransaction('00', ''), e => e === 'Account Not Found');
});

test('keyring: signMessage signs with the account key', () => {
  const { BitcoreUtil } = load('util.bitcore');
  const sig = restored().signMessage('hello', w.accounts[1][0]);
  assert.strictEqual(BitcoreUtil.verify(w.accounts[1][0], 'hello', sig), true);
});
