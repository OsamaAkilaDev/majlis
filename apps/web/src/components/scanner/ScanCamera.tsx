'use client';

import { useEffect, useRef, useState } from 'react';
import { scannerReader } from '@/lib/barcode';
import { cameraFailure, type CameraState } from '@/lib/camera';

export type { CameraState };

/** Roughly four looks per second. Every frame burns battery and decodes nothing new. */
const INTERVAL_MS = 250;

/**
 * The viewfinder, spec 9.4.
 *
 * Decoding is `@/lib/barcode`'s problem: the platform's `BarcodeDetector` where
 * it genuinely decodes QR, a wasm decoder everywhere else, which is what makes
 * this work on an iPhone or a Windows laptop at all. So `unsupported` here no
 * longer means "this browser cannot decode" — it means there is no camera API
 * to open, which in practice is an insecure origin.
 *
 * Support is read in an effect, never during render: a value taken from the
 * runtime environment while rendering is a hydration mismatch, and React
 * answers one by throwing the whole tree away.
 *
 * Remounted with a new `key` to retry, so every restart runs this effect from
 * the top rather than reasoning about which half of the last attempt survived.
 */
export function ScanCamera({
  paused,
  onToken,
  onState,
}: {
  paused: boolean;
  onToken: (raw: string) => void;
  onState: (state: CameraState) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  // Kept in a ref so a new callback identity cannot tear the camera down and
  // ask the operator for permission again mid-queue.
  const handlers = useRef({ onToken, onState });
  handlers.current = { onToken, onState };

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      handlers.current.onState('unsupported');
      return;
    }

    const element = video.current;
    if (!element) return;

    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    void (async () => {
      // Asked for first, and on its own: a camera held open while a megabyte
      // of wasm downloads is a lit camera light and nothing on screen.
      let reader;
      try {
        reader = await scannerReader();
      } catch {
        // The decoder chunk or its wasm did not arrive. Nothing to scan with,
        // but the network may be better on a second ask.
        if (!stopped) handlers.current.onState('unavailable');
        return;
      }
      if (stopped) return;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
      } catch (err) {
        // Told apart here and not below, because blocked autoplay rejects with
        // NotAllowedError too and would otherwise send the operator hunting
        // through permissions for a permission that was already granted.
        if (!stopped) handlers.current.onState(cameraFailure(err));
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      element.srcObject = stream;
      try {
        await element.play();
      } catch {
        if (!stopped) handlers.current.onState('unavailable');
        return;
      }
      if (stopped) return;

      setReady(true);
      handlers.current.onState('running');

      const tick = async () => {
        if (stopped) return;
        if (!pausedRef.current) {
          try {
            const found = await reader.detect(element);
            const raw = found[0]?.rawValue;
            if (raw && !stopped) handlers.current.onToken(raw);
          } catch {
            // A frame that decodes to nothing throws here on some builds. It is
            // the ordinary case between two people, not a failure.
          }
        }
        timer = setTimeout(() => void tick(), INTERVAL_MS);
      };
      void tick();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      // Releasing the track is what turns the camera light off. Leaving it on
      // after the operator navigates away is the thing they will notice.
      stream?.getTracks().forEach((t) => t.stop());
      element.srcObject = null;
    };
  }, []);

  return (
    <video
      ref={video}
      muted
      playsInline
      aria-hidden
      className={`h-full w-full object-cover ${ready ? '' : 'invisible'}`}
    />
  );
}
