/**
 * QR codes for LAN pairing: render invite/reply codes, and scan them with the
 * camera (native BarcodeDetector where available, jsQR otherwise).
 */
import qrcode from 'qrcode-generator';
import { PALETTE } from '../data/palette';

/** Module matrix for `text` (true = dark). */
export function qrMatrix(text: string): boolean[][] {
  const qr = qrcode(0, 'L');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** A crisp QR canvas: `cell` px per module with the standard 4-module quiet zone. */
export function qrCanvas(text: string, cell = 4): HTMLCanvasElement {
  const m = qrMatrix(text);
  const n = m.length;
  const quiet = 4;
  const c = document.createElement('canvas');
  c.width = c.height = (n + quiet * 2) * cell;
  c.className = 'pixelated';
  const g = c.getContext('2d');
  if (!g) return c;
  g.fillStyle = PALETTE.white;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = PALETTE.ink;
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (m[r]?.[col]) g.fillRect((col + quiet) * cell, (r + quiet) * cell, cell, cell);
  return c;
}

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type DetectorCtor = new (opts: { formats: string[] }) => DetectorLike;

export interface QrScan {
  stop(): void;
}

/**
 * Start the camera in `video` and call `onCode` once with the first QR whose
 * text passes `accept`. Rejects if the camera is unavailable or denied.
 */
export async function startQrScan(video: HTMLVideoElement, accept: (s: string) => boolean, onCode: (s: string) => void): Promise<QrScan> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the camera here. Paste the code instead.');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  video.muted = true;
  await video.play();
  let stopped = false;
  const stop = () => {
    stopped = true;
    for (const t of stream.getTracks()) t.stop();
    video.srcObject = null;
  };
  const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  let detector: DetectorLike | null = null;
  if (Native) {
    try {
      detector = new Native({ formats: ['qr_code'] });
    } catch {
      detector = null;
    }
  }
  const jsQR = detector ? null : (await import('jsqr')).default;
  const frame = document.createElement('canvas');
  const g = frame.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (stopped) return;
    try {
      let text: string | null = null;
      if (detector) {
        const found = await detector.detect(video);
        text = found[0]?.rawValue ?? null;
      } else if (jsQR && g && video.videoWidth > 0) {
        // Downscale for speed; QR codes on a phone screen stay readable.
        const scale = Math.min(1, 640 / video.videoWidth);
        frame.width = Math.round(video.videoWidth * scale);
        frame.height = Math.round(video.videoHeight * scale);
        g.drawImage(video, 0, 0, frame.width, frame.height);
        const img = g.getImageData(0, 0, frame.width, frame.height);
        text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
      }
      if (text && accept(text)) {
        stop();
        onCode(text);
        return;
      }
    } catch {
      // A bad frame; keep scanning.
    }
    setTimeout(() => void tick(), 180);
  };
  void tick();
  return { stop };
}
