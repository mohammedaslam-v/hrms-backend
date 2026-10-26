/**
 * The shared tracker every other Bambinos panel loads (Renewal, CRM, Faculty, …),
 * served as GET /api/v1/tracker/presence.js.
 *
 * Kept as a string so it ships inside the compiled build with no asset step.
 * Plain ES5, no dependencies, and every entry point wrapped in try/catch: it
 * must never be able to throw into, slow down or change the page it runs on.
 *
 * What it does, and nothing else:
 *   - remembers who is signed in, from BambinosPresence.identify({ adminId | email });
 *   - once a minute, while the tab is visible AND someone used it in the last
 *     minute, sends { panel, path, title } to /tracker/collect;
 *   - notices page changes (checks the address every 2 s — no patching of the
 *     app's router or of history);
 *   - BambinosPresence.signOut() on logout forgets the person.
 *
 * Only the path is sent. The query string never leaves the page: on our panels
 * it can carry a parent's phone number.
 *
 * Calls made before the file has loaded are queued by the one-line stub in the
 * integration guide (window.BambinosPresence = { q: [], … }) and replayed here.
 */
export const TRACKER_SCRIPT = String.raw`/* Bambinos presence tracker v1 */
(function () {
  'use strict';
  try {
    var existing = window.BambinosPresence;
    if (existing && existing.__loaded) return;

    var script = document.currentScript;
    var src = (script && script.src) || '';
    var base = src.replace(/\/tracker\/presence\.js(\?.*)?$/, '');
    if (!base || base === src) return;
    var COLLECT = base + '/tracker/collect';
    var panel = (script && script.getAttribute('data-panel')) || '';

    var STORE = 'bambinos_presence_identity';
    var PING_MS = 60000;
    var ACTIVE_MS = 60000;
    var ROUTE_MS = 2000;

    var who = null;
    var lastInput = 0;
    var lastSent = 0;
    var lastPath = null;

    function load() {
      try {
        var o = JSON.parse(localStorage.getItem(STORE) || 'null');
        if (o && (o.adminId || o.email)) who = o;
      } catch (e) {}
    }

    function save() {
      try {
        if (who) localStorage.setItem(STORE, JSON.stringify(who));
        else localStorage.removeItem(STORE);
      } catch (e) {}
    }

    // Hash routers (#/page) are read as their route; the query string is dropped.
    function currentPath() {
      var hash = location.hash || '';
      if (hash.indexOf('#/') === 0) return hash.slice(1).split('?')[0];
      return location.pathname || '/';
    }

    function send(event) {
      if (!who) return;
      var body = JSON.stringify({
        v: 1,
        event: event,
        panel: panel || undefined,
        adminId: who.adminId || undefined,
        email: who.email || undefined,
        path: currentPath(),
        title: String(document.title || '').slice(0, 120)
      });
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(COLLECT, new Blob([body], { type: 'text/plain' }))) return;
      } catch (e) {}
      try {
        fetch(COLLECT, {
          method: 'POST',
          body: body,
          mode: 'no-cors',
          keepalive: true,
          credentials: 'omit',
          headers: { 'Content-Type': 'text/plain' }
        })['catch'](function () {});
      } catch (e) {}
    }

    function isActive() {
      return document.visibilityState === 'visible' && Date.now() - lastInput < ACTIVE_MS;
    }

    function ping() {
      try {
        if (who && isActive()) {
          send('ping');
          lastSent = Date.now();
          lastPath = currentPath();
        }
      } catch (e) {}
    }

    // Back after a quiet spell: report at once rather than at the next minute.
    function onInput() {
      var wasIdle = Date.now() - lastInput >= ACTIVE_MS;
      lastInput = Date.now();
      if (wasIdle && Date.now() - lastSent > 15000) ping();
    }

    function onRoute() {
      try {
        if (currentPath() !== lastPath && Date.now() - lastSent > 3000) ping();
      } catch (e) {}
    }

    function identify(o) {
      try {
        if (!o) return;
        var id = Number(o.adminId);
        var email = typeof o.email === 'string' && o.email ? o.email : null;
        if (!(id > 0) && !email) return;
        who = { adminId: id > 0 ? id : null, email: email };
        save();
        lastInput = Date.now();
        ping();
      } catch (e) {}
    }

    function signOut() {
      try {
        send('signoff');
        who = null;
        save();
      } catch (e) {}
    }

    var api = { __loaded: true, version: 1, identify: identify, signOut: signOut };
    window.BambinosPresence = api;

    load();

    var events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart'];
    for (var i = 0; i < events.length; i++) {
      window.addEventListener(events[i], onInput, { capture: true, passive: true });
    }
    setInterval(ping, PING_MS);
    setInterval(onRoute, ROUTE_MS);

    // Calls the page made before this file arrived.
    var queued = (existing && existing.q) || [];
    for (var j = 0; j < queued.length; j++) {
      var call = queued[j];
      if (call && call[0] === 'identify') identify(call[1]);
      else if (call && call[0] === 'signOut') signOut();
    }
  } catch (e) {}
})();
`;
