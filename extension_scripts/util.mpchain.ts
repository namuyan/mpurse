import { Decimal } from 'decimal.js';

/*
 * Wallet back end: Monaparty counterblock JSON-RPC only.
 *
 * Mpurse used to depend on the mpchain.info REST API, which is slow and cannot
 * be swapped for another server. Everything here is built from counterblock
 * (and counterparty-server through counterblock's proxy) calls, so any
 * Monaparty counterblock endpoint can be used by changing API_URL.
 *
 * The shapes returned by mp()/getAddressInfo()/getBalances()/getAsset() keep
 * the fields the popup and DApps used (mona_balance, quantity, divisible ...).
 * mpchain-only data (USD estimates, market APIs, history) is not available.
 */

interface Params {
  address?: string;
  asset?: string;
  block?: number;
  tx_index?: number;
  tx_hash?: string;
  tx_hex?: string;
  base_asset?: string;
  quote_asset?: string;
  page?: number;
  limit?: number;
}

const SATOSHI = new Decimal(100000000);
const ZERO = '0.00000000';

export class MpchainUtil {
  // counterblock JSON-RPC endpoint (Monaparty testnet)
  static API_URL = 'https://testnet-monapa.electrum-mona.org/_t_api';

  private static httpPost(params: string): Promise<any> {
    return fetch(this.API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: params
    }).then(async response => {
      let json;
      try {
        json = await response.json();
      } catch (e) {
        throw { error: 'api dead' };
      }
      if (json === null || typeof json !== 'object') {
        throw { error: 'api dead' };
      }
      if ('code' in json || 'error' in json) {
        throw json;
      }
      return json;
    });
  }

  // counterblock
  static cb(method: string, params: any): Promise<any> {
    if (!this.isObject(params)) {
      return Promise.reject({ error: 'Invalid argument' });
    }
    const postParams = {
      jsonrpc: '2.0',
      id: 0,
      method: method,
      params: params
    };
    return this.httpPost(JSON.stringify(postParams)).then(
      result => result.result
    );
  }

  // counterparty-server through counterblock
  static cp(method: string, params: any): Promise<any> {
    if (!this.isObject(params)) {
      return Promise.reject({ error: 'Invalid argument' });
    }
    const cbParams = {
      method: method,
      params: params
    };
    return this.cb('proxy_to_counterpartyd', cbParams);
  }

  /**
   * mpchain-compatible entry point for window.mpurse.mpchain().
   * Only the methods that can be answered from counterblock are provided.
   */
  static mp(method: string, params: Params): Promise<any> {
    if (!this.isObject(params)) {
      return Promise.reject({ error: 'Invalid argument' });
    }
    switch (method) {
      case 'address':
        if (!('address' in params)) {
          return Promise.reject({ error: 'Invalid argument' });
        }
        return this.getAddressInfo(params.address);
      case 'asset':
        if (!('asset' in params)) {
          return Promise.reject({ error: 'Invalid argument' });
        }
        return this.getAsset(params.asset);
      case 'balances':
        if (!('address' in params)) {
          return Promise.reject({ error: 'Invalid argument' });
        }
        return this.getBalances(
          params.address,
          'page' in params ? params.page : 1,
          'limit' in params ? params.limit : 10
        );
      case 'balance':
        if (!('address' in params) || !('asset' in params)) {
          return Promise.reject({ error: 'Invalid argument' });
        }
        return this.getBalance(params.address, params.asset);
      case 'mempool':
        if (!('address' in params)) {
          return Promise.reject({ error: 'Invalid argument' });
        }
        return this.getMempool(
          params.address,
          'page' in params ? params.page : 1,
          'limit' in params ? params.limit : 10
        );
      case 'send_tx':
        if ('tx_hex' in params) {
          return this.sendTx(params.tx_hex);
        }
        return Promise.reject({ error: 'Invalid argument' });
      default:
        return Promise.reject({
          error:
            'Method not supported: ' +
            method +
            '. Use counterBlock() or counterParty() instead.'
        });
    }
  }

  static async getAddressInfo(address: string): Promise<any> {
    const [chain, balances] = await Promise.all([
      this.cb('get_chain_address_info', {
        addresses: [address],
        with_uxtos: false,
        with_last_txn_hashes: 0
      }),
      this.getNormalizedBalances(address)
    ]);

    const info = this.chainInfo(chain, address);
    const xmp = balances.find(b => b.asset === 'XMP');
    const held = balances.filter(
      b => b.asset !== 'MONA' && b.asset !== 'XMP' && this.hasBalance(b)
    );
    return {
      address: address,
      assets: {
        held: held.length,
        owned: held.filter(b => b.owner === true).length
      },
      mona_balance: this.monaAmount(info, 'balance'),
      unconfirmed_mona_balance: this.monaAmount(info, 'unconfirmedBalance'),
      xmp_balance: xmp ? this.formatAmount(xmp, true) : ZERO,
      unconfirmed_xmp_balance: ZERO
    };
  }

  static async getAsset(asset: string): Promise<any> {
    if (asset === 'MONA') {
      return {
        asset: 'MONA',
        asset_longname: '',
        description: '',
        divisible: true,
        locked: true,
        issuer: '',
        owner: '',
        supply: ''
      };
    }
    const infos = await this.getAssetsInfo([asset]);
    if (infos.length === 0) {
      throw { error: 'Asset not found: ' + asset };
    }
    return infos[0];
  }

  /** Assets held by the address, excluding MONA and XMP (shown separately). */
  static async getBalances(
    address: string,
    page: number,
    limit: number
  ): Promise<any> {
    const all = (await this.getNormalizedBalances(address))
      .filter(b => b.asset !== 'MONA' && b.asset !== 'XMP' && this.hasBalance(b))
      .sort((a, b) => (a.asset < b.asset ? -1 : a.asset > b.asset ? 1 : 0));

    const start = (Math.max(page, 1) - 1) * limit;
    const slice = all.slice(start, start + limit);
    const infos = slice.length
      ? await this.getAssetsInfo(slice.map(b => b.asset))
      : [];

    return {
      address: address,
      total: all.length,
      data: slice.map(b => {
        const info = infos.find(i => i.asset === b.asset);
        const divisible = info ? info.divisible !== false : true;
        return {
          asset: b.asset,
          asset_longname: info && info.asset_longname ? info.asset_longname : '',
          description: info && info.description ? info.description : '',
          quantity: this.formatAmount(b, divisible),
          unconfirmed_quantity: ZERO
        };
      })
    };
  }

  static async getBalance(address: string, asset: string): Promise<any> {
    if (asset === 'MONA') {
      const summary = await this.getAddressInfo(address);
      return { address: address, asset: asset, quantity: summary.mona_balance };
    }
    const balances = await this.getNormalizedBalances(address);
    const found = balances.find(b => b.asset === asset);
    const info = found ? (await this.getAssetsInfo([asset]))[0] : null;
    return {
      address: address,
      asset: asset,
      quantity: found
        ? this.formatAmount(found, info ? info.divisible !== false : true)
        : ZERO
    };
  }

  /** Unconfirmed transactions that involve the address. */
  static async getMempool(
    address: string,
    page: number,
    limit: number
  ): Promise<any> {
    const mempool: any[] = (await this.cp('get_mempool', {})) || [];
    const mine = mempool.filter(entry => {
      const text = JSON.stringify(entry);
      return text.indexOf('"' + address + '"') !== -1;
    });
    const start = (Math.max(page, 1) - 1) * limit;
    return {
      address: address,
      total: mine.length,
      data: mine.slice(start, start + limit)
    };
  }

  /** Broadcasts a signed transaction. Resolves to { tx_hash }. */
  static async sendTx(txHex: string): Promise<any> {
    // eslint-disable-next-line @typescript-eslint/camelcase
    const result = await this.cb('broadcast_tx', { signed_tx_hex: txHex });
    if (typeof result === 'string') {
      // eslint-disable-next-line @typescript-eslint/camelcase
      return { tx_hash: result };
    }
    if (result && typeof result === 'object' && 'tx_hash' in result) {
      return result;
    }
    if (result && typeof result === 'object' && 'txid' in result) {
      // eslint-disable-next-line @typescript-eslint/camelcase
      return { tx_hash: result.txid };
    }
    throw { error: 'Unexpected broadcast response' };
  }

  static createSend(
    source: string,
    destination: string,
    asset: string,
    quantity: number,
    memo: string,
    memoIsHex: boolean,
    feePerKb: number,
    disableUtxoLocks: boolean
  ): Promise<any> {
    const cpParams = {
      source: source,
      destination: destination,
      asset: asset,
      quantity: quantity,
      memo: memo,
      memo_is_hex: memoIsHex,
      fee_per_kb: feePerKb,
      allow_unconfirmed_inputs: true,
      extended_tx_info: true,
      disable_utxo_locks: disableUtxoLocks
    };
    return this.cp('create_send', cpParams);
  }

  static getScriptPubKey(txHash: string, voutIndex: number): Promise<any> {
    const cbParams = { tx_hash: txHash, vout_index: voutIndex };
    return this.cb('get_script_pub_key', cbParams);
  }

  private static async getNormalizedBalances(address: string): Promise<any[]> {
    const result = await this.cb('get_normalized_balances', {
      addresses: [address]
    });
    return Array.isArray(result) ? result : [];
  }

  private static async getAssetsInfo(assets: string[]): Promise<any[]> {
    const result = await this.cb('get_assets_info', { assetsList: assets });
    return Array.isArray(result) ? result : [];
  }

  private static chainInfo(chain: any, address: string): any {
    if (!Array.isArray(chain)) {
      return {};
    }
    const entry = chain.find(c => c && c.addr === address) || chain[0];
    return entry && entry.info ? entry.info : {};
  }

  /**
   * Reads a MONA amount from the chain info. Prefers the integer satoshi field
   * (`balanceSat`) and falls back to the coin-denominated field (`balance`).
   */
  private static monaAmount(info: any, key: string): string {
    const sat = info[key + 'Sat'];
    if (sat !== undefined && sat !== null && sat !== '') {
      return new Decimal(String(sat)).div(SATOSHI).toFixed(8);
    }
    const coin = info[key];
    if (coin !== undefined && coin !== null && coin !== '') {
      return new Decimal(String(coin)).toFixed(8);
    }
    return ZERO;
  }

  private static hasBalance(b: any): boolean {
    return b && Number(b.quantity) > 0;
  }

  private static formatAmount(b: any, divisible: boolean): string {
    if (divisible) {
      if (b.quantity !== undefined && b.quantity !== null) {
        return new Decimal(String(b.quantity)).div(SATOSHI).toFixed(8);
      }
      return new Decimal(String(b.normalized_quantity)).toFixed(8);
    }
    return b.quantity !== undefined && b.quantity !== null
      ? new Decimal(String(b.quantity)).toFixed(0)
      : new Decimal(String(b.normalized_quantity)).toFixed(0);
  }

  private static isObject(obj: any): boolean {
    return (
      Object.prototype.toString
        .call(obj)
        .slice(8, -1)
        .toLowerCase() === 'object'
    );
  }
}
