import { describe, expect, it, vi } from 'vitest';
import { qrReader, type BarcodeReader } from './barcode';

/** Stands in for whatever the two paths hand back, so a test can tell which
 *  one answered without reaching into either implementation. */
function detector(tag: string) {
  return class {
    readonly tag = tag;
    readonly options: { formats?: string[] } | undefined;
    constructor(options?: { formats?: string[] }) {
      this.options = options;
    }
    detect() {
      return Promise.resolve([]);
    }
  };
}

const Ponyfill = detector('ponyfill');
const loader = () => Promise.resolve(Ponyfill);

function tagOf(reader: BarcodeReader) {
  return (reader as unknown as { tag: string }).tag;
}

describe('qrReader', () => {
  it('uses the platform decoder when it lists QR among its formats', async () => {
    // The reason the native branch is kept at all. An implementation that
    // always reached for the ponyfill would pass every other test in this
    // file and would push a wasm download and a JS decode loop onto the
    // Android and macOS devices that have a hardware decoder sitting idle.
    const Native = Object.assign(detector('native'), {
      getSupportedFormats: () => Promise.resolve(['qr_code', 'code_128']),
    });
    const load = vi.fn(loader);

    const reader = await qrReader(Native, load);

    expect(tagOf(reader)).toBe('native');
    expect(load).not.toHaveBeenCalled();
  });

  it('falls back when a constructor exists but QR is not among its formats', async () => {
    // The silent failure this whole module exists to remove. `if
    // (window.BarcodeDetector)` — what shipped — is true on an Android whose
    // barcode module never installed, so the operator gets a live viewfinder
    // that decodes nothing for the length of the queue and never says why.
    const Native = Object.assign(detector('native'), {
      getSupportedFormats: () => Promise.resolve(['code_128', 'ean_13']),
    });

    expect(tagOf(await qrReader(Native, loader))).toBe('ponyfill');
  });

  it('falls back when the platform has no detector at all', async () => {
    // Safari on every iPhone, Firefox everywhere, and Chrome on Windows and
    // Linux. This is the reported bug: an implementation that gives up here
    // leaves the majority of devices on the email form.
    expect(tagOf(await qrReader(undefined, loader))).toBe('ponyfill');
  });

  it('falls back when asking the platform for its formats rejects', async () => {
    // Chrome on Android surfaces a missing Play Services barcode module as a
    // rejection, not an empty list. An unguarded `await` leaves the promise
    // rejected, the camera never starts, and no state is ever reported.
    const Native = Object.assign(detector('native'), {
      getSupportedFormats: () => Promise.reject(new Error('module unavailable')),
    });

    expect(tagOf(await qrReader(Native, loader))).toBe('ponyfill');
  });

  it('asks either decoder for QR alone', async () => {
    // Left unconstrained, the wasm reader tries every symbology it knows on
    // every frame. The formats argument is the difference between a quarter
    // of a second per look and several.
    const Native = Object.assign(detector('native'), {
      getSupportedFormats: () => Promise.resolve(['qr_code']),
    });

    for (const reader of [await qrReader(Native, loader), await qrReader(undefined, loader)]) {
      expect((reader as unknown as { options?: { formats?: string[] } }).options).toEqual({
        formats: ['qr_code'],
      });
    }
  });
});
