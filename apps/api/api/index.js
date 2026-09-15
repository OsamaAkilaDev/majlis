// The Vercel function entry, and deliberately plain JavaScript.
//
// It requires the COMPILED handler rather than the TypeScript source.
// Vercel's builder runs its own tsc over any .ts entry it finds, with its
// own settings rather than apps/api/tsconfig.json, and that config does not
// carry `"types": ["node"]`. Without that restriction @types/express comes
// into scope ambiently and shadows the global fetch `Response`, so
// storage.service.ts fails with fifteen TS2339 errors on a file that
// compiles cleanly here. Keeping this file .js means Vercel only ever
// bundles JavaScript that `tsc -p tsconfig.build.json` already checked and
// emitted, decorator metadata included.
module.exports = require('../dist/vercel.js').default;
