/**
 * GPS EXIF write — client (JPEG/piexif) or server (PyExiv2 for RAW etc.).
 */

const JPEG_EXT = new Set(["jpg", "jpeg"]);
const JPEG_TYPES = new Set(["image/jpeg", "image/jpg"]);

/** Formats written via POST /api/geotag (includes JPEG fallback). */
const SERVER_GEOTAG_EXT = new Set([
  "jpg", "jpeg", "tif", "tiff", "heic", "heif", "webp", "dng",
  "3fr", "arw", "cr2", "cr3", "erf", "iiq", "nef", "nrw", "orf", "pef",
  "raf", "raw", "rw2", "srw", "x3f", "cap", "fff", "mef", "mos", "rwl", "srf",
]);

let serverGeotagAvailable = null;

function fileExt(name) {
  return (name.split(".").pop() || "").toLowerCase();
}

export function isWritableJpeg(file) {
  const ext = fileExt(file.name);
  if (JPEG_EXT.has(ext)) return true;
  return JPEG_TYPES.has((file.type || "").toLowerCase());
}

/** @returns {"client" | "server" | null} */
export function getGeotagMethod(name) {
  const ext = fileExt(name);
  if (JPEG_EXT.has(ext)) return "client";
  if (SERVER_GEOTAG_EXT.has(ext)) return "server";
  return null;
}

export function isSaveableFormat(name) {
  return getGeotagMethod(name) != null;
}

export function needsServerGpsRead(name) {
  const ext = fileExt(name);
  if (JPEG_EXT.has(ext)) return false;
  return SERVER_GEOTAG_EXT.has(ext);
}

export function resetServerGeotagProbe() {
  serverGeotagAvailable = null;
}

export async function probeServerGeotag({ force = false } = {}) {
  if (!force && serverGeotagAvailable != null) return serverGeotagAvailable;
  try {
    const res = await fetch("/api/health");
    if (!res.ok) {
      serverGeotagAvailable = false;
      return false;
    }
    const data = await res.json();
    serverGeotagAvailable = Boolean(data.geotag);
  } catch {
    serverGeotagAvailable = false;
  }
  return serverGeotagAvailable;
}

/** Prefer server (PyExiv2) when available — works for JPEG and RAW. */
export function resolveGeotagMethod(name, serverReady) {
  if (!isSaveableFormat(name)) return null;
  if (serverReady) return "server";
  const base = getGeotagMethod(name);
  if (base === "client") return "client";
  return null;
}

export async function injectGpsViaServer(file, lat, lon) {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("lat", String(lat));
  form.append("lon", String(lon));

  let res;
  try {
    res = await fetch("/api/geotag", { method: "POST", body: form });
  } catch {
    throw new Error("Cannot reach geotag API — start run.bat and open http://127.0.0.1:8765");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.detail;
    throw new Error(typeof detail === "string" ? detail : `Geotag failed (${res.status})`);
  }
  const blob = await res.blob();
  if (!blob.size) {
    throw new Error(`Server returned empty file for ${file.name}`);
  }
  return blob;
}

export async function injectGpsViaServerPath(filePath, lat, lon) {
  let res;
  try {
    res = await fetch("/api/geotag/path", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, lat, lon }),
    });
  } catch {
    throw new Error("Cannot reach geotag API — keep LocateIt running.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = err.detail;
    throw new Error(typeof detail === "string" ? detail : `Geotag failed (${res.status})`);
  }
  return res.json();
}

export async function readGpsViaServer(file) {
  const form = new FormData();
  form.append("file", file, file.name);

  try {
    const res = await fetch("/api/gps/read", { method: "POST", body: form });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.lat == null || data.lon == null) return null;
    return { latitude: data.lat, longitude: data.lon };
  } catch {
    return null;
  }
}

/* --- JPEG client fallback (piexif) --- */

function decToDmsRational(decimal) {
  const abs = Math.abs(decimal);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 100) / 100;
  return [
    [deg, 1],
    [min, 1],
    [Math.round(sec * 100), 100],
  ];
}

function arrayBufferToBinaryString(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function binaryStringToBlob(binStr, mime = "image/jpeg") {
  const arr = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    arr[i] = binStr.charCodeAt(i);
  }
  return new Blob([arr], { type: mime });
}

function loadOrCreateExif(jpegBinary) {
  try {
    return piexif.load(jpegBinary);
  } catch {
    return { "0th": {}, Exif: {}, GPS: {}, "1st": {}, thumbnail: null };
  }
}

export async function injectGpsIntoJpeg(file, lat, lon) {
  if (!isWritableJpeg(file)) {
    throw new Error("Only JPEG files can be geotagged in the browser.");
  }
  if (typeof piexif === "undefined") {
    throw new Error("piexif library not loaded.");
  }

  const buffer = await file.arrayBuffer();
  const binary = arrayBufferToBinaryString(buffer);
  const exifObj = loadOrCreateExif(binary);

  exifObj.GPS = exifObj.GPS || {};
  exifObj.GPS[piexif.GPSIFD.GPSVersionID] = [2, 2, 0, 0];
  exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? "N" : "S";
  exifObj.GPS[piexif.GPSIFD.GPSLatitude] = decToDmsRational(lat);
  exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = lon >= 0 ? "E" : "W";
  exifObj.GPS[piexif.GPSIFD.GPSLongitude] = decToDmsRational(lon);

  const exifBytes = piexif.dump(exifObj);
  let updated;
  try {
    updated = piexif.insert(exifBytes, binary);
  } catch (err) {
    throw new Error(`Could not write EXIF to ${file.name}: ${err.message || err}`);
  }
  return binaryStringToBlob(updated, file.type || "image/jpeg");
}

/**
 * Write GPS using the best available method for this file.
 * @returns {Promise<Blob>}
 */
export async function injectGps(file, lat, lon, method) {
  if (method === "server") {
    return injectGpsViaServer(file, lat, lon);
  }
  if (method === "client") {
    return injectGpsIntoJpeg(file, lat, lon);
  }
  throw new Error(`Cannot save GPS for ${file.name}`);
}
