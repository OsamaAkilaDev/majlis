import { describe, expect, it } from 'vitest';
import { cameraFailure, CAMERA_MESSAGE, RETRYABLE } from './camera';

/** `DOMException` is what the browser rejects with, and its `name` is the only
 *  part of it that is specified. Node 22 has the constructor. */
const fail = (name: string) => new DOMException('denied by test', name);

describe('cameraFailure', () => {
  it('calls a refused permission refused', () => {
    // The two the operator can actually fix by answering a prompt.
    expect(cameraFailure(fail('NotAllowedError'))).toBe('denied');
    expect(cameraFailure(fail('SecurityError'))).toBe('denied');
  });

  it('does not call a missing or busy camera a permission problem', () => {
    // The discriminating case, and the reason this is not `catch { 'denied' }`.
    // A laptop with no camera, or one whose camera Teams is holding, sends the
    // operator into browser settings to grant a permission that was never the
    // problem and that is very often already granted.
    expect(cameraFailure(fail('NotFoundError'))).toBe('unavailable');
    expect(cameraFailure(fail('NotReadableError'))).toBe('unavailable');
    expect(cameraFailure(fail('OverconstrainedError'))).toBe('unavailable');
  });

  it('treats anything it does not recognise as unavailable rather than refused', () => {
    // Including a plain Error, which is what a failed wasm chunk arrives as.
    // Guessing "denied" here accuses the operator of a choice they never made.
    expect(cameraFailure(new Error('chunk load failed'))).toBe('unavailable');
    expect(cameraFailure(undefined)).toBe('unavailable');
  });
});

describe('CAMERA_MESSAGE', () => {
  it('says something different for each way the camera can fail', () => {
    // One message reused across the three would pass any test that only
    // checked a message exists, and would tell the operator nothing about
    // which of the three they are looking at.
    const said = (['denied', 'unavailable', 'unsupported'] as const).map((s) => CAMERA_MESSAGE[s]);
    expect(said.every(Boolean)).toBe(true);
    expect(new Set(said).size).toBe(3);
  });

  it('says nothing while the camera is still coming up or already running', () => {
    // A message under a working viewfinder reads as a fault.
    expect(CAMERA_MESSAGE.starting).toBeUndefined();
    expect(CAMERA_MESSAGE.running).toBeUndefined();
  });
});

describe('RETRYABLE', () => {
  it('offers a retry for the failures a retry can clear, and not otherwise', () => {
    // Permission and a busy device both change on a second ask. Lacking
    // getUserMedia altogether does not, and a button that cannot work is
    // worse at a check-in desk than no button.
    expect(RETRYABLE.has('denied')).toBe(true);
    expect(RETRYABLE.has('unavailable')).toBe(true);
    expect(RETRYABLE.has('unsupported')).toBe(false);
  });
});
