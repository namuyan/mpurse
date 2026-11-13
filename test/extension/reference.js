// An independent implementation of the key handling that Mpurse does with
// bitcore, written only with Node's crypto module and BigInt. The tests
// compare Mpurse's code against it, so it must not use bitcore or crypto-js.
//
// Covers: BIP39 seed, BIP32 derivation, secp256k1 public keys, Monacoin
// addresses and WIF, the Electrum 1 word decoding used by Mpurse, and the
// OpenSSL-compatible "Salted__" AES format that crypto-js writes.
const crypto = require('crypto');

// ---- secp256k1 -------------------------------------------------------------
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [
  0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
  0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n
];

const mod = (a, m = P) => ((a % m) + m) % m;
function inv(a, m = P) {
  let [lo, hi, x0, x1] = [mod(a, m), m, 1n, 0n];
  while (lo > 1n) {
    const q = hi / lo;
    [lo, hi] = [hi - q * lo, lo];
    [x0, x1] = [x1 - q * x0, x0];
  }
  return mod(x0, m);
}
function add(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  if (a[0] === b[0]) {
    if (mod(a[1] + b[1]) === 0n) return null;
    const l = mod(3n * a[0] * a[0] * inv(2n * a[1]));
    const x = mod(l * l - 2n * a[0]);
    return [x, mod(l * (a[0] - x) - a[1])];
  }
  const l = mod((b[1] - a[1]) * inv(b[0] - a[0]));
  const x = mod(l * l - a[0] - b[0]);
  return [x, mod(l * (a[0] - x) - a[1])];
}
function mul(k, pt = G) {
  let r = null;
  let q = pt;
  while (k > 0n) {
    if (k & 1n) r = add(r, q);
    q = add(q, q);
    k >>= 1n;
  }
  return r;
}

const big = buf => BigInt('0x' + (Buffer.from(buf).toString('hex') || '0'));
const buf32 = n => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');

function publicKey(priv) {
  const [x, y] = mul(big(priv));
  return Buffer.concat([Buffer.from([y & 1n ? 3 : 2]), buf32(x)]);
}

// ---- hashes and base58 -----------------------------------------------------
const sha256 = b => crypto.createHash('sha256').update(b).digest();
const hash160 = b =>
  crypto.createHash('ripemd160').update(sha256(b)).digest();

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58check(payload) {
  const data = Buffer.concat([payload, sha256(sha256(payload)).slice(0, 4)]);
  let n = big(data);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of data) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}

// ---- BIP32 / BIP39 -----------------------------------------------------------
function masterKey(seed) {
  const i = crypto.createHmac('sha512', 'Bitcoin seed').update(seed).digest();
  return { key: i.slice(0, 32), chainCode: i.slice(32) };
}

// nonCompliant reproduces bitcore's HDPrivateKey#derive(), which is
// deriveNonCompliantChild(): for hardened children it serializes the parent
// private key without zero padding, so the result differs from BIP32 when
// the parent key starts with a 0x00 byte (about 1 in 256 keys). Mpurse has
// always used derive(), so existing wallets depend on this behavior.
function childKey(parent, index, hardened, nonCompliant) {
  const n = hardened ? index + 0x80000000 : index;
  const idx = Buffer.alloc(4);
  idx.writeUInt32BE(n);
  let priv = parent.key;
  if (nonCompliant) {
    let i = 0;
    while (i < priv.length - 1 && priv[i] === 0) i++;
    priv = priv.slice(i);
  }
  const data = hardened
    ? Buffer.concat([Buffer.alloc(1), priv, idx])
    : Buffer.concat([publicKey(parent.key), idx]);
  const i = crypto.createHmac('sha512', parent.chainCode).update(data).digest();
  const key = mod(big(i.slice(0, 32)) + big(parent.key), N);
  return { key: buf32(key), chainCode: i.slice(32) };
}

// path like "m/44'/22'/0'/0/3"
function derive(seed, path, nonCompliant = false) {
  const parts = path.split('/');
  if (parts.shift() !== 'm') throw new Error('bad path ' + path);
  let k = masterKey(seed);
  for (const part of parts) {
    const hardened = part.endsWith("'");
    k = childKey(k, parseInt(part, 10), hardened, nonCompliant);
  }
  return k;
}

function bip39Seed(mnemonic, passphrase = '') {
  return crypto.pbkdf2Sync(
    Buffer.from(mnemonic.normalize('NFKD'), 'utf8'),
    Buffer.from(('mnemonic' + passphrase).normalize('NFKD'), 'utf8'),
    2048,
    64,
    'sha512'
  );
}

// ---- Electrum 1 words, as decoded by external/mnemonic.js ------------------
// Mpurse feeds the decoded 128-bit number to BIP32 as the seed. This is not
// how Electrum 1 itself derives keys, but it is what existing wallets use.
function electrum1Seed(words, wordList) {
  const n = wordList.length;
  const list = words.toLowerCase().split(' ');
  let hex = '';
  for (let i = 0; i < list.length / 3; i++) {
    const w1 = wordList.indexOf(list[3 * i]);
    const w2 = wordList.indexOf(list[3 * i + 1]);
    const w3 = wordList.indexOf(list[3 * i + 2]);
    const m = (a, b) => ((a % b) + b) % b;
    const x = w1 + n * m(w2 - w1, n) + n * n * m(w3 - w2, n);
    hex += (x >>> 0).toString(16).padStart(8, '0');
  }
  return Buffer.from(hex, 'hex');
}

// ---- Monacoin ----------------------------------------------------------------
const NETWORKS = {
  mainnet: { pubkeyhash: 50, privatekey: 176 },
  testnet: { pubkeyhash: 111, privatekey: 239 }
};

function address(priv, network = 'mainnet') {
  const v = Buffer.from([NETWORKS[network].pubkeyhash]);
  return base58check(Buffer.concat([v, hash160(publicKey(priv))]));
}

function wif(priv, network = 'mainnet') {
  const v = Buffer.from([NETWORKS[network].privatekey]);
  return base58check(Buffer.concat([v, priv, Buffer.from([1])]));
}

// ---- crypto-js passphrase AES (OpenSSL EVP_BytesToKey with MD5) -------------
function evpBytesToKey(password, salt) {
  let out = Buffer.alloc(0);
  let prev = Buffer.alloc(0);
  while (out.length < 48) {
    prev = crypto
      .createHash('md5')
      .update(Buffer.concat([prev, Buffer.from(password, 'utf8'), salt]))
      .digest();
    out = Buffer.concat([out, prev]);
  }
  return { key: out.slice(0, 32), iv: out.slice(32, 48) };
}

function opensslEncrypt(plain, password, salt) {
  const { key, iv } = evpBytesToKey(password, salt);
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([Buffer.from('Salted__'), salt, ct]).toString('base64');
}

function opensslDecrypt(b64, password) {
  const raw = Buffer.from(b64, 'base64');
  if (raw.slice(0, 8).toString() !== 'Salted__') throw new Error('no salt');
  const { key, iv } = evpBytesToKey(password, raw.slice(8, 16));
  const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([d.update(raw.slice(16)), d.final()]).toString('utf8');
}

// The private key Mpurse derives for a BIP39 / Electrum 1 wallet account.
function mpurseKey(seed, basePath, index) {
  return derive(seed, basePath + index, true).key;
}

module.exports = {
  mpurseKey,
  publicKey,
  hash160,
  base58check,
  masterKey,
  derive,
  bip39Seed,
  electrum1Seed,
  address,
  wif,
  evpBytesToKey,
  opensslEncrypt,
  opensslDecrypt
};
