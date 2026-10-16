/**
 * Cloudflare Worker for Catalog Pictures
 * Serves the Catalog Background Remover & Centering Studio SPA
 * and handles any optional API endpoints.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API Health check
    if (url.pathname === '/api/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          service: 'catalog-pictures-worker',
          timestamp: new Date().toISOString(),
          version: '1.0.0'
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        }
      );
    }

    // Pass request to Cloudflare Static Assets binding
    if (env.ASSETS) {
      let response = await env.ASSETS.fetch(request);

      // Clone response to add beneficial security headers for WASM / Workers and Cache-Control
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
      newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');

      // Caching Headers to reduce Cloudflare requests:
      if (url.pathname === '/sw.js') {
        newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      } else if (url.pathname === '/' || url.pathname.endsWith('.html')) {
        newHeaders.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      } else {
        newHeaders.set('Cache-Control', 'public, max-age=604800, immutable');
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
      });
    }

    // Fallback if assets binding is not yet attached
    return new Response(
      `<!DOCTYPE html><html><body><h1>Catalog Pictures Worker</h1><p>Static assets binding is initializing.</p></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
};
