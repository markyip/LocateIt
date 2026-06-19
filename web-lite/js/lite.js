/**
 * LocateIt Lite — drop one geotagged photo on the map to see where it was taken.
 * Self-contained (no full-app JS modules).
 */

const CAPTURE_TIME_RE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

const SERVER_READ_EXT = new Set([
  "tif", "tiff", "heic", "heif", "webp", "dng",
  "3fr", "arw", "cr2", "cr3", "erf", "iiq", "nef", "nrw", "orf", "pef",
  "raf", "raw", "rw2", "srw", "x3f", "cap", "fff", "mef", "mos", "rwl", "srf",
]);

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", ...SERVER_READ_EXT]);

const DEFAULT_ZOOM = 15;
const FALLBACK_CENTER = [20, 0];

/** @type {L.Map | null} */
let map = null;
/** @type {L.Marker | null} */
let photoMarker = null;
/** @type {string | null} */
let thumbObjectUrl = null;

const mapEl = document.getElementById("map");
const dropHint = document.getElementById("drop-hint");
const metadataBar = document.getElementById("metadata-bar");
const toastEl = document.getElementById("lite-toast");
const toastMessage = document.getElementById("lite-toast-message");
const toastDismiss = document.getElementById("lite-toast-dismiss");

const metaEls = {
  name: document.getElementById("metadata-name"),
  thumb: document.getElementById("metadata-thumb"),
  capture: document.getElementById("meta-capture"),
  lat: document.getElementById("meta-lat"),
  lon: document.getElementById("meta-lon"),
  iso: document.getElementById("meta-iso"),
  aperture: document.getElementById("meta-aperture"),
  shutter: document.getElementById("meta-shutter"),
};

function fileExt(name) {
  return (name.split(".").pop() || "").toLowerCase();
}

function needsServerMetadataRead(name) {
  const ext = fileExt(name);
  return ext !== "jpg" && ext !== "jpeg" && SERVER_READ_EXT.has(ext);
}

function parseCaptureTimeToMs(value) {
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

function captureTimeToIso(value) {
  const ms = parseCaptureTimeToMs(value);
  return ms > 0 ? new Date(ms).toISOString() : "";
}

function isImageFile(file) {
  if (!file) return false;
  if ((file.type || "").startsWith("image/")) return true;
  return IMAGE_EXT.has(fileExt(file.name));
}

function showToast(message) {
  toastMessage.textContent = message;
  toastEl.classList.remove("hidden");
}

function hideToast() {
  toastEl.classList.add("hidden");
  toastMessage.textContent = "";
}

toastDismiss?.addEventListener("click", hideToast);

function initMap() {
  map = L.map("map", { zoomControl: true }).setView(FALLBACK_CENTER, 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(map);

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        map?.setView([pos.coords.latitude, pos.coords.longitude], 12, { animate: false });
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 }
    );
  }

  mapEl?.addEventListener("dragenter", onDragEnter);
  mapEl?.addEventListener("dragover", onDragOver);
  mapEl?.addEventListener("dragleave", onDragLeave);
  mapEl?.addEventListener("drop", onDrop);
}

/** @type {number} */
let dragDepth = 0;

function onDragEnter(e) {
  e.preventDefault();
  dragDepth += 1;
  mapEl?.classList.add("lite-map-dragover");
}

function onDragOver(e) {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
}

function onDragLeave(e) {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    mapEl?.classList.remove("lite-map-dragover");
  }
}

async function onDrop(e) {
  e.preventDefault();
  dragDepth = 0;
  mapEl?.classList.remove("lite-map-dragover");

  const files = [...(e.dataTransfer?.files || [])].filter(isImageFile);
  if (files.length === 0) {
    showToast("Drop a photo file (JPEG, RAW, HEIC, etc.).");
    return;
  }
  if (files.length > 1) {
    showToast("Please drop one photo at a time.");
    return;
  }

  await loadPhoto(files[0]);
}

function formatCaptureTime(value) {
  const ms = parseCaptureTimeToMs(value);
  if (ms <= 0) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCoord(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(6);
}

function formatAperture(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    const text = `f/${value.toFixed(1)}`;
    return text.endsWith(".0") ? text.slice(0, -2) : text;
  }
  return String(value);
}

function formatShutter(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" && value > 0) {
    if (value >= 1) return `${value}s`;
    return `1/${Math.max(1, Math.round(1 / value))}`;
  }
  return "—";
}

function formatIso(value) {
  if (value == null || value === "") return "—";
  const text = String(value).trim();
  return text ? `ISO ${text}` : "—";
}

function clearPhotoMarker() {
  if (photoMarker) {
    photoMarker.remove();
    photoMarker = null;
  }
}

function setThumbPreview(file) {
  if (thumbObjectUrl) {
    URL.revokeObjectURL(thumbObjectUrl);
    thumbObjectUrl = null;
  }
  if (!needsServerMetadataRead(file.name) && (file.type || "").startsWith("image/")) {
    thumbObjectUrl = URL.createObjectURL(file);
    metaEls.thumb.src = thumbObjectUrl;
    metaEls.thumb.hidden = false;
    return;
  }
  metaEls.thumb.hidden = true;
  metaEls.thumb.removeAttribute("src");
}

async function readMetadataClient(file) {
  if (typeof exifr === "undefined") return null;

  const parsed = await exifr.parse(file, {
    gps: true,
    mergeOutput: true,
    reviveValues: true,
    tiff: true,
    pick: [
      "DateTimeOriginal",
      "CreateDate",
      "ModifyDate",
      "ISO",
      "ISOSpeedRatings",
      "FNumber",
      "ExposureTime",
      "latitude",
      "longitude",
    ],
  });
  if (!parsed) return null;

  let lat = parsed.latitude;
  let lon = parsed.longitude;
  if (lat == null || lon == null) {
    const gps = await exifr.gps(file).catch(() => null);
    lat = gps?.latitude;
    lon = gps?.longitude;
  }
  if (lat == null || lon == null) return null;
  if (Math.abs(lat) <= 0.001 && Math.abs(lon) <= 0.001) return null;

  const captureRaw =
    parsed.DateTimeOriginal || parsed.CreateDate || parsed.ModifyDate || "";
  const iso = parsed.ISO ?? parsed.ISOSpeedRatings;
  return {
    name: file.name,
    lat,
    lon,
    capture_time: captureTimeToIso(captureRaw) || String(captureRaw || ""),
    iso: iso != null ? String(iso) : null,
    aperture: formatAperture(parsed.FNumber),
    shutter_speed: formatShutter(parsed.ExposureTime),
  };
}

async function readMetadataServer(file) {
  const body = new FormData();
  body.append("file", file, file.name);
  let res;
  try {
    res = await fetch("/api/metadata/read", { method: "POST", body });
  } catch {
    throw new Error(
      "Could not reach the LocateIt server. Keep ./run-lite.sh running in Terminal."
    );
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(typeof err.detail === "string" ? err.detail : "Could not read photo metadata.");
  }
  return res.json();
}

async function readMetadata(file) {
  if (needsServerMetadataRead(file.name)) {
    return readMetadataServer(file);
  }
  try {
    const client = await readMetadataClient(file);
    if (client) return client;
  } catch {
    /* fall through to server */
  }
  return readMetadataServer(file);
}

function showPhotoOnMap(meta, file) {
  hideToast();
  dropHint?.classList.add("hidden");
  metadataBar.hidden = false;

  metaEls.name.textContent = meta.name || file.name;
  metaEls.capture.textContent = formatCaptureTime(meta.capture_time);
  metaEls.lat.textContent = formatCoord(meta.lat);
  metaEls.lon.textContent = formatCoord(meta.lon);
  metaEls.iso.textContent = formatIso(meta.iso);
  metaEls.aperture.textContent =
    meta.aperture && !String(meta.aperture).startsWith("f/")
      ? formatAperture(meta.aperture)
      : meta.aperture || "—";
  metaEls.shutter.textContent = meta.shutter_speed || "—";

  setThumbPreview(file);

  clearPhotoMarker();
  const pinIcon = L.divIcon({
    className: "",
    html: '<div class="lite-pin" aria-hidden="true"></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });
  photoMarker = L.marker([meta.lat, meta.lon], { icon: pinIcon }).addTo(map);
  map.setView([meta.lat, meta.lon], DEFAULT_ZOOM, { animate: true });
}

async function loadPhoto(file) {
  let meta;
  try {
    meta = await readMetadata(file);
  } catch (err) {
    showToast(err instanceof Error ? err.message : "Could not read this photo.");
    return;
  }

  if (!meta || meta.lat == null || meta.lon == null) {
    showToast("This photo has no GPS location data. LocateIt Lite only shows geotagged photos.");
    return;
  }

  showPhotoOnMap(meta, file);
}

initMap();
