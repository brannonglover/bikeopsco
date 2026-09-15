/**
 * Timer Web Worker — runs setInterval / setTimeout that are immune to
 * background-tab throttling imposed by browsers.
 *
 * Protocol (postMessage):
 *   → { type: "setInterval", id: string, ms: number }
 *   → { type: "setTimeout",  id: string, ms: number }
 *   → { type: "clear",       id: string }
 *   → { type: "clearAll" }
 *   ← { type: "tick",        id: string }
 */

/* eslint-disable no-restricted-globals */
const timers = new Map();

self.onmessage = function handleMessage(e) {
  const msg = e.data;
  switch (msg.type) {
    case "setInterval": {
      if (timers.has(msg.id)) clearInterval(timers.get(msg.id));
      timers.set(
        msg.id,
        setInterval(function () {
          self.postMessage({ type: "tick", id: msg.id });
        }, msg.ms)
      );
      break;
    }
    case "setTimeout": {
      if (timers.has(msg.id)) clearTimeout(timers.get(msg.id));
      timers.set(
        msg.id,
        setTimeout(function () {
          timers.delete(msg.id);
          self.postMessage({ type: "tick", id: msg.id });
        }, msg.ms)
      );
      break;
    }
    case "clear": {
      const id = msg.id;
      if (timers.has(id)) {
        clearTimeout(timers.get(id));
        clearInterval(timers.get(id));
        timers.delete(id);
      }
      break;
    }
    case "clearAll": {
      for (const timer of timers.values()) {
        clearTimeout(timer);
        clearInterval(timer);
      }
      timers.clear();
      break;
    }
  }
};
