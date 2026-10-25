// Bundles the server, the engine and Colyseus into one file: dist/main.mjs.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Some dependencies still call require(); give the ES module one.
  banner: { js: "import { createRequire as __lbCreateRequire } from 'node:module'; const require = __lbCreateRequire(import.meta.url);" },
  logLevel: 'warning',
});
