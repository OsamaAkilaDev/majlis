export interface DetectedBarcode {
  rawValue: string;
}

export interface BarcodeReader {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

export interface ReaderConstructor {
  new (options?: { formats?: string[] }): BarcodeReader;
}

export type NativeDetector = ReaderConstructor & {
  getSupportedFormats?: () => Promise<string[]>;
};

/**
 * A QR reader on every browser, spec 9.4.
 *
 * `BarcodeDetector` is not a web API so much as a window onto one the operating
 * system may or may not have: Chromium exposes it only on macOS, ChromeOS and
 * Android, and Safari and Firefox never. That leaves every iPhone and every
 * Windows laptop without one, which is most of a check-in desk.
 *
 * The presence of the constructor is not the question, though. It answers for
 * the API, not for the formats behind it, so it is `getSupportedFormats` that
 * decides. Anything short of a platform that says `qr_code` out loud gets the
 * wasm decoder, which is loaded only when it is the one that will be used.
 */
export async function qrReader(
  native: NativeDetector | undefined,
  load: () => Promise<ReaderConstructor>,
): Promise<BarcodeReader> {
  const Reader = (await decodesQr(native)) ? native! : await load();
  return new Reader({ formats: ['qr_code'] });
}

/**
 * `qrReader` wired to this app: the platform's detector, and the wasm one from
 * our own origin.
 *
 * The decoder resolves its `.wasm` against the URL of the chunk that imported
 * it, which after bundling is a hashed path under `/_next/static` that holds no
 * such file. `prebuild` and `predev` copy it into `public/`, and this points the
 * decoder there. Serving it ourselves is also the point: a check-in desk on
 * venue wifi should not be one captive portal away from a scanner that cannot
 * decode.
 */
export function scannerReader(): Promise<BarcodeReader> {
  return qrReader((globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector, async () => {
    const { BarcodeDetector, setZXingModuleOverrides } = await import('barcode-detector/ponyfill');
    setZXingModuleOverrides({
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? WASM : prefix + path),
    });
    return BarcodeDetector as unknown as ReaderConstructor;
  });
}

/** Kept in step with `node_modules` by `scripts/copy-wasm.mjs`. */
const WASM = '/zxing_reader.wasm';

async function decodesQr(native: NativeDetector | undefined) {
  try {
    return (await native?.getSupportedFormats?.())?.includes('qr_code') ?? false;
  } catch {
    // Chrome on Android reports a barcode module it could not install by
    // rejecting here. A platform that cannot answer does not have the format.
    return false;
  }
}
