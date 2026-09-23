/**
 * `unsupported` is the browser having no camera API to offer at all, which at
 * this point means an insecure origin: `http://192.168.x.x` withholds
 * `mediaDevices` where `localhost` and https do not. `denied` and `unavailable`
 * are both live cameras, and the difference between them is whether the
 * operator has anything to answer.
 */
export type CameraState = 'starting' | 'running' | 'denied' | 'unavailable' | 'unsupported';

export const CAMERA_MESSAGE: Partial<Record<CameraState, string>> = {
  denied: 'Camera permission is blocked.',
  unavailable: 'The camera could not be opened.',
  unsupported: 'This browser cannot open a camera.',
};

/** A second ask clears a dismissed prompt or a camera another app has since
 *  let go. It cannot conjure `getUserMedia`. */
export const RETRYABLE: ReadonlySet<CameraState> = new Set<CameraState>(['denied', 'unavailable']);

const REFUSED = new Set(['NotAllowedError', 'SecurityError']);

/**
 * Only ever called on a `getUserMedia` rejection, never on a `play()` one:
 * blocked autoplay also rejects with `NotAllowedError`, so the name cannot tell
 * the two apart and the call site has to.
 */
export function cameraFailure(err: unknown): 'denied' | 'unavailable' {
  return err instanceof DOMException && REFUSED.has(err.name) ? 'denied' : 'unavailable';
}
