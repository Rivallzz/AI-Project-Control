export function linkedGraphNodeIds(links, nodeId) {
  if (!Array.isArray(links) || nodeId == null) return [];
  const linkedIds = [];
  const seen = new Set();
  for (const link of links) {
    let linkedId = null;
    if (link?.source === nodeId) linkedId = link.target;
    else if (link?.target === nodeId) linkedId = link.source;
    if (linkedId == null || linkedId === nodeId || seen.has(linkedId)) continue;
    seen.add(linkedId);
    linkedIds.push(linkedId);
  }
  return linkedIds;
}

export function centeredGraphPan({ position, width, height, panX = 0, panY = 0 }) {
  const current = {
    panX: Number.isFinite(panX) ? panX : 0,
    panY: Number.isFinite(panY) ? panY : 0,
  };
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return current;
  return {
    panX: current.panX + width / 2 - position.x,
    panY: current.panY + height / 2 - position.y,
  };
}
