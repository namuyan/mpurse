import { ContentScriptMessage } from './enum/contentScriptMessage';
import { InPageMessage } from './enum/inPageMessage';

class ContentScript {
  private isAlive = false;
  private hasInit = false;
  private lastReconnectAt = 0;
  private port: chrome.runtime.Port;

  constructor() {
    this.assignEventHandlers();
    this.connectPort();
  }

  connectPort(): void {
    this.port = chrome.runtime.connect({ name: ContentScriptMessage.PortName });
    this.isAlive = true;

    this.port.onMessage.addListener((message: any) => {
      if (message && message.type) {
        window.postMessage(
          {
            action: this.getResponseAction(message.type),
            id: message.id,
            data: message.data
          },
          '*'
        );
      }
    });

    this.port.onDisconnect.addListener(() => {
      // read lastError so the browser does not log it as unchecked
      void chrome.runtime.lastError;
      this.isAlive = false;
      // The browser stops the background service worker after a short idle time,
      // which closes this port. The extension is still installed, so reconnect
      // instead of telling the page that the wallet is locked. Hidden tabs
      // reconnect when they become visible again.
      if (this.hasInit && !document.hidden) {
        this.reconnect(false);
      }
    });
  }

  reconnect(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastReconnectAt < 5000) {
      return;
    }
    this.lastReconnectAt = now;
    try {
      this.connectPort();
      if (this.hasInit) {
        // register this port again and ask for the current state
        this.port.postMessage({
          type: ContentScriptMessage.InPageInit,
          id: 0,
          origin: window.location.origin,
          data: { reconnect: true }
        });
      }
    } catch (e) {
      // the extension was removed, disabled or reloaded
      this.isAlive = false;
      this.notifyUnavailable();
    }
  }

  notifyUnavailable(): void {
    window.postMessage(
      {
        action: InPageMessage.LoginState,
        id: 0,
        data: { isUnlocked: false }
      },
      '*'
    );
    window.postMessage(
      {
        action: InPageMessage.AddressState,
        id: 0,
        data: { address: '' }
      },
      '*'
    );
  }

  assignEventHandlers(): void {
    window.addEventListener('message', async (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data.action) {
        try {
          if (!this.isAlive) {
            this.reconnect(true);
          }
          if (
            this.getRequestType(event.data.action) ===
            ContentScriptMessage.InPageInit
          ) {
            this.hasInit = true;
          }
          this.port.postMessage({
            type: this.getRequestType(event.data.action),
            id: event.data.id,
            origin: event.origin,
            data: event.data.message
          });
        } catch (e) {
          window.postMessage(
            {
              action: this.getResponseAction(
                this.getRequestType(event.data.action)
              ),
              id: event.data.id,
              data: { error: 'Extension context invalidated' }
            },
            '*'
          );
        }
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.hasInit && !this.isAlive) {
        this.reconnect(false);
      }
    });
    document.addEventListener('DOMContentLoaded', () => {
      const head = document.head || document.documentElement;
      if (head) {
        this.injectScript();
      }
    });
  }

  injectScript(): void {
    try {
      const scriptTag = document.createElement('script');
      scriptTag.src = chrome.runtime.getURL('extension_scripts/inpage.js');
      scriptTag.async = false;
      document.head.appendChild(scriptTag);
      document.head.removeChild(scriptTag);
    } catch (e) {
      console.error('Script injection failed', e);
    }
  }

  getRequestType(action: InPageMessage): ContentScriptMessage {
    switch (action) {
      case InPageMessage.InitRequest:
        return ContentScriptMessage.InPageInit;

      case InPageMessage.AddressRequest:
        return ContentScriptMessage.Address;

      case InPageMessage.SendAssetRequest:
        return ContentScriptMessage.SendAsset;

      case InPageMessage.SignRawTransactionRequest:
        return ContentScriptMessage.SignRawTransaction;

      case InPageMessage.SignMessageRequest:
        return ContentScriptMessage.SignMessage;

      case InPageMessage.SendRawTransactionRequest:
        return ContentScriptMessage.SendRawTransaction;

      case InPageMessage.MpchainRequest:
        return ContentScriptMessage.Mpchain;

      case InPageMessage.CounterBlockRequest:
        return ContentScriptMessage.CounterBlock;

      case InPageMessage.CounterPartyRequest:
        return ContentScriptMessage.CounterParty;
    }
  }

  getResponseAction(type: ContentScriptMessage): InPageMessage {
    switch (type) {
      case ContentScriptMessage.InPageContent:
        return null;

      case ContentScriptMessage.InPageInit:
        return InPageMessage.InitResponse;

      case ContentScriptMessage.LoginState:
        return InPageMessage.LoginState;

      case ContentScriptMessage.AddressState:
        return InPageMessage.AddressState;

      case ContentScriptMessage.Address:
        return InPageMessage.AddressResponse;

      case ContentScriptMessage.SendAsset:
        return InPageMessage.SendAssetResponse;

      case ContentScriptMessage.SignRawTransaction:
        return InPageMessage.SignRawTransactionResponse;

      case ContentScriptMessage.SignMessage:
        return InPageMessage.SignMessageResponse;

      case ContentScriptMessage.SendRawTransaction:
        return InPageMessage.SendRawTransactionResponse;

      case ContentScriptMessage.Mpchain:
        return InPageMessage.MpchainResponse;

      case ContentScriptMessage.CounterBlock:
        return InPageMessage.CounterBlockResponse;

      case ContentScriptMessage.CounterParty:
        return InPageMessage.CounterPartyResponse;
    }
  }
}

new ContentScript();
