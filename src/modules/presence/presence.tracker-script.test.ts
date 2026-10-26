import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { TRACKER_SCRIPT } from './presence.tracker-script';

/*
 * The tracker runs on other teams' panels, so these run the real script in a
 * small fake browser and check what those panels will experience: the queue,
 * what is sent, and that nothing it does can throw into the page.
 */

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

function page(
  opts: { path?: string; hash?: string; storageThrows?: boolean; queue?: unknown[][]; panel?: string; saved?: Map<string, string> } = {},
) {
  const sent: Sent[] = [];
  const listeners: Record<string, () => void> = {};
  const intervals: Array<() => void> = [];
  const store = opts.saved ?? new Map<string, string>();
  const location = { pathname: opts.path ?? '/renewal-analysis', hash: opts.hash ?? '' };

  const window: Record<string, unknown> = {
    addEventListener: (name: string, fn: () => void) => {
      listeners[name] = fn;
    },
  };
  if (opts.queue) window.BambinosPresence = { q: opts.queue };

  const context = {
    window,
    location,
    document: {
      visibilityState: 'visible',
      title: 'Renewal Analysis | Bambinos',
      currentScript: {
        src: 'https://hrms-api.example.com/api/v1/tracker/presence.js',
        getAttribute: (name: string) => (name === 'data-panel' ? (opts.panel ?? 'renewals') : null),
      },
    },
    navigator: {
      sendBeacon: (url: string, blob: { text: string }) => {
        sent.push({ url, body: JSON.parse(blob.text) });
        return true;
      },
    },
    Blob: class {
      text: string;
      constructor(parts: string[]) {
        this.text = parts.join('');
      }
    },
    localStorage: {
      getItem: (k: string) => {
        if (opts.storageThrows) throw new Error('blocked');
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (opts.storageThrows) throw new Error('blocked');
        store.set(k, v);
      },
      removeItem: (k: string) => store.delete(k),
    },
    setInterval: (fn: () => void) => {
      intervals.push(fn);
      return intervals.length;
    },
    fetch: () => Promise.resolve(),
    JSON,
    Date,
    Number,
    String,
  };
  vm.runInNewContext(TRACKER_SCRIPT, context);
  return { window, sent, listeners, intervals, location, store };
}

test('calls queued before the script loaded are replayed, and the first ping is sent', () => {
  const p = page({ queue: [['identify', { adminId: 327 }]] });
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0].url, 'https://hrms-api.example.com/api/v1/tracker/collect');
  assert.deepEqual(
    { ...p.sent[0].body, title: undefined },
    { v: 1, event: 'ping', panel: 'renewals', adminId: 327, path: '/renewal-analysis', title: undefined },
  );
});

test('the query string never leaves the page; hash routes are read as their route', () => {
  const a = page({ path: '/parents', queue: [['identify', { adminId: 1 }]] });
  assert.equal(a.sent[0].body.path, '/parents');
  const b = page({ path: '/', hash: '#/students/9?mobile=98765', queue: [['identify', { adminId: 1 }]] });
  assert.equal(b.sent[0].body.path, '/students/9');
});

test('nothing is sent before identify, or after signOut', () => {
  const p = page();
  p.intervals.forEach((fn) => fn());
  assert.equal(p.sent.length, 0);

  const api = p.window.BambinosPresence as { identify: (o: unknown) => void; signOut: () => void };
  api.identify({ email: 'a@bambinos.live' });
  api.signOut();
  assert.deepEqual(p.sent.map((s) => s.body.event), ['ping', 'signoff']);
  p.listeners.mousemove();
  p.intervals.forEach((fn) => fn());
  assert.equal(p.sent.length, 2, 'signed out: silent');
});

test('a bad identify is ignored rather than thrown', () => {
  const p = page();
  const api = p.window.BambinosPresence as { identify: (o: unknown) => void };
  assert.doesNotThrow(() => api.identify(undefined));
  assert.doesNotThrow(() => api.identify({ adminId: 'abc' }));
  assert.equal(p.sent.length, 0);
});

test('blocked storage (private mode) does not break it', () => {
  const p = page({ storageThrows: true, queue: [['identify', { adminId: 5 }]] });
  assert.equal(p.sent.length, 1);
});

test('the identity survives a reload of the panel', () => {
  const first = page({ queue: [['identify', { adminId: 42 }]] });
  // Reload: same storage, and the panel does not call identify again.
  const again = page({ saved: first.store });
  again.listeners.mousemove();
  assert.equal(again.sent.length, 1);
  assert.equal(again.sent[0].body.adminId, 42);
});

test('loading the script twice does not double the pings', () => {
  const p = page({ queue: [['identify', { adminId: 7 }]] });
  const before = p.sent.length;
  assert.doesNotThrow(() => vm.runInNewContext(TRACKER_SCRIPT, { window: p.window, document: {} }));
  assert.equal(p.sent.length, before);
});
