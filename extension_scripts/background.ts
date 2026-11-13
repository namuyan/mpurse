import { ContentScriptMessage } from './enum/contentScriptMessage';

import { BitcoreUtil } from './util.bitcore';
import { EncryptUtil } from './util.encrypt';
import { MpchainUtil } from './util.mpchain';
import { Hdkey, Keyring } from './keyring';
import { ExtensionMessage } from './enum/extensionMessage';
import { isExtensionPage } from './util.sender';

interface VaultData {
  hdkey: {
    seedVersion: string;
    basePath: string;
    mnemonic: string;
    numberOfAccounts: number;
  };
  privatekeys: string[];
}

interface StoredData {
  version: number;
  preferences: Preferences;
  vault: {
    data: string;
    checksum: string;
  };
}

interface Preferences {
  identities: {
    address: string;
    name: string;
    isImport: boolean;
  }[];
  selectedAddress: string;
  isAdvancedModeEnabled: boolean;
  lang: string;
}

interface Request {
  target: string;
  port: chrome.runtime.Port;
  type: ContentScriptMessage;
  id: number;
  origin: string;
  data: any;
}

enum Platform {
  PLATFORM_CHROME,
  PLATFORM_FIREFOX,
  PLATFORM_EDGE,
  PLATFORM_OPERA,
  PLATFORM_FIREFOX_ANDROID
}

class Background {
  private version = 4;
  private isUnlocked = false;
  private password: string;
  private preferences: Preferences;
  private keyring: Keyring;

  private requests: Request[] = [];

  private connectedPorts: {
    port: chrome.runtime.Port;
    origin: string;
  }[] = [];
  private approvedOrigins: string[] = [];

  // The browser stops the service worker after about 30 seconds without events,
  // which wipes everything held in memory. While the wallet is unlocked the state
  // is kept in chrome.storage.session (memory only, cleared when the browser
  // closes, not readable from content scripts) and restored on startup. `ready`
  // resolves when that is done; every message handler waits for it.
  private static readonly AUTO_LOCK_MS = 10 * 60 * 1000;
  private static readonly AUTO_LOCK_ALARM = 'mpurse.autolock';
  private lockAt = 0;
  private ready: Promise<void>;

  constructor() {
    this.resetPreferences();
    this.resetKeyring();

    this.ready = this.restoreSession();
    this.assignEventHandlers();
  }

  private async handleRequest<T>(
    sendResponse: (response: {
      success: boolean;
      body?: T;
      error?: string;
    }) => void,
    handler: () => Promise<T> | T
  ): Promise<void> {
    try {
      const result = await Promise.resolve(handler());
      sendResponse({ success: true, body: result });
    } catch (e) {
      sendResponse({
        success: false,
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }

  assignEventHandlers(): void {
    chrome.runtime.onConnect.addListener((port: chrome.runtime.Port) => {
      if (port.name === ContentScriptMessage.PortName) {
        const onPortMessage = (
          message: any,
          connectedPort: chrome.runtime.Port
        ): void => {
            switch (message.type) {
              case ContentScriptMessage.InPageInit:
                connectedPort.onDisconnect.addListener(
                  (initPort: chrome.runtime.Port) => {
                    this.connectedPorts = this.connectedPorts.filter(
                      cp => cp.port !== initPort
                    );
                    this.requests = this.requests.filter(
                      r => r.port !== initPort
                    );

                    this.setBadgeText(false);
                  }
                );
                this.connectedPorts.push({
                  port: connectedPort,
                  origin: message.origin
                });

                this.executeRequest(connectedPort, message);
                if (message.data && message.data.reconnect) {
                  // the content script reconnected after the service worker stopped
                  this.sendStateToPort(connectedPort, message.origin);
                }
                break;

              case ContentScriptMessage.Address:
                if (this.isApprovedOrigin(message.origin)) {
                  this.executeRequest(connectedPort, message);
                } else {
                  this.setRequest('', connectedPort, message);
                }
                break;

              case ContentScriptMessage.SendAsset:
                this.setRequest('send', connectedPort, message);
                break;

              case ContentScriptMessage.SignRawTransaction:
                this.setRequest('transaction', connectedPort, message);
                break;

              case ContentScriptMessage.SignMessage:
                this.setRequest('signature', connectedPort, message);
                break;

              case ContentScriptMessage.SendRawTransaction:
                this.setRequest('transaction', connectedPort, message);
                break;

              case ContentScriptMessage.Mpchain:
                this.executeRequest(connectedPort, message);
                break;

              case ContentScriptMessage.CounterBlock:
                this.executeRequest(connectedPort, message);
                break;

              case ContentScriptMessage.CounterParty:
                this.executeRequest(connectedPort, message);
                break;
            }
        };

        port.onMessage.addListener(
          (message: any, connectedPort: chrome.runtime.Port) => {
            this.ready.then(() => {
              this.checkAutoLock();
              onPortMessage(message, connectedPort);
            });
          }
        );
      }
    });

    const onExtensionMessage = (
      message: any,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ): void => {
      switch (message.type) {
        case ExtensionMessage.IsUnlocked:
          this.handleRequest<boolean>(sendResponse, () => {
            return this.getIsUnlocked();
          });
          break;

        case ExtensionMessage.Unlock:
          this.handleRequest<void>(sendResponse, () => {
            return this.unlock(message.password);
          });
          break;

        case ExtensionMessage.Lock:
          this.handleRequest<void>(sendResponse, () => {
            return this.lock();
          });
          break;

        case ExtensionMessage.GetSelectedAddress:
          this.handleRequest<string>(sendResponse, () => {
            return this.getSelectedAddress();
          });
          break;

        case ExtensionMessage.SetAccountName:
          this.handleRequest<void>(sendResponse, () => {
            return this.setAccountName(message.address, message.name);
          });
          break;

        case ExtensionMessage.GetIdentities:
          this.handleRequest<
            {
              address: string;
              name: string;
              isImport: boolean;
            }[]
          >(sendResponse, () => {
            return this.getIdentities();
          });
          break;

        case ExtensionMessage.ChangeAddress:
          this.handleRequest<void>(sendResponse, () => {
            return this.setSelectedAddress(message.address);
          });
          break;

        case ExtensionMessage.SaveNewPassphrase:
          this.handleRequest<void>(sendResponse, () => {
            return this.saveNewPassphrase(
              message.passphrase,
              message.seedVersion,
              message.basePath,
              message.baseName
            );
          });
          break;

        case ExtensionMessage.GetPassphrase:
          this.handleRequest<string>(sendResponse, () => {
            return this.getPassphrase(message.password);
          });
          break;

        case ExtensionMessage.GetHdkey:
          this.handleRequest<Hdkey>(sendResponse, () => {
            return this.getHdkey(message.password);
          });
          break;

        case ExtensionMessage.CreateAccount:
          this.handleRequest<void>(sendResponse, () => {
            return this.createAccount(message.name);
          });
          break;

        case ExtensionMessage.ImportAccount:
          this.handleRequest<void>(sendResponse, () => {
            return this.importAccount(message.privatekey, message.name);
          });
          break;

        case ExtensionMessage.GetPrivatekey:
          this.handleRequest<string>(sendResponse, () => {
            return this.getPrivatekey(message.password, message.address);
          });
          break;

        case ExtensionMessage.GetPendingRequest:
          this.handleRequest<any | null>(sendResponse, () => {
            return this.getPendingRequest(message.id);
          });
          break;

        case ExtensionMessage.ShiftRequest:
          this.handleRequest<void>(sendResponse, () => {
            return this.shiftRequest(
              message.isSuccessful,
              message.id,
              message.result
            );
          });
          break;

        case ExtensionMessage.SignRawTransaction:
          this.handleRequest<string>(sendResponse, () => {
            return this.signRawTransaction(message.tx);
          });
          break;

        case ExtensionMessage.SignMessage:
          this.handleRequest<string>(sendResponse, () => {
            return this.signMessage(message.message);
          });
          break;

        case ExtensionMessage.SendRawTransaction:
          this.handleRequest<any>(sendResponse, () => {
            return this.sendRawTransaction(message.tx);
          });
          break;

        case ExtensionMessage.ApproveOrigin:
          this.handleRequest<boolean>(sendResponse, () => {
            return this.approveOrigin(message.origin, message.id);
          });
          break;

        case ExtensionMessage.RemoveAccount:
          this.handleRequest<void>(sendResponse, () => {
            return this.removeAccount(message.address);
          });
          break;

        case ExtensionMessage.IncrementAccountName:
          this.handleRequest<string>(sendResponse, () => {
            return this.incrementAccountName(message.name, message.num);
          });
          break;

        case ExtensionMessage.IsAdvancedModeEnabled:
          this.handleRequest<boolean>(sendResponse, () => {
            return this.isAdvancedModeEnabled();
          });
          break;

        case ExtensionMessage.SetAdvancedMode:
          this.handleRequest<void>(sendResponse, () => {
            return this.setAdvancedMode(message.isEnabled);
          });
          break;

        case ExtensionMessage.GetLang:
          this.handleRequest<string>(sendResponse, () => {
            return this.getLang();
          });
          break;

        case ExtensionMessage.SetLang:
          this.handleRequest<void>(sendResponse, () => {
            return this.setLang(message.lang);
          });
          break;

        case ExtensionMessage.PurgeAll:
          this.handleRequest<void>(sendResponse, () => {
            return this.purgeAll();
          });
          break;

        case ExtensionMessage.ExistsVault:
          this.handleRequest<boolean>(sendResponse, () => {
            return this.existsVault();
          });
          break;

        case ExtensionMessage.GetAddressInfo:
          this.handleRequest<any>(sendResponse, () => {
            return this.getAddressInfo(message.address);
          });
          break;

        case ExtensionMessage.GetAsset:
          this.handleRequest<any>(sendResponse, () => {
            return this.getAsset(message.asset);
          });
          break;

        case ExtensionMessage.GetAccountSummary:
          this.handleRequest<any>(sendResponse, async () => {
            const identity = this.getIdentity(message.address);
            const addressInfo = await this.getAddressInfo(message.address);

            if (identity) {
              addressInfo['name'] = identity.name;
              addressInfo['isImport'] = identity.isImport;
            }

            return addressInfo;
          });
          break;

        case ExtensionMessage.GetBalances:
          this.handleRequest<any>(sendResponse, () => {
            return this.getBalances(
              message.address,
              message.page,
              message.limit
            );
          });
          break;

        case ExtensionMessage.CreateSend:
          this.handleRequest<any>(sendResponse, () => {
            return this.createSend(
              message.source,
              message.destination,
              message.asset,
              message.quantity,
              message.memo,
              message.memoIsHex,
              message.feePerKb,
              message.disableUtxoLocks
            ).catch(e => {
              throw JSON.stringify(e);
            });
          });
          break;

        case ExtensionMessage.Send:
          this.handleRequest<any>(sendResponse, () => {
            return this.send(message.tx);
          });
          break;

        case ExtensionMessage.GenerateRandomMnemonic:
          this.handleRequest<string>(sendResponse, () => {
            return BitcoreUtil.generateRandomMnemonic(
              message.seedVersion,
              message.seedLanguage
            );
          });
          break;

        case ExtensionMessage.DecodeBase58:
          this.handleRequest<Uint8Array>(sendResponse, () => {
            return this.decodeBase58(message.str);
          });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    };

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (
        !isExtensionPage(sender, chrome.runtime.id, chrome.runtime.getURL(''))
      ) {
        // only the popup and request windows may use these handlers
        sendResponse({ success: false, error: 'Not allowed' });
        return false;
      }
      this.ready.then(() => {
        // Messages from the extension's own pages are user activity.
        this.checkAutoLock();
        this.touch();
        onExtensionMessage(message, sender, sendResponse);
      });
      return true;
    });

    const alarms = this.getAlarms();
    if (alarms) {
      alarms.onAlarm.addListener((alarm: { name: string }) => {
        if (alarm.name === Background.AUTO_LOCK_ALARM) {
          this.ready.then(() => this.checkAutoLock());
        }
      });
    }
  }

  setBadgeText(shouldDelete: boolean): void {
    if (this.getPlatform() !== Platform.PLATFORM_FIREFOX_ANDROID) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      chrome.action.setBadgeText({
        text:
          shouldDelete || this.requests.length === 0
            ? ''
            : this.requests.length.toString()
      });
    }
  }

  private getPlatform(): Platform {
    const ua = navigator.userAgent;
    if (ua.search('Firefox') !== -1) {
      if (ua.search('Android') !== -1) {
        return Platform.PLATFORM_FIREFOX_ANDROID;
      } else {
        return Platform.PLATFORM_FIREFOX;
      }
    } else {
      if (ua.search('Edge') !== -1) {
        return Platform.PLATFORM_EDGE;
      } else if (ua.search('OPR') !== -1) {
        return Platform.PLATFORM_OPERA;
      } else {
        return Platform.PLATFORM_CHROME;
      }
    }
  }

  async send(tx: string): Promise<any> {
    if (!this.isUnlocked) {
      this.resetPreferences();
      this.resetKeyring();
      return Promise.reject('Not logged in');
    } else {
      const hex = await this.keyring.signTransaction(
        tx,
        this.preferences.selectedAddress
      );
      return MpchainUtil.sendTx(hex);
    }
  }

  signRawTransaction(tx: string): Promise<string> {
    if (!this.isUnlocked) {
      return Promise.reject('Not logged in');
    }
    return this.keyring.signTransaction(tx, this.preferences.selectedAddress);
  }

  signMessage(message: string): string {
    const account = this.isUnlocked
      ? this.keyring.getAccount(this.preferences.selectedAddress)
      : undefined;
    if (!account) {
      throw new Error('Not logged in');
    }
    return BitcoreUtil.signMessage(message, account.privatekey);
  }

  async sendRawTransaction(tx: string): Promise<any> {
    if (!this.isUnlocked) {
      return Promise.reject('Not logged in');
    }
    const hex = await this.keyring.signTransaction(
      tx,
      this.preferences.selectedAddress
    );
    return MpchainUtil.sendTx(hex);
  }

  private popup(): void {
    if (this.getPlatform() === Platform.PLATFORM_FIREFOX_ANDROID) {
      chrome.tabs.create({ url: 'index.html' });
    } else {
      chrome.windows.create({
        url: 'index.html',
        type: 'popup',
        width: 375,
        height: 636
      });
    }
  }

  private setRequest(
    target: string,
    port: chrome.runtime.Port,
    message: any
  ): void {
    this.requests.unshift({
      target: target,
      port: port,
      type: message.type,
      id: message.id,
      origin: message.origin,
      data: message.data
    });

    this.setBadgeText(false);
    this.popup();
  }

  private executeRequest(
    connectedPort: chrome.runtime.Port,
    message: any
  ): void {
    let response = {};
    switch (message.type) {
      case ContentScriptMessage.InPageInit:
        response = { isUnlocked: this.isUnlocked };
        connectedPort.postMessage({
          type: message.type,
          id: message.id,
          data: response
        });
        break;
      case ContentScriptMessage.Address:
        response = { address: this.preferences.selectedAddress };
        connectedPort.postMessage({
          type: message.type,
          id: message.id,
          data: response
        });
        break;
      case ContentScriptMessage.Mpchain:
        MpchainUtil.mp(message.data.method, message.data.params)
          .then(result => {
            connectedPort.postMessage({
              type: message.type,
              id: message.id,
              data: result
            });
          })
          .catch(error => {
            connectedPort.postMessage({
              type: message.type,
              id: message.id,
              data: error
            });
          });
        break;
      case ContentScriptMessage.CounterBlock:
        MpchainUtil.cb(message.data.method, message.data.params)
          .then(result => {
            connectedPort.postMessage({
              type: message.type,
              id: message.id,
              data: result
            });
          })
          .catch(error => {
            connectedPort.postMessage({
              type: message.type,
              id: message.id,
              data: error
            });
          });
        break;
      case ContentScriptMessage.CounterParty:
        MpchainUtil.cp(message.data.method, message.data.params)
          .then(result => {
            connectedPort.postMessage({
              type: message.type,
              id: message.id,
              data: result
            });
          })
          .catch(error => {
            connectedPort.postMessage({
              type: message.type,
              id: message.id,
              data: error
            });
          });
        break;
    }
  }

  executePendingRequests(): void {
    const rb = this.requests.concat();
    for (let i = 0; i < rb.length; i++) {
      if (rb[i].target === '' && this.isApprovedOrigin(rb[i].origin)) {
        this.executeRequest(rb[i].port, rb[i]);
        this.requests = this.requests.filter(
          r => r.id.toString() !== rb[i].id.toString()
        );

        this.setBadgeText(false);
      }
    }
  }

  getPendingRequest(id?: number): any | null {
    if (
      this.requests.length === 0 ||
      (id !== undefined &&
        !this.requests.some(r => r.id.toString() === id.toString()))
    ) {
      return null;
    } else {
      const targetRequest =
        id !== undefined
          ? this.requests.find(r => r.id.toString() === id.toString())
          : this.requests[0];
      if (this.isApprovedOrigin(targetRequest.origin)) {
        return targetRequest;
      } else {
        return {
          target: 'approve',
          port: null,
          type: null,
          id: targetRequest.id,
          origin: targetRequest.origin,
          data: null
        };
      }
    }
  }

  shiftRequest(isSuccessful: boolean, id: number, result: any): Promise<void> {
    return new Promise<void>((resolve, reject): void => {
      if (
        this.requests.length !== 0 &&
        this.requests.some(r => r.id.toString() === id.toString())
      ) {
        this.sendResponse(isSuccessful, id, result);
        resolve();
      } else {
        if (isSuccessful) {
          reject('Request Not Found');
        } else {
          resolve();
        }
      }
    });
  }

  sendResponse(
    isSuccessful: boolean,
    id: number,
    result: Record<string, any>
  ): void {
    let data: Record<string, any> = null;
    if (isSuccessful || 'error' in result) {
      data = result;
    } else {
      data = { error: 'Unknown Error' };
    }

    const targetIndex = this.requests.findIndex(
      r => r.id.toString() === id.toString()
    );
    if (targetIndex !== -1) {
      this.requests[targetIndex].port.postMessage({
        type: this.requests[targetIndex].type,
        id: id,
        data: data
      });

      this.requests = this.requests.filter(
        r => r.id.toString() !== id.toString()
      );

      this.setBadgeText(false);
    }
  }

  approveOrigin(origin: string, id: number): boolean {
    if (!this.isApprovedOrigin(origin)) {
      this.approvedOrigins.push(origin);
      this.persistSession();
      this.executePendingRequests();
    }
    const targetIndex = this.requests.findIndex(
      r => r.id.toString() === id.toString()
    );
    return targetIndex !== -1;
  }

  isApprovedOrigin(origin: string): boolean {
    return this.approvedOrigins.some(approved => approved === origin);
  }

  private broadcastUpdate(type: ContentScriptMessage, data: any): void {
    for (let i = 0; i < this.connectedPorts.length; i++) {
      if (
        type === ContentScriptMessage.LoginState ||
        this.isApprovedOrigin(this.connectedPorts[i].origin)
      ) {
        this.connectedPorts[i].port.postMessage({
          type: type,
          id: 0,
          data: data
        });
      }
    }
  }

  private getSessionStorage(): any {
    // chrome.storage.session is missing from the bundled type definitions.
    const storage: any = chrome.storage;
    return storage && storage.session ? storage.session : null;
  }

  private getAlarms(): any {
    // Optional: without the "alarms" permission the lock is still enforced on
    // the next access, it is just not applied in the background.
    const c: any = chrome;
    return c.alarms ? c.alarms : null;
  }

  private persistSession(): void {
    const storage = this.getSessionStorage();
    if (!storage) {
      return;
    }
    if (this.isUnlocked && this.password !== '') {
      storage.set({
        session: {
          password: this.password,
          approvedOrigins: this.approvedOrigins,
          lockAt: this.lockAt
        }
      });
    } else {
      storage.remove('session');
    }
  }

  private restoreSession(): Promise<void> {
    const storage = this.getSessionStorage();
    if (!storage) {
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      storage.get('session', (items: any) => {
        const s = items && items.session;
        if (!s) {
          resolve();
          return;
        }
        if (
          typeof s.password !== 'string' ||
          s.password === '' ||
          typeof s.lockAt !== 'number' ||
          Date.now() >= s.lockAt
        ) {
          storage.remove('session');
          resolve();
          return;
        }
        this.approvedOrigins = Array.isArray(s.approvedOrigins)
          ? s.approvedOrigins
          : [];
        this.unlock(s.password)
          .then(() => {
            // keep the original deadline: a restart is not user activity
            this.lockAt = s.lockAt;
            this.persistSession();
            this.scheduleAutoLock();
            resolve();
          })
          .catch(() => {
            this.approvedOrigins = [];
            this.persistSession();
            resolve();
          });
      });
    });
  }

  // Extends the auto-lock deadline. Called for user activity only.
  private touch(): void {
    if (!this.isUnlocked) {
      return;
    }
    this.lockAt = Date.now() + Background.AUTO_LOCK_MS;
    this.persistSession();
    this.scheduleAutoLock();
  }

  private checkAutoLock(): void {
    if (this.isUnlocked && Date.now() >= this.lockAt) {
      this.lock();
    }
  }

  private scheduleAutoLock(): void {
    const alarms = this.getAlarms();
    if (alarms && this.isUnlocked) {
      alarms.create(Background.AUTO_LOCK_ALARM, { when: this.lockAt });
    }
  }

  private clearAutoLockAlarm(): void {
    const alarms = this.getAlarms();
    if (alarms) {
      alarms.clear(Background.AUTO_LOCK_ALARM);
    }
  }

  private sendStateToPort(port: chrome.runtime.Port, origin: string): void {
    port.postMessage({
      type: ContentScriptMessage.LoginState,
      id: 0,
      data: { isUnlocked: this.isUnlocked }
    });
    if (this.isApprovedOrigin(origin)) {
      port.postMessage({
        type: ContentScriptMessage.AddressState,
        id: 0,
        data: { address: this.preferences.selectedAddress }
      });
    }
  }

  private resetPassword(): void {
    this.isUnlocked = false;
    this.password = '';
    this.lockAt = 0;
    this.persistSession();
    this.clearAutoLockAlarm();
    this.broadcastUpdate(ContentScriptMessage.LoginState, {
      isUnlocked: this.isUnlocked
    });
  }

  private resetKeyring(): void {
    this.keyring = new Keyring();
  }

  private resetPreferences(): void {
    const isAdvanced =
      this.preferences && this.preferences.isAdvancedModeEnabled
        ? this.preferences.isAdvancedModeEnabled
        : false;
    const lang =
      this.preferences && this.preferences.lang ? this.preferences.lang : null;
    this.preferences = {
      identities: [],
      selectedAddress: '',
      isAdvancedModeEnabled: isAdvanced,
      lang: lang
    };
    this.broadcastUpdate(ContentScriptMessage.AddressState, { address: '' });
  }

  private resetRequest(): void {
    const r = this.requests.concat();
    for (let i = 0; i < r.length; i++) {
      this.sendResponse(false, r[i].id, { error: 'User Cancelled' });
    }
  }

  private resetApprovedOrigins(): void {
    this.approvedOrigins = [];
    this.persistSession();
  }

  unlock(pw: string): Promise<void> {
    return new Promise<void>((resolve, reject): void => {
      chrome.storage.local.get(['vault', 'preferences', 'version'], items => {
        if (
          'vault' in items &&
          'data' in items.vault &&
          'checksum' in items.vault
        ) {
          if (items.vault.checksum === EncryptUtil.createCheckSum(pw)) {
            this.password = pw;
            this.isUnlocked = true;

            // version 1 > version 2
            if (items.version === 1) {
              items.preferences.isAdvancedModeEnabled = this.preferences.isAdvancedModeEnabled;
            }

            const key = JSON.parse(
              EncryptUtil.decrypt(items.vault.data, this.password)
            );

            // version 2 > version 3
            if (items.version <= 2) {
              key.hdkey.seedVersion = 'Electrum1';
              key.hdkey.basePath = "m/0'/0/";
            }

            // version 3 > version 4
            if (items.version <= 3) {
              items.preferences.lang = 'en';
            }

            this.preferences = items.preferences;
            this.createKeyring(
              key.hdkey.mnemonic,
              key.hdkey.seedVersion,
              key.hdkey.basePath,
              key.hdkey.numberOfAccounts,
              key.privatekeys,
              null
            );
            this.touch();
            resolve();
          } else {
            this.resetPassword();
            reject('Unlock Failed');
          }
        } else {
          this.password = pw;
          resolve();
        }
      });
    });
  }

  lock(): void {
    this.resetPreferences();
    this.resetKeyring();
    this.resetPassword();
    this.resetRequest();
    this.resetApprovedOrigins();
  }

  getIsUnlocked(): boolean {
    return this.isUnlocked;
  }

  isAdvancedModeEnabled(): boolean {
    return this.preferences.isAdvancedModeEnabled;
  }

  setAdvancedMode(isEnabled: boolean): Promise<void> {
    this.preferences.isAdvancedModeEnabled = isEnabled;

    if (!this.isUnlocked) {
      return this.updatePreferences();
    } else {
      return this.updateState();
    }
  }

  getLang(): Promise<string> {
    return new Promise<string>((resolve): void => {
      chrome.storage.local.get(['preferences'], items => {
        if ('preferences' in items) {
          if ('lang' in items.preferences) {
            resolve(items.preferences.lang);
          } else {
            resolve('en');
          }
        } else {
          if (this.preferences.lang) {
            resolve(this.preferences.lang);
          } else {
            resolve(null);
          }
        }
      });
    });
  }

  setLang(lang: string): Promise<void> {
    this.preferences.lang = lang;

    if (!this.isUnlocked) {
      return this.updatePreferences();
    } else {
      return this.updateState();
    }
  }

  updatePreferences(): Promise<void> {
    return new Promise<void>((resolve): void => {
      chrome.storage.local.get(['preferences'], items => {
        if ('preferences' in items) {
          items.preferences.lang = this.preferences.lang;
          items.preferences.isAdvancedModeEnabled = this.preferences.isAdvancedModeEnabled;

          chrome.storage.local.set({ preferences: items.preferences }, () => {
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  }

  createKeyring(
    passphrase: string,
    seedVersion: string,
    basePath: string,
    numberOfAccounts: number,
    privatekeys: string[],
    baseName: string
  ): void {
    this.keyring = new Keyring();
    this.keyring.deserialize(
      passphrase,
      seedVersion,
      basePath,
      numberOfAccounts,
      privatekeys
    );

    const name = baseName ? baseName : 'Account';
    const accounts = this.keyring.getAccounts();
    for (let i = 0; i < accounts.length; i++) {
      const accountName = this.incrementAccountName(
        name,
        this.preferences.identities.length + 1
      );
      this.setIdentities(
        accounts[i].address,
        accountName,
        accounts[i].index < 0
      );
    }
    if (this.preferences.selectedAddress === '') {
      this.changeAddress(accounts[0].address);
    }

    this.broadcastUpdate(ContentScriptMessage.LoginState, {
      isUnlocked: this.isUnlocked
    });
  }

  setIdentities(address: string, name: string, isImport: boolean): void {
    if (!this.preferences.identities.some(value => value.address === address)) {
      this.preferences.identities.push({
        address: address,
        name: name,
        isImport: isImport
      });
    }
  }

  private saveState(data: VaultData): Promise<void> {
    return new Promise<void>((resolve, reject): void => {
      if (!this.isUnlocked) {
        this.resetPreferences();
        this.resetKeyring();
        reject('Not Logged In.');
      } else {
        const storedData: StoredData = {
          version: this.version,
          preferences: this.preferences,
          vault: {
            data: EncryptUtil.encrypt(JSON.stringify(data), this.password),
            checksum: EncryptUtil.createCheckSum(this.password)
          }
        };
        chrome.storage.local.set(storedData, () => {
          resolve();
        });
      }
    });
  }

  updateState(): Promise<void> {
    return this.saveState(this.keyring.serialize());
  }

  decodeBase58(str: string): Uint8Array {
    return this.keyring.decodeBase58(str);
  }

  saveNewPassphrase(
    passphrase: string,
    seedVersion: string,
    basePath: string,
    baseName: string
  ): Promise<void> {
    if (this.password !== '') {
      this.isUnlocked = true;
      this.touch();
    }
    this.createKeyring(passphrase, seedVersion, basePath, 1, [], baseName);

    return this.updateState();
  }

  getPassphrase(password: string): string {
    let passphrase = '';
    if (password === this.password) {
      passphrase = this.keyring.getPassphrase();
    }
    return passphrase;
  }

  getHdkey(password: string): Hdkey {
    let hdkey = null;
    if (password === this.password) {
      hdkey = this.keyring.getHdkey();
    }
    return hdkey;
  }

  getPrivatekey(password: string, address: string): string {
    let privatekey = '';
    if (password === this.password) {
      privatekey = this.keyring.getPrivatekey(address);
    }
    return privatekey;
  }

  createAccount(name: string): Promise<void> {
    if (name === '') {
      return Promise.reject('The account name is empty');
    } else if (this.preferences.identities.some(value => value.name === name)) {
      return Promise.reject('The account name is a duplicate');
    } else {
      const account = this.keyring.addAccount();
      this.setIdentities(account.address, name, account.index < 0);
      this.changeAddress(account.address);
      return this.updateState();
    }
  }

  importAccount(wif: string, name: string): Promise<void> {
    if (name === '') {
      return Promise.reject('The account name is empty');
    } else if (this.preferences.identities.some(value => value.name === name)) {
      return Promise.reject('The account name is a duplicate');
    } else if (this.keyring.containsPrivatekey(wif)) {
      return Promise.reject(
        'The account you are trying to import is a duplicate'
      );
    } else {
      const account = this.keyring.importAccount(wif);
      this.setIdentities(account.address, name, account.index < 0);
      this.changeAddress(account.address);
      return this.updateState();
    }
  }

  removeAccount(address: string): Promise<void> {
    this.keyring.removeAccount(address);
    this.preferences.identities = this.preferences.identities.filter(
      value => value.address !== address
    );
    if (this.preferences.selectedAddress === address) {
      this.changeAddress(this.keyring.getAccounts()[0].address);
    }
    return this.updateState();
  }

  incrementAccountName(name: string, num: number): string {
    while (
      this.preferences.identities.some(value => value.name === name + ' ' + num)
    ) {
      num++;
    }

    return name + ' ' + num;
  }

  purgeAll(): Promise<void> {
    return new Promise((resolve): void => {
      chrome.storage.local.clear(() => {
        this.lock();
        resolve();
      });
    });
  }

  existsVault(): Promise<boolean> {
    return new Promise<boolean>((resolve): void => {
      chrome.storage.local.get('vault', items => {
        if (
          'vault' in items &&
          'data' in items.vault &&
          'checksum' in items.vault
        ) {
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  getAddressInfo(address: string): Promise<any> {
    return MpchainUtil.getAddressInfo(address);
  }

  getAsset(asset: string): Promise<any> {
    return MpchainUtil.getAsset(asset);
  }

  getBalances(address: string, page: number, limit: number): Promise<any> {
    return MpchainUtil.getBalances(address, page, limit);
  }

  getMempool(address: string, page: number, limit: number): Promise<any> {
    return MpchainUtil.getMempool(address, page, limit);
  }

  getIdentities(): { address: string; name: string; isImport: boolean }[] {
    return this.preferences.identities;
  }

  setAccountName(address: string, name: string): Promise<void> {
    const identity = this.preferences.identities.find(
      value => value.address === address
    );
    if (!identity) {
      return Promise.reject('Account Not Found');
    } else if (name === '') {
      return Promise.reject('The account name is empty');
    } else if (this.preferences.identities.some(value => value.name === name)) {
      return Promise.reject('The account name is a duplicate');
    } else {
      identity.name = name;
      return this.updateState();
    }
  }

  getIdentity(
    address: string
  ): { address: string; name: string; isImport: boolean } {
    return this.preferences.identities.find(value => value.address === address);
  }

  getSelectedAddress(): string {
    return this.preferences.selectedAddress;
  }

  private changeAddress(address: string): void {
    if (this.preferences.selectedAddress !== address) {
      const r = this.requests.concat();
      for (let i = 0; i < r.length; i++) {
        this.sendResponse(false, r[i].id, { error: 'User Cancelled' });
      }
      this.preferences.selectedAddress = address;
      this.broadcastUpdate(ContentScriptMessage.AddressState, {
        address: address
      });
    }
  }

  setSelectedAddress(address: string): Promise<void> {
    this.changeAddress(address);
    return this.updateState();
  }

  createSend(
    source: string,
    destination: string,
    asset: string,
    quantity: number,
    memo: string,
    memoIsHex: boolean,
    feePerKb: number,
    disableUtxoLocks: boolean
  ): Promise<any> {
    return MpchainUtil.createSend(
      source,
      destination,
      asset,
      quantity,
      memo,
      memoIsHex,
      feePerKb,
      disableUtxoLocks
    );
  }
}

new Background();
