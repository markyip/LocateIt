/**
 * Place search via local server proxy (Nominatim User-Agent policy).
 */

export async function searchPlaces(query, limit = 5) {
  const q = query.trim();
  if (!q) return [];

  const url = `/api/geocode?q=${encodeURIComponent(q)}&limit=${limit}`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(
      "Cannot reach the local server. Run run.bat and open http://127.0.0.1:8765 (do not open index.html directly)."
    );
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.detail;
    const msg = typeof detail === "string" ? detail : `Search failed (${res.status})`;
    throw new Error(msg);
  }
  return res.json();
}
