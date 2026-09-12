'use client';

import { useEffect, useRef, useState } from 'react';

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeReader {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeReader;
  }
}

/** Roughly four looks per second. Every frame burns battery and decodes nothing new. */
const INTERVAL_MS = 250;

export type CameraState = 'starting' | 'running' | 'unsupported' | 'denied';

/**
 * BarcodeDetector only, no zxing (decided 2026-09-12). Where it is missing the
 * screen says so once and offers the email form rather than pretending to scan,
 * so this reports `unsupported` instead of silently never firing.
 *
 * Support is read in an effect, never during render: a value taken from the
 * runtime environment while rendering is a hydration mismatch, and React
 * answers one by throwing the whole tree away.
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
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      handlers.current.onState('unsupported');
      return;
    }

    const element = video.current;
    if (!element) return;

    const reader = new window.BarcodeDetector({ formats: ['qr_code'] });
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    async function tick() {
      if (stopped) return;
      if (!pausedRef.current && element) {
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
    }

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        element.srcObject = stream;
        await element.play();
        setReady(true);
        handlers.current.onState('running');
        void tick();
      } catch {
        if (!stopped) handlers.current.onState('denied');
      }
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
