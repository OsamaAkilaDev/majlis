// The QR fallback decoder's wasm, served from our own origin. See
// `src/lib/barcode.ts`. Copied rather than committed so it cannot drift from
// the version in `node_modules`.
//
// Resolved by way of barcode-detector because zxing-wasm is its dependency,
// not ours, and pnpm does not put another package's dependencies where we
// could reach them directly.
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const here = createRequire(import.meta.url);
const owner = createRequire(here.resolve('barcode-detector/ponyfill'));
const from = owner.resolve('zxing-wasm/reader/zxing_reader.wasm');

await mkdir('public', { recursive: true });
await copyFile(from, 'public/zxing_reader.wasm');
