// Prints the raw responses of the counterblock methods Mpurse relies on.
//   node tools/check-counterblock.js <MONA address> [endpoint]
// Use it to confirm that an endpoint answers the way util.mpchain.ts expects.
const https = require('https');
const { URL } = require('url');

const address = process.argv[2];
const endpoint = process.argv[3] || 'https://monapa.electrum-mona.org/_api';
if (!address) {
  console.error('usage: node tools/check-counterblock.js <address> [endpoint]');
  process.exit(1);
}

function rpc(method, params) {
  const url = new URL(endpoint);
  const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method, params });
  return new Promise((resolve, reject) => {
    const req = https.request(
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

(async () => {
  const checks = [
    ['get_chain_address_info', { addresses: [address], with_uxtos: false, with_last_txn_hashes: 0 }],
    ['get_normalized_balances', { addresses: [address] }],
    ['get_assets_info', { assetsList: ['XMP'] }],
    ['proxy_to_counterpartyd', { method: 'get_mempool', params: {} }]
  ];
  for (const [method, params] of checks) {
    const r = await rpc(method, params).catch(e => ({ network_error: String(e) }));
    const text = JSON.stringify(r, null, 2);
    console.log('=== ' + method + ' ===\n' + (text.length > 1500 ? text.slice(0, 1500) + '\n... (truncated)' : text) + '\n');
  }
  console.log('Not called here (they change state or need real data): broadcast_tx, create_send, get_script_pub_key');
})();
