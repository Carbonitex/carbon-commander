import { describe, expect, it } from 'vitest';
import { createBarTrust, type SenderLike } from '../../src/background/bar-trust';
import { STORAGE_KEYS } from '../../src/shared/defaults';
import { createFakeStorageArea } from '../helpers/fake-storage';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const BASE = `chrome-extension://${ID}/`;
const TOKEN = '0123456789abcdef0123456789abcdef';

const content = (tabId = 5): SenderLike => ({ id: ID, url: 'https://example.com/', frameId: 0, tab: { id: tabId } });
const bar = (tabId = 5, documentId = 'DOC1', frameId = 3): SenderLike => ({
  id: ID,
  url: `${BASE}bar.html`,
  frameId,
  documentId,
  tab: { id: tabId, url: 'https://example.com/' },
});

function setup(now = () => 1_000) {
  const storage = createFakeStorageArea();
  return { storage, trust: createBarTrust({ extensionId: ID, extensionBaseUrl: BASE, storage, now }) };
}

describe('bar trust (clickjacking defence)', () => {
  it('trusts an embedded bar only after it claims a token our content script registered for its tab', async () => {
    const { trust } = setup();
    expect(await trust.isTrusted(bar())).toBe(false);
    expect(await trust.registerToken(TOKEN, content())).toBe(true);
    expect(await trust.claim(TOKEN, bar(6))).toBe(false); // other tab
    expect(await trust.claim(TOKEN, bar())).toBe(true);
    expect(await trust.isTrusted(bar())).toBe(true);
    expect(await trust.isTrusted(bar(5, 'DOC2'))).toBe(false); // another framed document
    expect(await trust.claim(TOKEN, bar(5, 'DOC2'))).toBe(false); // single use
  });

  it('only accepts tokens from a content script in a top frame, and claims from bar.html', async () => {
    const { trust } = setup();
    expect(await trust.registerToken(TOKEN, { ...content(), frameId: 2 })).toBe(false);
    expect(await trust.registerToken(TOKEN, { ...content(), id: 'other' })).toBe(false);
    expect(await trust.registerToken(TOKEN, { ...content(), url: `${BASE}bar.html` })).toBe(false);
    expect(await trust.registerToken(TOKEN, content())).toBe(true);
    expect(await trust.claim(TOKEN, { ...bar(), url: `${BASE}other.html` })).toBe(false);
    expect(await trust.claim(TOKEN, { ...bar(), frameId: 0 })).toBe(false);
  });

  it('tokens expire', async () => {
    let t = 1_000;
    const { trust } = setup(() => t);
    await trust.registerToken(TOKEN, content());
    t += 61_000;
    expect(await trust.claim(TOKEN, bar())).toBe(false);
  });

  it('trusts top-level extension pages and non-tab surfaces; never other extensions or web pages', async () => {
    const { trust } = setup();
    expect(await trust.isTrusted({ id: ID, url: `${BASE}bar.html?tabId=3`, frameId: 0, tab: { id: 9, url: `${BASE}bar.html?tabId=3` } })).toBe(true);
    expect(await trust.isTrusted({ id: ID, url: `${BASE}bar.html` })).toBe(true);
    expect(await trust.isTrusted({ id: 'other', url: `${BASE}bar.html` })).toBe(false);
    expect(await trust.isTrusted(content())).toBe(false);
  });

  it('survives a worker restart and forgets closed tabs', async () => {
    const { trust, storage } = setup();
    await trust.registerToken(TOKEN, content());
    await trust.claim(TOKEN, bar());
    const restarted = createBarTrust({ extensionId: ID, extensionBaseUrl: BASE, storage });
    expect(await restarted.isTrusted(bar())).toBe(true);
    restarted.onTabRemoved(5);
    await new Promise((r) => setTimeout(r, 5));
    expect(await restarted.isTrusted(bar())).toBe(false);
    expect(storage.data.get(STORAGE_KEYS.barFrames)).toEqual({ tokens: {}, docs: {} });
  });
});
