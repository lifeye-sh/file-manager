'use strict';

(() => {
  const nativeFetch = window.fetch.bind(window);
  // Cached CSRF token promise. Reset on any failure so a transient error
  // (session boot race, sidecar still starting, network blip) does not poison
  // every subsequent mutation for the lifetime of the page.
  let csrfPromise = null;

  function fetchCsrfToken() {
    return nativeFetch('/api/csrf-token', { credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error('Unable to initialize CSRF token');
        return response.json();
      })
      .then(data => data.token);
  }

  function csrfToken() {
    if (!csrfPromise) {
      // Drop the cache if this attempt rejects, so the next call retries.
      csrfPromise = fetchCsrfToken().catch(err => { csrfPromise = null; throw err; });
    }
    return csrfPromise;
  }

  function refreshCsrfToken() {
    csrfPromise = null;
    return csrfToken();
  }

  window.fetch = async function securedCanvasFetch(input, init = {}) {
    const requestUrl = typeof input === 'string' ? input : (input && input.url);
    const url = requestUrl ? new URL(requestUrl, window.location.href) : null;
    const method = String(init.method || (typeof input !== 'string' && input && input.method) || 'GET').toUpperCase();
    const options = { ...init, credentials: 'same-origin' };
    const sameOrigin = Boolean(url) && url.origin === window.location.origin;
    const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (sameOrigin && isMutation) {
      const headers = new Headers(init.headers || (typeof input !== 'string' && input && input.headers) || undefined);
      headers.set('X-CSRF-Token', await csrfToken());
      options.headers = headers;
    }
    const response = await nativeFetch(input, options);
    // CSRF cookie expired or token mismatch: refresh once and retry,
    // guarded so a persistent 403 cannot loop forever.
    if (sameOrigin && isMutation && response.status === 403 && !init.__csrfRetried) {
      await refreshCsrfToken();
      return securedCanvasFetch(input, { ...init, __csrfRetried: true });
    }
    return response;
  };
  window.FILE_MANAGER_CANVAS = Object.freeze({
    gatewayPrefix: '/api/ai/canvas/upstream',
    legacyWorkbench: '/ai-workbench-legacy.html',
  });
})();
