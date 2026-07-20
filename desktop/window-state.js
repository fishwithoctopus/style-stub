function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function intersectionArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function workAreaForBounds(bounds, displays) {
  const candidates = (displays || []).map(display => display.workArea).filter(Boolean);
  return candidates.sort((a, b) => intersectionArea(bounds, b) - intersectionArea(bounds, a))[0] || { x: 0, y: 0, width: 1920, height: 1080 };
}

function snapX(edge, workArea, width, overhang = 12) {
  if (edge === 'left') return workArea.x - overhang;
  if (edge === 'right') return workArea.x + workArea.width - width + overhang;
  return null;
}

function detectSnapEdge(bounds, workArea, distance = 34, overhang = 12) {
  const leftDistance = Math.abs(bounds.x - snapX('left', workArea, bounds.width, overhang));
  const rightDistance = Math.abs(bounds.x - snapX('right', workArea, bounds.width, overhang));
  if (Math.min(leftDistance, rightDistance) > distance) return null;
  return leftDistance <= rightDistance ? 'left' : 'right';
}

function restoreWindowBounds(saved, displays, defaults, options = {}) {
  const minWidth = options.minWidth || 284;
  const minHeight = options.minHeight || 544;
  const maxWidth = options.maxWidth || 784;
  const maxHeight = options.maxHeight || 1024;
  const minVisible = options.minVisible || 80;
  const overhang = options.overhang || 12;
  const raw = saved && typeof saved === 'object' ? saved : {};
  const bounds = {
    x: Number.isFinite(raw.x) ? raw.x : defaults.x,
    y: Number.isFinite(raw.y) ? raw.y : defaults.y,
    width: clamp(Number(raw.width) || defaults.width, minWidth, maxWidth),
    height: clamp(Number(raw.height) || defaults.height, minHeight, maxHeight)
  };
  const workArea = workAreaForBounds(bounds, displays);
  const snapEdge = ['left', 'right'].includes(raw.snapEdge) ? raw.snapEdge : null;
  bounds.x = snapEdge
    ? snapX(snapEdge, workArea, bounds.width, overhang)
    : clamp(bounds.x, workArea.x - bounds.width + minVisible, workArea.x + workArea.width - minVisible);
  bounds.y = clamp(bounds.y, workArea.y, workArea.y + workArea.height - minVisible);
  return { bounds: Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value)])), snapEdge, workArea };
}

module.exports = { detectSnapEdge, restoreWindowBounds, snapX, workAreaForBounds };
