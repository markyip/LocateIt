/**
 * Capture-time sorting (RAWviewer-style: EXIF DateTimeOriginal, oldest first).
 */

const CAPTURE_TIME_RE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export function parseCaptureTimeToMs(value) {
  if (!value) return 0;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  const s = String(value).trim();
  if (!s) return 0;

  const exifMatch = CAPTURE_TIME_RE.exec(s);
  if (exifMatch) {
    const d = new Date(
      Number(exifMatch[1]),
      Number(exifMatch[2]) - 1,
      Number(exifMatch[3]),
      Number(exifMatch[4]),
      Number(exifMatch[5]),
      Number(exifMatch[6])
    );
    const t = d.getTime();
    return Number.isFinite(t) ? t : 0;
  }

  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function captureTimeToIso(value) {
  const ms = parseCaptureTimeToMs(value);
  return ms > 0 ? new Date(ms).toISOString() : "";
}

/**
 * @param {File | Blob} file
 * @returns {Promise<number>}
 */
export async function readCaptureTimestampMs(file) {
  if (!file) return 0;
  try {
    const exif = await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate", "ModifyDate"],
    });
    for (const key of ["DateTimeOriginal", "CreateDate", "ModifyDate"]) {
      const ms = parseCaptureTimeToMs(exif?.[key]);
      if (ms > 0) return ms;
    }
  } catch {
    /* optional */
  }
  return file.lastModified || 0;
}

function entrySortName(entry) {
  const file = entry?.file ?? entry;
  return String(file?.name || entry?.name || entry?.relativePath || "").toLowerCase();
}

/**
 * Sort album entries oldest-first (RAWviewer default).
 * @param {Array<object>} entries
 * @param {{ oldestFirst?: boolean, onProgress?: (done: number, total: number) => void }} [opts]
 */
export async function sortEntriesByCaptureTime(entries, opts = {}) {
  const { oldestFirst = true, onProgress } = opts;
  if (!entries.length) return [];

  const probed = new Array(entries.length);
  const batchSize = 40;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const chunk = await Promise.all(
      batch.map(async (entry, j) => {
        const file = entry.file ?? entry;
        const ts = await readCaptureTimestampMs(file);
        return {
          idx: i + j,
          entry,
          ts,
          name: entrySortName(entry),
        };
      })
    );
    for (const row of chunk) probed[row.idx] = row;
    onProgress?.(Math.min(i + batch.length, entries.length), entries.length);
  }

  probed.sort((a, b) => {
    if (a.ts !== b.ts) return oldestFirst ? a.ts - b.ts : b.ts - a.ts;
    return a.name.localeCompare(b.name);
  });

  return probed.map((row) => row.entry);
}

/**
 * @param {Array<object>} items
 */
export function sortItemsByCaptureTime(items, { oldestFirst = true } = {}) {
  return [...items].sort((a, b) => {
    const ta = parseCaptureTimeToMs(a.captureTime) || a.sortTs || 0;
    const tb = parseCaptureTimeToMs(b.captureTime) || b.sortTs || 0;
    if (ta !== tb) return oldestFirst ? ta - tb : tb - ta;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}
