# Mpurse

Extension for Monaparty.

# Pre-built packages

Available at

* Chrome Web Store
  * https://chrome.google.com/webstore/detail/mpurse/ljkohnccmlcpleonoiabgfggnhpkihaa

* Firefox add-ons
  * https://addons.mozilla.org/firefox/addon/mpchain_mpurse/

# Basic Usage

## Via Browser Action

- Generate Passphrase(Electrum Seed Version 1, e.g. counterwallet)
- Import Passphrase(Electrum Seed Version 1, e.g. counterwallet)
- Import Private Key
- Balance
- Send
- Sign Message
- Sign Transaction

## Via Content Script

Inject an instance of Mpurse into a Window object.

### Properties

#### updateEmitter: EventEmitter

Exposes an EventEmitter that emits two events: `stateChanged` and `addressChanged`.

```javascript
window.mpurse.updateEmitter.removeAllListeners()
  .on('stateChanged', isUnlocked => console.log(isUnlocked))
  .on('addressChanged', address => console.log(address));
```

### Methods

- Permission

  Need Approve (Permission required for each origin)
  
  Need Manual Execution (Operations that require a signature)


#### getAddress()

- Permission
  - Need Approve

- Return value
  - **address**: Promise\<string\>

```javascript
const address = await window.mpurse.getAddress();
```

#### sendAsset()

- Permission
  - Need Approve
  - Need Manual Execution

- Parameters

  - **to**: string
  - **asset**: string
  - **amount**: number
  - **memoType**: string ['no' | 'hex' | 'plain']
  - **memoValue**: string

- Return value
  - **txHash**: Promise\<string\>

```javascript
const txHash = await window.mpurse.sendAsset(
  'MLinW5mA2Rnu7EjDQpnsrh6Z8APMBH6rAt',
  'XMP', 
  114.114, 
  'plain',
  'test'
);
```

#### signRawTransaction()

- Permission
  - Need Approve
  - Need Manual Execution

- Parameters
  - **tx**: string

- Return value
  - **signedTx**: Promise\<string\>

```javascript
const signedTx = await window.mpurse.signRawTransaction(tx);
```
#### signMessage()

- Permission
  - Need Approve
  - Need Manual Execution

- Parameters
  - **personalMessage**: string

- Return value
  - **signature**: Promise\<string\>

```javascript
const signature = await window.mpurse.signMessage('Test Message');
```
#### sendRawTransaction()

- Permission
  - Need Approve
  - Need Manual Execution

- Parameters
  - **tx**: string

- Return value
  - **txHash**: Promise\<string\>

```javascript
const txHash = await window.mpurse.sendRawTransaction(tx);
```

#### mpchain()

Mpchain API.

Valid methods are `address`, `asset`, `balance`, `balances`, `mempool` and `send_tx`.

Mpurse no longer uses the mpchain.info REST API. These methods are answered from the Monaparty counterblock API, and the results contain the same main fields as before (for example `mona_balance`, `quantity`, `divisible`). USD estimates (`estimated_value`) and the market / history / block related methods are not available any more; use `counterBlock()` or `counterParty()` for those.
- Parameters
  - **method**: string
  - **params**: {  
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

- Return value
  - **result**: Promise\<any\>

```javascript
const mpchainParams = {address: 'MLinW5mA2Rnu7EjDQpnsrh6Z8APMBH6rAt'};
const balance = await window.mpurse.mpchain('balances', mpchainParams);
```

#### counterBlock()

Counterblock API. (via https://monapa.electrum-mona.org/_api)

- Parameters
  - **method**: string
  - **params**: any

- Return value
  - **result**: Promise\<any\>

```javascript
const cbParams = {assetsList: ['XMP']};
const assets = await window.mpurse.counterBlock('get_assets_info', cbParams);
```

#### counterParty()

Counterparty API. (via https://monapa.electrum-mona.org/_api)

- Parameters
  - **method**: string
  - **params**: any

- Return value
  - **result**: Promise\<any\>

```javascript
const cpParams = {address: 'MLinW5mA2Rnu7EjDQpnsrh6Z8APMBH6rAt'};
const unspentTxouts = await window.mpurse.counterParty('get_unspent_txouts', cpParams);
```

## Build

```
npm ci
npm run build-all        # Chrome / Edge: dist/mpurse
npm run build-firefox    # Firefox: dist/mpurse-firefox (run build-all first)
```

Firefox 115 or later is required. Firefox runs the background script as an event page (`background.scripts`) instead of a service worker, so `npm run build-firefox` converts the manifest of the Chrome build. To try it, open `about:debugging#/runtime/this-firefox` and use "Load Temporary Add-on" with `dist/mpurse-firefox/manifest.json`. In Firefox the host permission is not granted automatically: allow "Access your data for all websites" for Mpurse in `about:addons` (Permissions tab), otherwise the wallet cannot connect to web pages.

To sign the package for addons.mozilla.org, set `MPURSE_GECKO_ID` to the id of the existing listing before running `npm run build-firefox`.
