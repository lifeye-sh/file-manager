'use strict';

(() => {
  const nativeFetch = window.fetch.bind(window);
  let csrfPromise;
  function csrfToken() {
    if (!csrfPromise) {
      csrfPromise = nativeFetch('/api/csrf-token', { credentials: 'same-origin' })
        .then(response => {
          if (!response.ok) throw new Error('Unable to initialize CSRF token');
          return response.json();
        })
        .then(data => data.token);
    }
    return csrfPromise;
  }
  window.fetch = async function securedCanvasFetch(input, init = {}) {
    const requestUrl = typeof input === 'string' ? input : input.url;
    const url = new URL(requestUrl, window.location.href);
    const method = String(init.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    const options = { ...init, credentials: 'same-origin' };
    if (url.origin === window.location.origin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
      headers.set('X-CSRF-Token', await csrfToken());
      options.headers = headers;
    }
    return nativeFetch(input, options);
  };
  window.FILE_MANAGER_CANVAS = Object.freeze({
    gatewayPrefix: '/api/ai/canvas/upstream',
    legacyWorkbench: '/ai-workbench-legacy.html',
  });
})();
