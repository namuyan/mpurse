// Tests for tools/check-counterblock.js against a local fake counterblock.
//   npm run test:tools
const assert = require('assert');
const http = require('http');
const { evaluate, failures } = require('./check-counterblock');

const ADDRESS = 'MTestAddress';

const goodReplies = {
  get_chain_address_info: [{ addr: ADDRESS, info: { balanceSat: 123456789, unconfirmedBalanceSat: 0 } }],
  get_normalized_balances: [{ address: ADDRESS, asset: 'XMP', quantity: 250000000, normalized_quantity: 2.5 }],
  get_assets_info: [{ asset: 'XMP', divisible: true, description: '' }],
  proxy_to_counterpartyd: []
};

// replies: method -> result (or { error } to send a JSON-RPC error)
function startServer(replies) {
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      const call = JSON.parse(data);
      const r = replies[call.method];
      res.setHeader('Content-Type', 'application/json');
      if (r && r.__error) {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, error: { code: -32601, message: 'Method not found' } }));
      } else if (r === '__garbage__') {
        res.end('<html>not json</html>');
      } else {
        res.end(JSON.stringify({ jsonrpc: '2.0', id: call.id, result: r }));
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function withServer(replies, fn) {
  const server = await startServer(replies);
  try {
    return await fn('http://127.0.0.1:' + server.address().port + '/_api');
  } finally {
    server.close();
  }
}

const tests = [
  ['passes when the endpoint answers as expected', async () => {
    await withServer(goodReplies, async url => {
      const results = await evaluate(url, ADDRESS);
      assert.deepStrictEqual(failures(results), []);
      assert.strictEqual(results.length, 4);
    });
  }],
  ['accepts coin-denominated balance fields', async () => {
    const replies = Object.assign({}, goodReplies, {
      get_chain_address_info: [{ addr: ADDRESS, info: { balance: 1.23456789, unconfirmedBalance: 0 } }]
    });
    await withServer(replies, async url => {
      assert.deepStrictEqual(failures(await evaluate(url, ADDRESS)), []);
    });
  }],
  ['treats missing unconfirmed fields as a warning only', async () => {
    const replies = Object.assign({}, goodReplies, {
      get_chain_address_info: [{ addr: ADDRESS, info: { balanceSat: 5 } }]
    });
    await withServer(replies, async url => {
      const results = await evaluate(url, ADDRESS);
      assert.deepStrictEqual(failures(results), []);
      const warn = results[0].items.find(i => i.optional);
      assert.strictEqual(warn.ok, false);
    });
  }],
  ['accepts an address that holds no assets', async () => {
    const replies = Object.assign({}, goodReplies, { get_normalized_balances: [] });
    await withServer(replies, async url => {
      assert.deepStrictEqual(failures(await evaluate(url, ADDRESS)), []);
    });
  }],
  ['fails when the MONA balance field is missing', async () => {
    const replies = Object.assign({}, goodReplies, {
      get_chain_address_info: [{ addr: ADDRESS, info: { somethingElse: 1 } }]
    });
    await withServer(replies, async url => {
      const ng = failures(await evaluate(url, ADDRESS));
      assert.ok(ng.some(m => /get_chain_address_info.*balanceSat or balance/.test(m)), ng.join('\n'));
    });
  }],
  ['fails when balances have no quantity', async () => {
    const replies = Object.assign({}, goodReplies, {
      get_normalized_balances: [{ asset: 'XMP', normalized_quantity: 2.5 }]
    });
    await withServer(replies, async url => {
      const ng = failures(await evaluate(url, ADDRESS));
      assert.ok(ng.some(m => /quantity/.test(m)), ng.join('\n'));
    });
  }],
  ['fails when a method is not provided (JSON-RPC error)', async () => {
    const replies = Object.assign({}, goodReplies, { get_assets_info: { __error: true } });
    await withServer(replies, async url => {
      const ng = failures(await evaluate(url, ADDRESS));
      assert.ok(ng.some(m => /get_assets_info: answers without an error/.test(m)), ng.join('\n'));
    });
  }],
  ['fails when the endpoint does not return JSON', async () => {
    const replies = Object.assign({}, goodReplies, { get_normalized_balances: '__garbage__' });
    await withServer(replies, async url => {
      const ng = failures(await evaluate(url, ADDRESS));
      assert.ok(ng.some(m => /get_normalized_balances/.test(m)), ng.join('\n'));
    });
  }],
  ['fails when the endpoint cannot be reached', async () => {
    const ng = failures(await evaluate('http://127.0.0.1:1/_api', ADDRESS));
    assert.strictEqual(ng.length, 4);
  }]
];

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log('PASS ' + name);
    } catch (e) {
      failed++;
      console.log('FAIL ' + name + '\n     ' + e.message);
    }
  }
  console.log(failed ? '\n' + failed + ' failed' : '\nall ' + tests.length + ' passed');
  process.exit(failed ? 1 : 0);
})();
