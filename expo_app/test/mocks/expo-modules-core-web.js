// Minimal web shim expected by jest-expo preset
globalThis.expo = globalThis.expo || {};
if (!globalThis.expo.EventEmitter) {
  globalThis.expo.EventEmitter = class {};
}
if (!globalThis.expo.NativeModule) {
  globalThis.expo.NativeModule = class {};
}
if (!globalThis.expo.SharedObject) {
  globalThis.expo.SharedObject = class {};
}

module.exports = {};


