import { createHash } from 'node:crypto';
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

/**
 * `vite build --mode single`: emit one self-contained HTML file (JS, CSS and
 * fonts inlined) that runs from a USB stick or file://. The inline module
 * script is allowed by its SHA-256 hash in the CSP rather than 'unsafe-inline'.
 */
function singleFile(): Plugin {
  return {
    name: 'single-file',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const html = Object.values(bundle).find((f) => f.type === 'asset' && f.fileName.endsWith('.html'));
      if (!html || html.type !== 'asset') throw new Error('single-file: no html in bundle');
      let page = String(html.source);
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type === 'chunk' && file.isEntry) {
          // Keep "</script" inside the code from closing the tag early.
          const code = file.code.replace(/<\/script/gi, '<\\/script');
          const tag = new RegExp(`<script type="module"[^>]*src="[^"]*${escapeRe(file.fileName)}"[^>]*></script>`);
          if (!tag.test(page)) throw new Error(`single-file: script tag for ${file.fileName} not found`);
          page = page.replace(tag, () => `<script type="module">${code}</script>`);
          const hash = createHash('sha256').update(code).digest('base64');
          page = page.replace("script-src 'self'", `script-src 'sha256-${hash}'`);
          delete bundle[name];
        } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
          const css = String(file.source).replace(/<\/style/gi, '<\\/style');
          const tag = new RegExp(`<link rel="stylesheet"[^>]*href="[^"]*${escapeRe(file.fileName)}"[^>]*>`);
          if (!tag.test(page)) throw new Error(`single-file: stylesheet link for ${file.fileName} not found`);
          page = page.replace(tag, () => `<style>${css}</style>`);
          delete bundle[name];
        }
      }
      for (const [name, file] of Object.entries(bundle)) {
        if (file !== html) throw new Error(`single-file: unexpected leftover asset ${name}`);
      }
      html.source = page;
      html.fileName = 'down-under-again.html';
    },
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    plugins: [tailwindcss(), tightenCsp(), ...(single ? [singleFile()] : [])],
    base: './',
    build: {
      target: 'es2022',
      assetsInlineLimit: single ? Number.MAX_SAFE_INTEGER : 0,
      cssCodeSplit: !single,
      outDir: single ? 'dist-single' : 'dist',
      modulePreload: single ? false : { polyfill: true },
      ...(single ? { rollupOptions: { output: { inlineDynamicImports: true } } } : {}),
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      // Some tests simulate minutes of reef life.
      testTimeout: 60000,
    },
  };
});
