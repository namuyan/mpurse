// Tests for extension_scripts/util.sender.ts.
const assert = require('assert');
const { test, load } = require('./harness');

const { isExtensionPage } = load('util.sender');

const ID = 'ljkohnccmlcpleonoiabgfggnhpkihaa';
const BASE = 'chrome-extension://' + ID + '/';

test('sender: the popup and request windows are accepted', () => {
  assert.strictEqual(isExtensionPage({ id: ID, url: BASE + 'index.html' }, ID, BASE), true);
  assert.strictEqual(
    isExtensionPage({ id: ID, url: BASE + 'index.html#/send?request=true&id=0.5' }, ID, BASE),
    true
  );
  const ff = 'moz-extension://0b5e3c3a-1111-2222-3333-444455556666/';
  assert.strictEqual(isExtensionPage({ id: 'x@y', url: ff + 'index.html' }, 'x@y', ff), true);
});

test('sender: content scripts in web pages are rejected', () => {
  // a content script has the extension's id but the page's URL
  assert.strictEqual(isExtensionPage({ id: ID, url: 'https://example.com/' }, ID, BASE), false);
  assert.strictEqual(
    isExtensionPage({ id: ID, url: 'https://example.com/?chrome-extension://' + ID + '/' }, ID, BASE),
    false
  );
});

test('sender: other extensions and incomplete senders are rejected', () => {
  assert.strictEqual(isExtensionPage({ id: 'other', url: BASE + 'index.html' }, ID, BASE), false);
  assert.strictEqual(isExtensionPage({ id: ID }, ID, BASE), false);
  assert.strictEqual(isExtensionPage(undefined, ID, BASE), false);
  assert.strictEqual(isExtensionPage({ id: ID, url: BASE }, ID, ''), false);
});
