"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

/**
 * Camera scanner for the pickup QR code. Loaded with dynamic(..., { ssr: false }) because it needs
 * the browser's camera APIs. Frames are decoded in the browser; only the decoded text is sent.
 */
export default function QrScanner({ onCode, onError }: { onCode: (code: string) => void; onError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const onCodeRef = useRef(onCode);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onCodeRef.current = onCode;
    onErrorRef.current = onError;
  }, [onCode, onError]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState >= 2 && video.videoWidth > 0) {
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
          if (result?.data) {
            stopped = true;
            onCodeRef.current(result.data);
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        onErrorRef.current("This browser has no camera access. Paste the code or use the simulated scan.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setActive(true);
        raf = requestAnimationFrame(tick);
      } catch {
        onErrorRef.current("The camera could not be opened. Allow camera access, or paste the code or use the simulated scan.");
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="relative overflow-hidden rounded-xl border border-paper-3 bg-ink">
      <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline aria-label="Camera preview for scanning the buyer's pickup code" />
      <canvas ref={canvasRef} className="hidden" />
      <div className="pointer-events-none absolute inset-8 rounded-2xl border-4 border-white/80" aria-hidden="true" />
      <p className="absolute inset-x-0 bottom-0 bg-ink/70 px-3 py-1.5 text-center text-xs text-white" role="status">
        {active ? "Point the camera at the buyer's QR code" : "Opening the camera"}
      </p>
    </div>
  );
}
