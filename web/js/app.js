import { clusterPoints, DEFAULT_CLUSTER_RADIUS_M } from "./cluster.js";
import {
  isWithinSubfolderDepth,
  pickAlbumViaPhoto,
  rememberAlbumDirectory,
  restoreDirectoryEntries,
  supportsWritableFiles,
  writeBlobToHandle,
} from "./fs-access.js";
import { closeAlbumPicker } from "./album-picker.js";
import { confirmSaveGeotags } from "./confirm-dialog.js";
import {
  captureTimeToIso,
  parseCaptureTimeToMs,
  readCaptureTimestampMs,
  sortEntriesByCaptureTime,
  sortItemsByCaptureTime,
} from "./photo-sort.js";
import { searchPlaces } from "./geocode.js";
import { renderPendingGallery } from "./gallery.js";
import {
  getGeotagMethod,
  injectGps,
  injectGpsViaServerPath,
  isSaveableFormat,
  needsServerGpsRead,
  probeServerGeotag,
  readGpsViaServer,
  resetServerGeotagProbe,
  resolveGeotagMethod,
} from "./geotag.js";
import { ClusterMap } from "./map.js";
import { openLightbox } from "./lightbox.js";
import { clearSession, loadSessionDirectory, saveSessionDirectory } from "./session.js";

const IMAGE_EXT = new Set([
  "jpg", "jpeg", "png", "tif", "tiff", "heic", "heif", "webp",
  "dng", "raw", "cr2", "cr3", "nef", "arw", "orf", "rw2", "pef", "srw", "raf",
]);

const CLUSTER_RADIUS_M = DEFAULT_CLUSTER_RADIUS_M;

const choosePhotosBtn = document.getElementById("choose-photos-btn");
const restoreSessionBtn = document.getElementById("restore-session-btn");
const restoreSessionHint = document.getElementById("restore-session-hint");
const browserWarn = document.getElementById("browser-warn");
const folderSummary = document.getElementById("folder-summary");
const workspaceHint = document.getElementById("workspace-hint");
const statusEl = document.getElementById("status");
const statsEl = document.getElementById("stats");
const filePicker = document.getElementById("file-picker");
const pendingGallery = document.getElementById("pending-gallery");
const pendingPanel = document.getElementById("pending-panel");
const selectAllBtn = document.getElementById("select-all-btn");
const clearSelectionBtn = document.getElementById("clear-selection-btn");
const saveAllBtn = document.getElementById("save-all-btn");
const mapSearchInput = document.getElementById("map-search-input");
const mapSearchBtn = document.getElementById("map-search-btn");
const mapSearchResults = document.getElementById("map-search-results");

const map = new ClusterMap("map");
const userLocationPromise = getUserLocation();

function getUserLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });
}

async function centerMapOnUserIfIdle() {
  if (workspaceActive) return;
  const loc = await userLocationPromise;
  if (loc) map.setView(loc.lat, loc.lon, 12);
}

/** @type {Array<object>} */
let geotaggedPoints = [];
/** @type {Map<string, object>} */
const pendingItems = new Map();
/** @type {Set<string>} */
const selectedPendingIds = new Set();
let workspaceActive = false;
let photosLoaded = false;
let serverGeotagReady = false;
let desktopMode = false;
let lastScanMeta = { files: 0, writable: false };

function updateSidebarChrome() {
  const hasPending = pendingItems.size > 0;
  const showWorkspace = photosLoaded && hasPending;

  if (folderSummary) folderSummary.hidden = !showWorkspace;
  if (pendingPanel) pendingPanel.hidden = !hasPending;
  document.body.classList.toggle("workspace-mode", showWorkspace);
}

function updateWorkspaceHint() {
  if (!workspaceHint) return;
  const pending = pendingItems.size;
  if (pending > 0) {
    workspaceHint.textContent = `${pending} photo(s) without GPS — click thumbnail to preview, drag to map, then Save.`;
    workspaceHint.className = "workspace-hint";
  } else {
    workspaceHint.textContent = "";
    workspaceHint.className = "workspace-hint";
  }
}

function setStatus(msg, kind = "") {
  if (workspaceActive && pendingItems.size > 0) {
    if (kind === "error" && msg) {
      if (workspaceHint) {
        workspaceHint.textContent = msg;
        workspaceHint.className = "workspace-hint error";
      }
    } else if (kind === "busy" && msg?.startsWith("Saving")) {
      if (workspaceHint) {
        workspaceHint.textContent = msg;
        workspaceHint.className = "workspace-hint busy";
      }
    } else {
      updateWorkspaceHint();
    }
    statusEl.textContent = "";
    statusEl.className = "status";
    return;
  }
  statusEl.textContent = msg;
  statusEl.className = kind ? `status ${kind}` : "status";
}

function setStats(data) {
  if (!data) {
    statsEl.textContent = "";
    return;
  }
  const pending = data.pending_count ?? pendingItems.size;
  const pendingPart = pending ? ` · ${pending} pending` : "";
  statsEl.textContent = `${data.files_scanned} files · ${data.gps_count} GPS · ${data.cluster_count} clusters${pendingPart}`;
}

function isImageName(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return IMAGE_EXT.has(ext);
}

function newPendingId() {
  return crypto.randomUUID?.() || `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function enterWorkspaceMode(meta) {
  workspaceActive = true;
  photosLoaded = true;
  lastScanMeta = meta;
  updateSidebarChrome();
  updateSessionRestoreUi();
  requestAnimationFrame(() => map.invalidateSize());
  updateWorkspaceHint();
}

async function readGpsFromFile(file) {
  try {
    let gps = null;
    if (needsServerGpsRead(file.name)) {
      gps = await readGpsViaServer(file);
    }
    if (!gps) {
      gps = await exifr.gps(file);
    }
    if (!gps || gps.latitude == null || gps.longitude == null) {
      const parsed = await exifr.parse(file, {
        gps: true,
        pick: ["latitude", "longitude", "GPSLatitude", "GPSLongitude"],
      });
      if (parsed?.latitude != null && parsed?.longitude != null) {
        gps = { latitude: parsed.latitude, longitude: parsed.longitude };
      }
    }
    if (!gps || gps.latitude == null || gps.longitude == null) return null;
    if (Math.abs(gps.latitude) <= 0.001 && Math.abs(gps.longitude) <= 0.001) return null;
    let captureTime = "";
    try {
      const ms = await readCaptureTimestampMs(file);
      captureTime = captureTimeToIso(ms);
    } catch {
      /* optional */
    }
    return {
      file,
      name: file.name,
      lat: gps.latitude,
      lon: gps.longitude,
      captureTime: String(captureTime || ""),
    };
  } catch {
    return null;
  }
}

function clearPending() {
  pendingItems.clear();
  selectedPendingIds.clear();
  renderPendingGalleryView();
}

function getDragIds(primaryId) {
  if (selectedPendingIds.has(primaryId) && selectedPendingIds.size > 1) {
    return [...selectedPendingIds];
  }
  return [primaryId];
}

function togglePendingSelection(id, selected) {
  if (selected) selectedPendingIds.add(id);
  else selectedPendingIds.delete(id);
  const tile = pendingGallery?.querySelector(`[data-id="${CSS.escape(id)}"]`);
  tile?.classList.toggle("selected", selected);
}

function selectAllPending() {
  for (const id of pendingItems.keys()) selectedPendingIds.add(id);
  renderPendingGalleryView();
}

function clearPendingSelection() {
  selectedPendingIds.clear();
  renderPendingGalleryView();
}

function itemIsSaveable(item, { writable = lastScanMeta.writable } = {}) {
  if (!writable) return false;
  if (desktopMode && item.path) {
    return resolveGeotagMethod(item.name, serverGeotagReady) != null;
  }
  if (!item.fileHandle) return false;
  return resolveGeotagMethod(item.name, serverGeotagReady) != null;
}

function getPlacedIds() {
  return [...pendingItems.values()]
    .filter((item) => item.lat != null && item.lon != null)
    .map((item) => item.id);
}

function getPlacedSaveableIds() {
  return [...pendingItems.values()]
    .filter((item) => item.lat != null && item.lon != null && itemIsSaveable(item))
    .map((item) => item.id);
}

function updateSaveUi() {
  const placed = getPlacedIds();
  const saveable = getPlacedSaveableIds().length;
  if (saveAllBtn) {
    if (saveable) saveAllBtn.textContent = `Save (${saveable})`;
    else if (placed.length) saveAllBtn.textContent = `Save (${placed.length})`;
    else saveAllBtn.textContent = "Save";
    saveAllBtn.disabled = placed.length === 0;
  }
}

function unpinPending(ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  let changed = 0;
  for (const id of list) {
    const item = pendingItems.get(id);
    if (!item || item.lat == null || item.lon == null) continue;
    item.lat = null;
    item.lon = null;
    changed++;
  }
  if (!changed) return;
  renderPendingGalleryView();
  refreshMapView({ fitBounds: false });
}

function getPlacedPendingPoints() {
  return [...pendingItems.values()]
    .filter((p) => p.lat != null && p.lon != null)
    .map((p) => ({
      file: p.file,
      path: p.path,
      name: p.name,
      lat: p.lat,
      lon: p.lon,
      captureTime: p.captureTime || "",
      pendingId: p.id,
      placed: true,
    }));
}

function getAllClusterPoints() {
  return [...geotaggedPoints, ...getPlacedPendingPoints()];
}

function refreshMapView({ fitBounds = true } = {}) {
  const committed = geotaggedPoints;
  const placements = getPlacedPendingPoints();
  const clusters = clusterPoints(committed, CLUSTER_RADIUS_M);
  map.setThumbnailMode(desktopMode || lastScanMeta.mode === "desktop" ? "server" : "blob");
  map.renderClusters(
    clusters.map((c) => ({
      ...c,
      members: c.members.map((m) => ({ ...m, file: m.file, path: m.path })),
    }))
  );
  map.renderPlacements(placements);

  if (fitBounds) {
    const bounds = [
      ...clusters.map((c) => [c.lat, c.lon]),
      ...placements.map((p) => [p.lat, p.lon]),
    ];
    if (bounds.length) {
      map.fitAllBounds(bounds, []);
    }
  }

  return clusters;
}

function updateStatsFromScan(filesScanned) {
  const clusters = clusterPoints(getAllClusterPoints(), CLUSTER_RADIUS_M);
  setStats({
    files_scanned: filesScanned,
    gps_count: geotaggedPoints.length,
    cluster_count: clusters.length,
    pending_count: pendingItems.size,
  });
  return clusters;
}

async function sortAlbumEntries(entries, statusPrefix = "Sorting") {
  if (entries.length <= 1) return entries;
  setStatus(`${statusPrefix} ${entries.length} photos by capture time…`, "busy");
  return sortEntriesByCaptureTime(entries, {
    oldestFirst: true,
    onProgress: (done, total) => {
      if (done === total || done % 80 === 0) {
        setStatus(`${statusPrefix} ${done}/${total}…`, "busy");
      }
    },
  });
}

async function scanFileEntries(entries, { writable = false, fitBounds = true, dirHandle = null } = {}) {
  clearPending();
  geotaggedPoints = [];
  if (writable) {
    resetServerGeotagProbe();
    serverGeotagReady = await probeServerGeotag({ force: true });
  } else {
    serverGeotagReady = false;
  }

  const sortedEntries = await sortAlbumEntries(entries);
  setStatus(`Reading ${sortedEntries.length} files…`, "busy");

  let done = 0;
  let skippedUnsupported = 0;
  for (const entry of sortedEntries) {
    const file = entry.file ?? entry;
    const fileHandle = entry.fileHandle ?? null;
    const pt = await readGpsFromFile(file);
    if (pt) {
      if (fileHandle) pt.fileHandle = fileHandle;
      geotaggedPoints.push(pt);
    } else if (isImageName(file.name)) {
      const geotagMethod = getGeotagMethod(file.name);
      if (writable && geotagMethod === "server" && !serverGeotagReady) {
        skippedUnsupported++;
      } else if (writable && !geotagMethod) {
        skippedUnsupported++;
      }
      let captureTime = "";
      try {
        const ms = await readCaptureTimestampMs(file);
        captureTime = captureTimeToIso(ms);
      } catch {
        /* optional */
      }
      const id = newPendingId();
      pendingItems.set(id, {
        id,
        file,
        fileHandle: writable ? fileHandle : null,
        name: file.name,
        lat: null,
        lon: null,
        geotagMethod,
        captureTime,
        sortTs: parseCaptureTimeToMs(captureTime),
      });
    }
    done++;
    if (done % 25 === 0 || done === sortedEntries.length) {
      setStatus(`Scanning ${done}/${sortedEntries.length}…`, "busy");
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  refreshMapView({ fitBounds });
  renderPendingGalleryView();
  updateStatsFromScan(sortedEntries.length);
  enterWorkspaceMode({ files: sortedEntries.length, writable });

  if (writable && dirHandle) {
    rememberAlbumDirectory(dirHandle);
    await saveSessionDirectory(dirHandle);
  }

  let msg = "";
  if (pendingItems.size) {
    updateWorkspaceHint();
  } else if (geotaggedPoints.length) {
    msg = `${geotaggedPoints.length} GPS photo(s) on map.`;
  } else {
    msg = "No GPS found in these photos.";
  }
  if (skippedUnsupported) {
    msg += ` (${skippedUnsupported} unsupported for save — map preview only.)`;
  }

  if (!pendingItems.size) {
    setStatus(msg, geotaggedPoints.length ? "ok" : "warn");
  } else {
    updateWorkspaceHint();
  }
}

async function applyAlbumScanData(data) {
  clearPending();
  geotaggedPoints = [];
  resetServerGeotagProbe();
  serverGeotagReady = await probeServerGeotag({ force: true });
  desktopMode = true;
  pendingSessionRestore = null;
  sessionExpiredMessage = null;
  map.setThumbnailMode("server");

  for (const m of data.geotagged || []) {
    geotaggedPoints.push({
      path: m.path,
      name: m.name,
      lat: m.lat,
      lon: m.lon,
      captureTime: m.capture_time || "",
    });
  }

  let skippedUnsupported = 0;
  for (const p of data.pending || []) {
    const geotagMethod = getGeotagMethod(p.name);
    if (geotagMethod === "server" && !serverGeotagReady) {
      skippedUnsupported++;
    } else if (!geotagMethod) {
      skippedUnsupported++;
    }
    const id = newPendingId();
    pendingItems.set(id, {
      id,
      path: p.path,
      file: null,
      fileHandle: null,
      name: p.name,
      lat: null,
      lon: null,
      geotagMethod,
      captureTime: p.capture_time || "",
      sortTs: parseCaptureTimeToMs(p.capture_time),
    });
  }

  refreshMapView({ fitBounds: true });

  renderPendingGalleryView();
  updateStatsFromScan(data.files_scanned || 0);
  enterWorkspaceMode({ files: data.files_scanned || 0, writable: true, mode: "desktop" });

  const folderLabel = (data.folder || "Album").split(/[/\\]/).pop() || "Album";
  let msg = "";
  if (pendingItems.size) {
    updateWorkspaceHint();
    msg = `${folderLabel} — ${pendingItems.size} photo(s) without GPS.`;
  } else if (geotaggedPoints.length) {
    msg = `${geotaggedPoints.length} GPS photo(s) in ${folderLabel}.`;
  } else {
    msg = `No GPS found in ${folderLabel}.`;
  }
  if (skippedUnsupported) {
    msg += ` (${skippedUnsupported} unsupported for save.)`;
  }
  if (!pendingItems.size) setStatus(msg, geotaggedPoints.length ? "ok" : "warn");
}

async function openAlbumDesktop() {
  try {
    closeAlbumPicker(true);
    setStatus("Open any photo from your album…", "busy");
    const res = await fetch("/api/desktop/pick-album", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = String(err.detail || "");
      if (detail.includes("cancelled")) return;
      throw new Error(detail || `Open album failed (${res.status})`);
    }
    await applyAlbumScanData(await res.json());
  } catch (err) {
    console.error(err);
    setStatus(String(err.message || err), "error");
  }
}

async function tryRestoreDesktopAlbum() {
  try {
    const res = await fetch("/api/desktop/last-album");
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.folder) return false;
    setStatus("Restoring last album…", "busy");
    await applyAlbumScanData(data);
    return true;
  } catch (err) {
    console.warn("Desktop album restore failed:", err);
    return false;
  }
}

async function choosePhotos() {
  if (desktopMode) {
    await openAlbumDesktop();
    return;
  }
  if (!supportsWritableFiles()) {
    setStatus("Open any photo from your album. Use Chrome or Edge to save GPS.", "warn");
    filePicker?.click();
    return;
  }
  try {
    closeAlbumPicker(true);
    pendingSessionRestore = null;
    updateSessionRestoreUi();
    setStatus("Open any photo from your album…", "busy");
    const { entries, dirHandle, reusedFolderAccess } = await pickAlbumViaPhoto({
      onNeedFolderAccess: (fileHandle) => {
        setStatus(
          `First time opening this album — confirm folder access for “${fileHandle.name}” (folder should already be selected — click Select Folder).`,
          "busy"
        );
      },
    });
    if (reusedFolderAccess) {
      setStatus(`Using saved access to “${dirHandle.name}”…`, "busy");
    }
    await scanFileEntries(entries, { writable: true, dirHandle });
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    setStatus(String(err.message || err), "error");
  }
}

async function loadFilesReadOnly(files) {
  if (!files.length) {
    setStatus("No image files selected.", "warn");
    return;
  }
  const filtered = files.filter(
    (file) =>
      isImageName(file.name) &&
      isWithinSubfolderDepth(file.webkitRelativePath || file.name)
  );
  if (!filtered.length) {
    setStatus("No images within one subfolder level.", "warn");
    return;
  }
  const entries = filtered.map((file) => ({ file }));
  await scanFileEntries(entries, { writable: false });
}

let sessionExpiredMessage = null;
/** @type {{ dirHandle: FileSystemDirectoryHandle, folderLabel: string } | null} */
let pendingSessionRestore = null;

function updateSessionRestoreUi() {
  if (desktopMode) {
    if (restoreSessionBtn) restoreSessionBtn.hidden = workspaceActive;
    if (restoreSessionHint) {
      restoreSessionHint.textContent = "Reopen your last photo folder";
    }
    return;
  }
  const show = Boolean(pendingSessionRestore && supportsWritableFiles() && !workspaceActive);
  if (restoreSessionBtn) restoreSessionBtn.hidden = !show;
  if (restoreSessionHint && pendingSessionRestore) {
    restoreSessionHint.textContent = `Reconnect to “${pendingSessionRestore.folderLabel}”`;
  }
}

async function clearWorkspace() {
  closeAlbumPicker(true);
  geotaggedPoints = [];
  pendingItems.clear();
  selectedPendingIds.clear();
  photosLoaded = false;
  workspaceActive = false;
  lastScanMeta = { files: 0, writable: false };
  map.clear();
  setStats(null);
  updateSidebarChrome();
  updateSessionRestoreUi();
}

async function resetToFreshStart() {
  await clearSession();
  pendingSessionRestore = null;
  sessionExpiredMessage = null;
  await clearWorkspace();
  updateSessionRestoreUi();
}

async function restoreSavedAlbum({ requestPermission = false } = {}) {
  if (desktopMode) {
    return tryRestoreDesktopAlbum();
  }
  const dirHandle = pendingSessionRestore?.dirHandle || (await loadSessionDirectory());
  if (!dirHandle) {
    pendingSessionRestore = null;
    updateSessionRestoreUi();
    return false;
  }

  try {
    setStatus(`Restoring “${dirHandle.name}”…`, "busy");
    const result = await restoreDirectoryEntries(dirHandle, { requestPermission });
    if (!result.ok) {
      if (result.reason === "missing") {
        sessionExpiredMessage = "Previous album is unavailable — open a photo to begin.";
        pendingSessionRestore = null;
        await clearSession();
        await clearWorkspace();
      } else if (result.reason === "empty") {
        sessionExpiredMessage = `No images found in “${dirHandle.name}”. Select a different folder.`;
        pendingSessionRestore = { dirHandle, folderLabel: dirHandle.name };
        await clearWorkspace();
      } else {
        pendingSessionRestore = { dirHandle, folderLabel: dirHandle.name };
        sessionExpiredMessage = null;
        await clearWorkspace();
        const msg =
          result.reason === "denied"
            ? `Access to “${dirHandle.name}” was denied — click Restore album and allow folder access.`
            : `Click Restore album to reopen “${dirHandle.name}”.`;
        setStatus(msg, "warn");
      }
      updateSessionRestoreUi();
      return false;
    }

    pendingSessionRestore = null;
    sessionExpiredMessage = null;
    updateSessionRestoreUi();
    await scanFileEntries(result.entries, { writable: true, dirHandle });
    return true;
  } catch (err) {
    console.warn("Session restore failed:", err);
    pendingSessionRestore = { dirHandle, folderLabel: dirHandle.name };
    sessionExpiredMessage = null;
    await clearWorkspace();
    updateSessionRestoreUi();
    setStatus(`Could not restore “${dirHandle.name}” — click Restore album to retry.`, "warn");
    return false;
  }
}

async function tryRestoreSession() {
  const dirHandle = await loadSessionDirectory();
  if (!dirHandle) {
    pendingSessionRestore = null;
    updateSessionRestoreUi();
    return false;
  }

  pendingSessionRestore = { dirHandle, folderLabel: dirHandle.name };
  updateSessionRestoreUi();
  return restoreSavedAlbum({ requestPermission: false });
}

function getLightboxThumbnailMode() {
  return desktopMode || lastScanMeta.mode === "desktop" ? "server" : "blob";
}

function pendingItemToLightboxMember(item) {
  return {
    name: item.name,
    file: item.file ?? null,
    path: item.path ?? null,
    lat: item.lat,
    lon: item.lon,
    captureTime: item.captureTime || "",
  };
}

function openPendingPreview(startId) {
  const items = sortItemsByCaptureTime([...pendingItems.values()]);
  if (!items.length) return;
  const members = items.map(pendingItemToLightboxMember);
  const startIndex = Math.max(0, items.findIndex((item) => item.id === startId));
  openLightbox(members, startIndex, { thumbnailMode: getLightboxThumbnailMode() });
}

function renderPendingGalleryView() {
  if (!pendingGallery || !pendingPanel) return;

  const items = sortItemsByCaptureTime([...pendingItems.values()]);
  updateSidebarChrome();

  renderPendingGallery(pendingGallery, {
    items,
    selectedIds: selectedPendingIds,
    onToggleSelect: togglePendingSelection,
    onPreviewItem: openPendingPreview,
    onUnpinItem: (id) => unpinPending([id]),
    getDragIds,
    onPointerDragStart: () => map.beginGalleryPointerDrag(),
    onPointerDragMove: (x, y) => map.updateGalleryPointerDrag(x, y),
    onPointerDragDrop: (x, y, ids) => map.finishGalleryPointerDrag(x, y, ids),
    onPointerDragCancel: () => map.cancelGalleryPointerDrag(),
  });

  updateSaveUi();
  updateWorkspaceHint();
}

function onMapDrop(pendingIds, lat, lon) {
  const ids = Array.isArray(pendingIds) ? pendingIds : [pendingIds];
  let placed = 0;
  for (const pendingId of ids) {
    const item = pendingItems.get(pendingId);
    if (!item) continue;
    item.lat = lat;
    item.lon = lon;
    placed++;
  }
  if (!placed) return;
  renderPendingGalleryView();
  refreshMapView({ fitBounds: false });
}

async function commitPendingGeotag(pendingId) {
  const item = pendingItems.get(pendingId);
  if (!item || item.lat == null || item.lon == null) return false;
  if (!itemIsSaveable(item)) return false;

  if (desktopMode && item.path) {
    try {
      const verified = await injectGpsViaServerPath(item.path, item.lat, item.lon);
      geotaggedPoints.push({
        path: item.path,
        name: item.name,
        lat: verified.lat,
        lon: verified.lon,
        captureTime: item.captureTime || "",
      });
      pendingItems.delete(pendingId);
      selectedPendingIds.delete(pendingId);
      return true;
    } catch (err) {
      throw err;
    }
  }

  if (!item.fileHandle) return false;

  const method = resolveGeotagMethod(item.name, serverGeotagReady);
  if (!method) return false;

  const file = await item.fileHandle.getFile();
  let blob;
  try {
    blob = await injectGps(file, item.lat, item.lon, method);
  } catch (err) {
    if (method === "server" && getGeotagMethod(item.name) === "client") {
      blob = await injectGps(file, item.lat, item.lon, "client");
    } else {
      throw err;
    }
  }
  await writeBlobToHandle(item.fileHandle, blob);

  const updatedFile = await item.fileHandle.getFile();
  let verified = await readGpsFromFile(updatedFile);
  if (!verified && (method === "server" || needsServerGpsRead(item.name))) {
    await probeServerGeotag({ force: true });
    verified = await readGpsFromFile(updatedFile);
  }
  if (!verified) {
    throw new Error(
      `Could not verify GPS in ${item.name} after save. If using RAW, ensure run.bat stays open and retry.`
    );
  }
  if (
    Math.abs(verified.lat - item.lat) > 0.02 ||
    Math.abs(verified.lon - item.lon) > 0.02
  ) {
    throw new Error(
      `GPS verify mismatch on ${item.name} (expected ${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}).`
    );
  }

  geotaggedPoints.push({
    file: updatedFile,
    fileHandle: item.fileHandle,
    name: item.name,
    lat: verified.lat,
    lon: verified.lon,
    captureTime: item.captureTime || "",
  });
  pendingItems.delete(pendingId);
  selectedPendingIds.delete(pendingId);
  return true;
}

function explainWhyNotSaveable(placed) {
  if (!placed.length) return "Drag photos to the map before saving.";
  if (!lastScanMeta.writable) {
    return "No write access — open an album in Chrome/Edge (not drag-drop).";
  }
  const noHandle = placed.filter((p) => !p.fileHandle);
  if (noHandle.length === placed.length) {
    return "Files were opened read-only. Pick a photo from your album again.";
  }
  if (!serverGeotagReady && placed.every((p) => getGeotagMethod(p.name) === "server")) {
    return "RAW save needs the server — keep run.bat open and refresh the page.";
  }
  const badFmt = placed.filter((p) => !isSaveableFormat(p.name));
  if (badFmt.length) {
    return `Cannot save ${badFmt[0].name} — PNG preview only. Use JPEG or RAW.`;
  }
  return "Photos are placed but not ready to save. Refresh and re-open your photos.";
}

async function saveAllGeotags() {
  if (saveAllBtn?.classList.contains("is-saving")) return;

  resetServerGeotagProbe();
  serverGeotagReady = await probeServerGeotag({ force: true });
  updateSaveUi();

  const placedItems = [...pendingItems.values()].filter((p) => p.lat != null && p.lon != null);
  let ids = getPlacedSaveableIds();

  if (!ids.length) {
    const msg = explainWhyNotSaveable(placedItems);
    setStatus(msg, placedItems.length ? "error" : "warn");
    return;
  }

  const confirmed = await confirmSaveGeotags(ids.length);
  if (!confirmed) return;

  saveAllBtn?.classList.add("is-saving");
  setStatus(`Saving ${ids.length} file(s)…`, "busy");
  let saved = 0;
  const failed = [];
  try {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const item = pendingItems.get(id);
      const progress = `Saving ${i + 1}/${ids.length}: ${item?.name || id}…`;
      setStatus(progress, "busy");
      try {
        if (await commitPendingGeotag(id)) saved++;
        else failed.push(`${item?.name || id}: skipped (not writable)`);
      } catch (err) {
        failed.push(`${item?.name || id}: ${err.message || err}`);
      }
    }
    renderPendingGalleryView();
    refreshMapView({ fitBounds: false });
    updateStatsFromScan(geotaggedPoints.length + pendingItems.size);
    if (failed.length) {
      setStatus(`Saved ${saved}/${ids.length}. ${failed[0]}`, "error");
    } else {
      updateWorkspaceHint();
    }
  } catch (err) {
    console.error(err);
    renderPendingGalleryView();
    refreshMapView({ fitBounds: false });
    setStatus(`Saved ${saved}/${ids.length}. Error: ${err.message || err}`, "error");
  } finally {
    saveAllBtn?.classList.remove("is-saving");
  }
}

function hideSearchResults() {
  mapSearchResults.classList.add("hidden");
  mapSearchResults.innerHTML = "";
}

function showSearchResults(places) {
  mapSearchResults.innerHTML = "";
  if (!places.length) {
    mapSearchResults.classList.add("hidden");
    return;
  }
  for (const place of places) {
    const li = document.createElement("li");
    li.role = "option";
    li.textContent = place.label;
    li.addEventListener("click", () => {
      hideSearchResults();
      mapSearchInput.value = place.label.split(",")[0];
      map.flyToLocation(place.lat, place.lon, { label: place.label });
      setStatus(`Map centered on ${place.label.split(",")[0]}.`, "ok");
    });
    mapSearchResults.appendChild(li);
  }
  mapSearchResults.classList.remove("hidden");
}

async function runMapSearch() {
  const query = mapSearchInput.value.trim();
  if (!query) {
    setStatus("Enter a place name to search.", "warn");
    return;
  }

  mapSearchBtn.disabled = true;
  setStatus("Searching…", "busy");
  hideSearchResults();

  try {
    const places = await searchPlaces(query, 5);
    if (!places.length) {
      setStatus(`No results for "${query}".`, "warn");
      return;
    }
    if (places.length === 1) {
      map.flyToLocation(places[0].lat, places[0].lon, { label: places[0].label });
      setStatus(`Map centered on ${places[0].label.split(",")[0]}.`, "ok");
      return;
    }
    showSearchResults(places);
    map.flyToLocation(places[0].lat, places[0].lon, { label: places[0].label, zoom: 12 });
    setStatus(`${places.length} results — pick one from the list.`, "ok");
  } catch (err) {
    console.error(err);
    setStatus(String(err.message || err), "error");
  } finally {
    mapSearchBtn.disabled = false;
  }
}

map.setMapDropHandler(onMapDrop);
map.setPlacementHandlers({
  onMove(pendingId, lat, lon) {
    const item = pendingItems.get(pendingId);
    if (!item) return;
    item.lat = lat;
    item.lon = lon;
    renderPendingGalleryView();
  },
  onUnpin(pendingId) {
    unpinPending([pendingId]);
  },
  onClick(pt) {
    if (pt.pendingId) openPendingPreview(pt.pendingId);
  },
});

choosePhotosBtn?.addEventListener("click", () => choosePhotos());
restoreSessionBtn?.addEventListener("click", () => restoreSavedAlbum({ requestPermission: true }));
selectAllBtn?.addEventListener("click", selectAllPending);
clearSelectionBtn?.addEventListener("click", clearPendingSelection);
saveAllBtn?.addEventListener("click", saveAllGeotags);

filePicker?.addEventListener("change", async () => {
  const files = [...filePicker.files];
  await loadFilesReadOnly(files);
  filePicker.value = "";
});

mapSearchBtn.addEventListener("click", runMapSearch);
mapSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    runMapSearch();
  }
  if (e.key === "Escape") hideSearchResults();
});

document.addEventListener("click", (e) => {
  if (
    mapSearchResults &&
    !mapSearchResults.contains(e.target) &&
    e.target !== mapSearchInput
  ) {
    hideSearchResults();
  }
});

const params = new URLSearchParams(window.location.search);
const urlPaths = params.get("paths");
const urlDesktop = params.get("desktop") === "1";
if (urlDesktop) desktopMode = true;

if (browserWarn && !supportsWritableFiles() && !desktopMode) {
  browserWarn.hidden = false;
}

let sessionRestorePromise = Promise.resolve(false);

if (urlPaths) {
  fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folders: urlPaths.split("|").map((p) => decodeURIComponent(p.trim())).filter(Boolean),
      max_subfolder_depth: 1,
      cluster_radius_m: CLUSTER_RADIUS_M,
    }),
  })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Scan failed"))))
    .then((data) => {
      map.setThumbnailMode("server");
      map.renderClusters(data.clusters);
      const bounds = data.clusters.map((c) => [c.lat, c.lon]);
      if (bounds.length) map.fitAllBounds(bounds, []);
      setStats(data);
      enterWorkspaceMode({ files: data.files_scanned, writable: false });
      setStatus(`${data.gps_count} GPS photo(s) on map (server scan — select a folder to geotag & save).`, "ok");
    })
    .catch(() => {});
}

fetch("/api/health")
  .then((r) => {
    if (!r.ok) throw new Error("Server error");
    return r.json();
  })
  .then(async (data) => {
    desktopMode = Boolean(data.desktop || urlDesktop);
    serverGeotagReady = Boolean(data.geotag);
    resetServerGeotagProbe();
    map.invalidateSize();

    if (browserWarn) {
      browserWarn.hidden = desktopMode || supportsWritableFiles();
    }

    if (!urlPaths) {
      if (desktopMode) {
        sessionRestorePromise = tryRestoreDesktopAlbum().then(async (restored) => {
          if (!restored) await centerMapOnUserIfIdle();
          return restored;
        });
      } else {
        sessionRestorePromise = tryRestoreSession().then(async (restored) => {
          if (!restored) await centerMapOnUserIfIdle();
          return restored;
        });
      }
    }

    await sessionRestorePromise;
    if (!workspaceActive) {
      const rawHint = serverGeotagReady ? " JPEG & RAW save enabled." : "";
      if (desktopMode) {
        setStatus(
          `Click Open album — pick any photo; the whole folder loads (native dialog, no browser folder picker).${rawHint}`,
          ""
        );
      } else if (pendingSessionRestore) {
        setStatus(
          `Click Restore album to reopen “${pendingSessionRestore.folderLabel}”, or select a different folder.${rawHint}`,
          "warn"
        );
      } else {
        const msg =
          sessionExpiredMessage ||
          `Open any photo from your album to begin. Drag photos to the map, then Save.${rawHint}`;
        setStatus(msg, sessionExpiredMessage ? "warn" : "");
      }
    }
  })
  .catch(async () => {
    await sessionRestorePromise;
    if (!workspaceActive) {
      setStatus(
        desktopMode || urlDesktop
          ? "Start run-desktop.bat — desktop mode needs the local server."
          : "Start run.bat and open http://127.0.0.1:8765 — map search needs the local server.",
        "error"
      );
    }
  });

updateSidebarChrome();
