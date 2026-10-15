/**
 * Renders every song offline in a real browser (through the game's own synth
 * graph), writes 16-bit WAV previews and prints peak/RMS levels.
 * Usage: start `npm run dev -- --port 5181`, then `npm run music`.
 * Output: MUSIC_DIR (default /tmp/down-under-music).
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const URL = process.env.MUSIC_URL ?? 'http://localhost:5181/';
const OUT = process.env.MUSIC_DIR ?? '/tmp/down-under-music';
mkdirSync(OUT, { recursive: true });

function wav(left, right, rate) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767))), 46 + i * 4);
  }
  return buf;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(URL);
const ids = await page.evaluate(async () => (await import('/src/audio/songs.ts')).SONG_IDS);
let failed = false;
for (const id of ids) {
  const r = await page.evaluate(async (sid) => {
    const { AudioEngine } = await import('/src/audio/engine.ts');
    const { SONGS } = await import('/src/audio/songs.ts');
    const b = await AudioEngine.renderOffline(SONGS[sid], 1);
    const L = b.getChannelData(0);
    const R = b.getChannelData(1);
    let peak = 0, sum = 0, clip = 0;
    for (let i = 0; i < L.length; i++) {
      const a = Math.abs(L[i]);
      peak = Math.max(peak, a);
      sum += L[i] * L[i];
      if (a >= 0.99) clip++;
    }
    return { rate: b.sampleRate, seconds: b.duration, peak, rms: Math.sqrt(sum / L.length), clip, L: Array.from(L), R: Array.from(R) };
  }, id);
  writeFileSync(`${OUT}/${id}.wav`, wav(r.L, r.R, r.rate));
  const db = (x) => (20 * Math.log10(Math.max(1e-9, x))).toFixed(1);
  const ok = r.clip === 0 && r.peak > 0.05;
  if (!ok) failed = true;
  console.log(`${id.padEnd(11)} ${r.seconds.toFixed(1).padStart(5)}s  peak ${db(r.peak).padStart(6)} dBFS  rms ${db(r.rms).padStart(6)} dBFS  clipped ${r.clip}${ok ? '' : '  <-- CHECK'}`);
}
await browser.close();
console.log(`WAV previews in ${OUT}/`);
if (failed) process.exit(1);
