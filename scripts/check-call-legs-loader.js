// Stubs for running check-call-legs outside Next.js.
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return __filename;
  return origResolve.call(this, request, ...args);
};
const react = require("react");
if (!react.cache) react.cache = (fn) => fn;
