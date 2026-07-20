const assert = require('node:assert/strict');
const { detectSnapEdge, restoreWindowBounds, snapX } = require('../desktop/window-state');

const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
const defaults = { x: 1538, y: 18, width: 364, height: 744 };

const right = restoreWindowBounds({ ...defaults, snapEdge: 'right' }, displays, defaults);
assert.equal(right.bounds.x, 1568);
assert.equal(right.snapEdge, 'right');

const offscreen = restoreWindowBounds({ x: 9000, y: -2000, width: 364, height: 744 }, displays, defaults);
assert.equal(offscreen.bounds.x, 1840);
assert.equal(offscreen.bounds.y, 0);

assert.equal(snapX('left', displays[0].workArea, 364), -12);
assert.equal(detectSnapEdge({ x: -5, y: 20, width: 364, height: 744 }, displays[0].workArea), 'left');
assert.equal(detectSnapEdge({ x: 700, y: 20, width: 364, height: 744 }, displays[0].workArea), null);

console.log('window state contract ok');
