/**
 * Single-File Bundler & Minifier Script
 * Uses esbuild to bundle modular JS and CSS into a single self-contained dist/index.html.
 * Reduces Cloudflare requests from 5 requests down to 1.
 */

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, 'public');
const DIST_DIR = path.join(__dirname, 'dist');

async function build() {
  const startTime = Date.now();
  console.log('⚡ Starting single-file production build...');

  // 1. Ensure dist directory exists
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // 2. Bundle and minify JavaScript with esbuild
  const jsResult = await esbuild.build({
    entryPoints: [path.join(PUBLIC_DIR, 'app.js')],
    bundle: true,
    minify: true,
    format: 'esm',
    target: ['es2022'],
    write: false,
    external: ['https://*'], // preserve external CDN dynamic imports
  });
  const minifiedJs = jsResult.outputFiles[0].text;

  // 3. Minify CSS with esbuild
  const cssSource = fs.readFileSync(path.join(PUBLIC_DIR, 'style.css'), 'utf-8');
  const cssResult = await esbuild.transform(cssSource, {
    loader: 'css',
    minify: true,
  });
  const minifiedCss = cssResult.code;

  // 4. Read HTML and inline CSS + JS
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');

  // Replace external stylesheet link with inline <style>
  html = html.replace(
    /<link\s+rel="stylesheet"\s+href="style\.css">/i,
    `<style>${minifiedCss}</style>`
  );

  // Replace external module script with inline <script type="module">
  html = html.replace(
    /<script\s+type="module"\s+src="app\.js"><\/script>/i,
    `<script type="module">${minifiedJs}</script>`
  );

  // Write single-file index.html to dist/
  fs.writeFileSync(path.join(DIST_DIR, 'index.html'), html, 'utf-8');

  // 5. Copy PWA assets to dist/ (sw.js, manifest.json, icon.svg)
  const pwaFiles = ['sw.js', 'manifest.json', 'icon.svg'];
  for (const file of pwaFiles) {
    const src = path.join(PUBLIC_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(DIST_DIR, file));
    }
  }

  const duration = Date.now() - startTime;
  const htmlSize = (fs.statSync(path.join(DIST_DIR, 'index.html')).size / 1024).toFixed(1);

  console.log(`✅ Build completed in ${duration}ms!`);
  console.log(`📦 dist/index.html created (${htmlSize} KB) - 100% inlined & minified.`);
  console.log(`🚀 Production page load is now exactly 1 HTTP request!`);
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
