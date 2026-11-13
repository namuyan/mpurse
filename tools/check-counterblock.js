// Checks that a counterblock endpoint answers the way util.mpchain.ts expects.
//   node tools/check-counterblock.js <MONA address> [endpoint]
// Prints each raw response and then OK / NG for every assumption Mpurse makes.
// Methods that change state (broadcast_tx, create_send) are not called.
const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_ENDPOINT = 'https://monapa.electrum-mona.org/_api';

function rpc(endpoint, method, params) {
  const url = new URL(endpoint);
  const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method, params });
  const client = url.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve({ unparsable: data.slice(0, 300) }); }
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}

// The calls whose results are checked.
function checks(address) {
  return [
    ['get_chain_address_info', { addresses: [address], with_uxtos: false, with_last_txn_hashes: 0 }],
    ['get_normalized_balances', { addresses: [address] }],
    ['get_assets_info', { assetsList: ['XMP'] }],
    ['proxy_to_counterpartyd', { method: 'get_mempool', params: {} }]
  ];
}

const isNumberLike = v => v !== undefined && v !== null && v !== '' && !isNaN(Number(v));

// What util.mpchain.ts relies on, per method. `response` is the whole JSON-RPC reply.
const assumptions = {
  get_chain_address_info(response, address) {
    const out = [];
    const list = response.result;
    out.push(['returns a list', Array.isArray(list)]);
    const entry = Array.isArray(list) ? list.find(e => e && e.addr === address) || list[0] : undefined;
    out.push(['has an entry with `info`', !!(entry && entry.info && typeof entry.info === 'object')]);
    const info = (entry && entry.info) || {};
    out.push(['`info` has balanceSat or balance (MONA balance)', isNumberLike(info.balanceSat) || isNumberLike(info.balance)]);
    out.push([
      '`info` has unconfirmedBalanceSat or unconfirmedBalance (optional: otherwise 0 is shown)',
      isNumberLike(info.unconfirmedBalanceSat) || isNumberLike(info.unconfirmedBalance),
      true
    ]);
    return out;
  },
  get_normalized_balances(response) {
    const list = response.result;
    const out = [['returns a list', Array.isArray(list)]];
    if (Array.isArray(list) && list.length > 0) {
      out.push(['entries have `asset`', list.every(b => typeof b.asset === 'string')]);
      out.push(['entries have an integer-like `quantity` (satoshi)', list.every(b => isNumberLike(b.quantity))]);
    } else {
      out.push(['(address holds no assets: entry fields not checked)', true, true]);
    }
    return out;
  },
  get_assets_info(response) {
    const list = response.result;
    const out = [['returns a list', Array.isArray(list)]];
    const xmp = Array.isArray(list) ? list.find(a => a && a.asset === 'XMP') : undefined;
    out.push(['contains XMP', !!xmp]);
    out.push(['XMP has boolean `divisible`', !!xmp && typeof xmp.divisible === 'boolean']);
    return out;
  },
  proxy_to_counterpartyd(response) {
    return [['get_mempool returns a list', Array.isArray(response.result)]];
  }
};

// Returns [{ method, items: [{ label, ok, optional }], rpcError }] without printing.
async function evaluate(endpoint, address) {
  const results = [];
  for (const [method, params] of checks(address)) {
    let response;
    try {
      response = await rpc(endpoint, method, params);
    } catch (e) {
      response = { network_error: String(e) };
    }
    const failed = !response || response.error || response.network_error || response.unparsable || !('result' in response);
    const items = failed
      ? [['answers without an error', false]]
      : assumptions[method](response, address);
    results.push({
      method,
      response,
      items: items.map(([label, ok, optional]) => ({ label, ok: !!ok, optional: !!optional }))
    });
  }
  return results;
}

// Required assumptions that failed.
function failures(results) {
  const ng = [];
  results.forEach(r => r.items.forEach(i => { if (!i.ok && !i.optional) ng.push(r.method + ': ' + i.label); }));
  return ng;
}

async function main() {
  const address = process.argv[2];
  const endpoint = process.argv[3] || DEFAULT_ENDPOINT;
  if (!address) {
    console.error('usage: node tools/check-counterblock.js <address> [endpoint]');
    process.exit(2);
  }
  console.log('endpoint: ' + endpoint + '\n');
  const results = await evaluate(endpoint, address);
  for (const r of results) {
    const text = JSON.stringify(r.response, null, 2);
    console.log('=== ' + r.method + ' ===\n' + (text.length > 1500 ? text.slice(0, 1500) + '\n... (truncated)' : text) + '\n');
  }
  console.log('=== Result ===');
  results.forEach(r =>
    r.items.forEach(i => console.log((i.ok ? 'OK  ' : i.optional ? 'WARN' : 'NG  ') + ' ' + r.method + ': ' + i.label))
  );
  const ng = failures(results);
  console.log('\nNot called here (they change state or need real data): broadcast_tx, create_send, get_script_pub_key');
  console.log(ng.length ? '\n' + ng.length + ' required check(s) failed.' : '\nAll required checks passed.');
  process.exit(ng.length ? 1 : 0);
}

module.exports = { rpc, evaluate, failures, assumptions, checks };

if (require.main === module) {
  main();
}
