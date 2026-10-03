// Turbopack browser stub for Node-only built-ins (fs/path/crypto).
// qpdf-wasm (Emscripten) requires these behind an `isNode` runtime guard;
// the browser branches never execute, so an empty module is sufficient.
// Referenced by `turbopack.resolveAlias` in next.config.ts.
const emptyModule = {};
export default emptyModule;
