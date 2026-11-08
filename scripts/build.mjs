import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { watch: { type: 'boolean', default: false } } });
if (values.watch) throw new Error('Use the host plugin reload after npm run build; watch is not implemented.');
await mkdir(new URL('../lib/', import.meta.url), { recursive: true });
await build({
  entryPoints: ['src/host.ts'], outfile: 'lib/index.js', bundle: true,
  platform: 'node', format: 'esm', target: 'node22', sourcemap: true,
});
await build({
  entryPoints: ['src/client.tsx'], outfile: 'lib/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'], sourcemap: true,
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-study-tree",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
});
