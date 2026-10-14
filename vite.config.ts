import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const DEV_CONNECT = "connect-src 'self' ws: wss:";

/** The dev server needs websockets for hot reload; production pages don't. */
function tightenCsp(): Plugin {
  return {
    name: 'tighten-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes(DEV_CONNECT)) throw new Error('tighten-csp: expected dev connect-src in index.html');
      return html.replace(DEV_CONNECT, "connect-src 'self'");
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), tightenCsp()],
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Some tests simulate minutes of reef life.
    testTimeout: 60000,
  },
});
