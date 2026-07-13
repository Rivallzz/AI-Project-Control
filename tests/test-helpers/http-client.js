'use strict';

async function requestJson(baseUrl, pathname, options = {}) {
  const method = options.method || 'GET';
  const headers = new Headers(options.headers || {});
  if (!headers.has('Origin') && method !== 'GET' && method !== 'HEAD') headers.set('Origin', baseUrl);
  if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, method, headers });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { body = text; }
  return { body, headers: response.headers, status: response.status };
}

function postJson(baseUrl, pathname, body, options = {}) {
  return requestJson(baseUrl, pathname, {
    ...options,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function waitFor(probe, { timeout = 5000, interval = 50, description = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

module.exports = { postJson, requestJson, waitFor };
