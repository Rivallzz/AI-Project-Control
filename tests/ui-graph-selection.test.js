'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadBrowserModule } = require('./test-helpers/production-hooks');

test('linked graph nodes are collected bidirectionally without duplicates', async () => {
  const hooks = await loadBrowserModule('public/modules/graph-selection.js');
  const links = [
    { source: 'alpha', target: 'beta' },
    { source: 'gamma', target: 'alpha' },
    { source: 'alpha', target: 'beta' },
    { source: 'delta', target: 'epsilon' },
    { source: 'alpha', target: 'alpha' },
  ];
  assert.deepEqual(hooks.linkedGraphNodeIds(links, 'alpha'), ['beta', 'gamma']);
});

test('centering a graph node preserves zoom-independent pan and moves the node to the canvas center', async () => {
  const hooks = await loadBrowserModule('public/modules/graph-selection.js');
  assert.deepEqual(hooks.centeredGraphPan({
    position: { x: 280, y: 120 }, width: 400, height: 300, panX: 30, panY: -10,
  }), { panX: -50, panY: 20 });
});

test('centering keeps the current pan when no usable graph position exists', async () => {
  const hooks = await loadBrowserModule('public/modules/graph-selection.js');
  assert.deepEqual(hooks.centeredGraphPan({ position: null, width: 400, height: 300, panX: 12, panY: 18 }), { panX: 12, panY: 18 });
});
