'use strict';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function assertLoopbackHost(host) {
  if (!LOOPBACK_HOSTS.has(host)) throw new Error('AI Project Control may only bind to a loopback host.');
}

function createRequestBoundary(host, port) {
  assertLoopbackHost(host);
  const allowedHosts = new Set([`${host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  return function assertRequestBoundary(request) {
    const requestHost = String(request.headers.host || '');
    const origin = String(request.headers.origin || '');
    const originAllowed = !origin || origin === `http://${requestHost}`
      || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
    if (!allowedHosts.has(requestHost) || !originAllowed) {
      const error = new Error('Request origin is not allowed.');
      error.statusCode = 403;
      throw error;
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        const error = new Error('Mutating requests require application/json.');
        error.statusCode = 415;
        throw error;
      }
    }
  };
}

module.exports = { LOOPBACK_HOSTS, assertLoopbackHost, createRequestBoundary };
