/**
 * Haversine distance and union-find clustering (matches RAWviewer gps_neighbors.py).
 */

export const DEFAULT_CLUSTER_RADIUS_M = 5;

export function haversineM(lat1, lon1, lat2, lon2) {
  const r = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function clusterPoints(points, radiusM = DEFAULT_CLUSTER_RADIUS_M) {
  const pts = [...points];
  const n = pts.length;
  if (!n) return [];

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i, j) => {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (
        haversineM(pts[i].lat, pts[i].lon, pts[j].lat, pts[j].lon) <= radiusM
      ) {
        union(i, j);
      }
    }
  }

  const groups = new Map();
  pts.forEach((pt, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(pt);
  });

  const clusters = [];
  let id = 0;
  for (const members of groups.values()) {
    members.sort((a, b) => {
      const ta = Date.parse(a.captureTime || "") || 0;
      const tb = Date.parse(b.captureTime || "") || 0;
      if (ta !== tb) return ta - tb;
      return (a.name || "").localeCompare(b.name || "");
    });
    const lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
    const lon = members.reduce((s, m) => s + m.lon, 0) / members.length;
    clusters.push({
      id: id++,
      lat,
      lon,
      count: members.length,
      members: members.map((m) => ({ ...m })),
    });
  }
  clusters.sort((a, b) => b.count - a.count || a.id - b.id);
  return clusters;
}
