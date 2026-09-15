"use client";

/**
 * Thin wrapper around a shared Web Worker (`/poll-worker.js`) that provides
 * setInterval / setTimeout / clearTimer helpers immune to background-tab
 * throttling.  Falls back to native timers when workers are unavailable
 * (SSR, unsupported browser, worker load failure).
 *
 * Usage:
 *   acquire()                       — call once per consumer on mount
 *   release()                       — call once per consumer on unmount
 *   setWorkerInterval(cb, ms)       → id
 *   setWorkerTimeout(cb, ms)        → id
 *   clearWorkerTimer(id)            — cancel by id
 */

let worker: Worker | null = null;
let workerFailed = false;
let refCount = 0;

const handlers = new Map<string, () => void>();
const nativeTimers = new Map<string, ReturnType<typeof setTimeout>>();

let seq = 0;

function initWorker(): Worker | null {
  if (typeof window === "undefined" || workerFailed) return null;
  if (worker) return worker;
  try {
    const w = new Worker("/poll-worker.js");
    w.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "tick") {
        handlers.get(e.data.id as string)?.();
      }
    };
    w.onerror = () => {
      workerFailed = true;
      w.terminate();
      worker = null;
    };
    worker = w;
    return w;
  } catch {
    workerFailed = true;
    return null;
  }
}

/** Call on mount to keep the shared worker alive. */
export function acquire(): void {
  refCount++;
  initWorker();
}

/** Call on unmount to allow the worker to be terminated when unused. */
export function release(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && worker) {
    worker.postMessage({ type: "clearAll" });
    worker.terminate();
    worker = null;
  }
}

function genId(prefix: string): string {
  return `${prefix}${seq++}`;
}

/** Worker-backed setInterval. Returns an opaque id for clearWorkerTimer(). */
export function setWorkerInterval(cb: () => void, ms: number): string {
  const id = genId("i");
  handlers.set(id, cb);
  const w = initWorker();
  if (w) {
    w.postMessage({ type: "setInterval", id, ms });
  } else {
    nativeTimers.set(id, setInterval(cb, ms));
  }
  return id;
}

/** Worker-backed setTimeout. Returns an opaque id for clearWorkerTimer(). */
export function setWorkerTimeout(cb: () => void, ms: number): string {
  const id = genId("t");
  const wrapped = () => {
    handlers.delete(id);
    nativeTimers.delete(id);
    cb();
  };
  handlers.set(id, wrapped);
  const w = initWorker();
  if (w) {
    w.postMessage({ type: "setTimeout", id, ms });
  } else {
    nativeTimers.set(id, setTimeout(wrapped, ms));
  }
  return id;
}

/** Cancel a timer previously created by setWorkerInterval / setWorkerTimeout. */
export function clearWorkerTimer(id: string): void {
  handlers.delete(id);
  const native = nativeTimers.get(id);
  if (native !== undefined) {
    clearInterval(native);
    clearTimeout(native);
    nativeTimers.delete(id);
  }
  worker?.postMessage({ type: "clear", id });
}
