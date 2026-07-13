'use strict';

const http = require('node:http');

function openSse(url) {
  let buffer = '';
  let response;
  let closed = false;
  const events = [];
  const waiters = [];

  function dispatch(event) {
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(event));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    } else {
      events.push(event);
    }
  }

  function parseFrame(frame) {
    let type = 'message';
    const data = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (data.length) dispatch({ type, data: data.join('\n') });
  }

  const request = http.get(url);
  const ready = new Promise((resolve, reject) => {
    request.once('error', reject);
    request.once('response', (incoming) => {
      response = incoming;
      if (incoming.statusCode !== 200) {
        reject(new Error(`SSE endpoint returned ${incoming.statusCode}.`));
        incoming.resume();
        return;
      }
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk) => {
        buffer += chunk.replace(/\r\n/g, '\n');
        let separator;
        while ((separator = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          parseFrame(frame);
        }
      });
      incoming.once('error', reject);
      resolve();
    });
  });

  function waitForEvent(predicate, timeout = 5000) {
    const index = events.findIndex(predicate);
    if (index >= 0) return Promise.resolve(events.splice(index, 1)[0]);
    if (closed) return Promise.reject(new Error('SSE stream is closed.'));
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const current = waiters.indexOf(waiter);
        if (current >= 0) waiters.splice(current, 1);
        reject(new Error('Timed out waiting for SSE event.'));
      }, timeout);
      waiters.push(waiter);
    });
  }

  function close() {
    closed = true;
    request.destroy();
    response?.destroy();
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('SSE stream was closed.'));
    }
  }

  return { close, ready, waitForEvent };
}

module.exports = { openSse };
