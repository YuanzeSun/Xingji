import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { answerArithmetic } from './arithmetic.js';
import { endpoint, token } from './d1.js';

export function browser() {
  const { window } = new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>', { url: 'http://localhost/#data' });
  for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'FormData', 'navigator', 'indexedDB']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : key === 'indexedDB' ? indexedDB : window[key], configurable: true });
  }
  window.scrollTo = () => {};
  let previous = Promise.resolve();
  Object.defineProperty(window.navigator, 'locks', { value: { request(_name, callback) {
    const next = previous.then(callback);
    previous = next.catch(() => {});
    return next;
  } } });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  return window;
}

export async function until(check) {
  for (let i = 0; i < 300; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Page operation did not complete: ' + [...document.querySelectorAll('.form-error,.toast')].map(el => el.textContent).filter(Boolean).join(' · '));
}

export function connect(window, provider, secret = provider === 'd1' ? token : 'github-credential') {
  const form = document.querySelector('#' + provider + '-form');
  if (provider === 'd1') {
    form.elements.url.value = endpoint;
    form.elements.token.value = secret;
  } else {
    form.elements.owner.value = 'user';
    form.elements.repo.value = 'data';
    form.elements.token.value = secret;
  }
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

export async function confirm(title) {
  await until(() => document.querySelector('dialog h2')?.textContent === title);
  answerArithmetic(document.querySelector('dialog'));
  document.querySelector('dialog [type="submit"]').click();
}

export function useServers(github, d1) {
  globalThis.fetch = function (url, options) {
    assert.equal(this, globalThis, 'browser fetch must receive Window');
    return new URL(url).hostname === 'api.github.com' ? github.fetch(url, options) : d1.fetch(url, options);
  };
}
