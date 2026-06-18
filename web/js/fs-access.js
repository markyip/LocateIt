/**
 * File System Access API — pick folder, list images, write GPS back to files.
 */

import { loadSessionDirectory } from "./session.js";

const IMAGE_EXT = new Set([
  "jpg", "jpeg", "png", "tif", "tiff", "heic", "heif", "webp",
  "dng", "raw", "cr2", "cr3", "nef", "arw", "orf", "rw2", "pef", "srw", "raf",
]);

function isImageName(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return IMAGE_EXT.has(ext);
}

export function supportsWritableFiles() {
  return typeof window.showOpenFilePicker === "function";
}

const PHOTO_PICKER_TYPES = [
  {
    description: "Photos",
    accept: {
      "image/*": [
        ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".heif", ".webp",
        ".dng", ".raw", ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".pef", ".srw", ".raf",
      ],
    },
  },
];

/** Root album folder plus this many subfolder levels (0 = root files only). */
export const MAX_SUBFOLDER_DEPTH = 1;

async function walkDirectory(dirHandle, prefix, depth, out) {
  for await (const [name, handle] of dirHandle.entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      if (isImageName(name)) {
        const file = await handle.getFile();
        out.push({ file, fileHandle: handle, relativePath: rel });
      }
    } else if (handle.kind === "directory" && depth < MAX_SUBFOLDER_DEPTH) {
      await walkDirectory(handle, rel, depth + 1, out);
    }
  }
}

/** @param {string} relativePath */
export function isWithinSubfolderDepth(relativePath) {
  const parts = String(relativePath || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  const dirDepth = Math.max(0, parts.length - 1);
  return dirDepth <= MAX_SUBFOLDER_DEPTH;
}

/** @type {FileSystemDirectoryHandle | null} */
let rememberedAlbumDirHandle = null;

export function rememberAlbumDirectory(dirHandle) {
  if (dirHandle?.kind === "directory") {
    rememberedAlbumDirHandle = dirHandle;
  }
}

export function clearRememberedAlbumDirectory() {
  rememberedAlbumDirHandle = null;
}

/**
 * Browsers often return null from getParent() for showOpenFilePicker handles (by design).
 * Match the picked file against a directory we already have access to via resolve().
 * @param {FileSystemFileHandle} fileHandle
 * @returns {Promise<FileSystemDirectoryHandle | null>}
 */
async function resolveAlbumDirectoryFromFile(fileHandle) {
  try {
    const getParent = fileHandle.getParent ?? FileSystemHandle.prototype.getParent;
    if (typeof getParent === "function") {
      const parent = await getParent.call(fileHandle);
      if (parent?.kind === "directory") {
        return parent;
      }
    }
  } catch (err) {
    console.warn("getParent unavailable:", err);
  }

  const candidates = [];
  if (rememberedAlbumDirHandle) candidates.push(rememberedAlbumDirHandle);
  try {
    const fromSession = await loadSessionDirectory();
    if (fromSession) candidates.push(fromSession);
  } catch {
    /* optional */
  }

  const seen = new Set();
  for (const dirHandle of candidates) {
    if (!dirHandle || dirHandle.kind !== "directory" || seen.has(dirHandle)) continue;
    seen.add(dirHandle);

    try {
      const rel = await dirHandle.resolve(fileHandle);
      if (rel !== null) {
        return dirHandle;
      }
    } catch (err) {
      console.warn("resolve() against saved folder failed:", err);
    }
  }

  return null;
}

/**
 * RAWviewer-style album import (open_file, no fast-open):
 *   showOpenFilePicker → user picks one photo → resolve album folder → walkDirectory
 *
 * getParent() usually does not work after showOpenFilePicker in Chrome/Edge.
 * We reuse a saved folder handle when resolve() matches; otherwise one folder confirm
 * (pre-navigated via startIn) is required the first time a new album is opened.
 *
 * @param {{ onNeedFolderAccess?: (fileHandle: FileSystemFileHandle) => void | Promise<void> }} [opts]
 * @returns {Promise<{ entries: Array<object>, dirHandle: FileSystemDirectoryHandle, reusedFolderAccess: boolean }>}
 */
export async function pickAlbumViaPhoto(opts = {}) {
  const { onNeedFolderAccess } = opts;
  const [fileHandle] = await window.showOpenFilePicker({
    types: PHOTO_PICKER_TYPES,
    multiple: false,
    id: "locate-it-photo",
  });

  if (!isImageName(fileHandle.name)) {
    throw new Error("Please choose a photo file.");
  }

  let dirHandle = await resolveAlbumDirectoryFromFile(fileHandle);
  let reusedFolderAccess = Boolean(dirHandle);

  if (!dirHandle) {
    if (typeof window.showDirectoryPicker !== "function") {
      throw new Error("Your browser cannot access the photo folder. Try Chrome or Edge.");
    }
    if (onNeedFolderAccess) {
      await onNeedFolderAccess(fileHandle);
    }
    dirHandle = await window.showDirectoryPicker({
      mode: "readwrite",
      startIn: fileHandle,
      id: "locate-it-folder",
    });
    reusedFolderAccess = false;
  }

  await ensureWritePermission(dirHandle);
  rememberAlbumDirectory(dirHandle);

  const entries = [];
  await walkDirectory(dirHandle, "", 0, entries);
  if (!entries.length) {
    throw new Error("No images in that folder.");
  }
  return { entries, dirHandle, reusedFolderAccess };
}

export async function ensureWritePermission(handle) {
  const access = await resolveDirectoryAccess(handle, true);
  if (!access.granted) {
    const err = new DOMException("Write permission denied. Allow access to save GPS to your photo files.", "NotAllowedError");
    throw err;
  }
}

/**
 * Check or request read/write access to a saved folder handle.
 * @param {FileSystemDirectoryHandle} handle
 * @param {boolean} request
 * @returns {Promise<{ granted: boolean, reason?: 'prompt' | 'denied' }>}
 */
export async function resolveDirectoryAccess(handle, request = false) {
  const opts = { mode: "readwrite" };
  let perm = await handle.queryPermission(opts);
  if (perm === "granted") return { granted: true };
  if (!request) {
    return { granted: false, reason: perm === "denied" ? "denied" : "prompt" };
  }
  perm = await handle.requestPermission(opts);
  if (perm === "granted") return { granted: true };
  return { granted: false, reason: "denied" };
}

/**
 * Restore all images from a saved directory handle.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {{ requestPermission?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, entries: Array<object>, reason?: string }>}
 */
export async function restoreDirectoryEntries(dirHandle, opts = {}) {
  const { requestPermission = false } = opts;
  if (!dirHandle || dirHandle.kind !== "directory") {
    return { ok: false, entries: [], reason: "missing" };
  }

  try {
    const access = await resolveDirectoryAccess(dirHandle, requestPermission);
    if (!access.granted) {
      return { ok: false, entries: [], reason: access.reason || "prompt" };
    }

    const entries = [];
    await walkDirectory(dirHandle, "", 0, entries);
    if (!entries.length) {
      return { ok: false, entries: [], reason: "empty" };
    }
    return { ok: true, entries };
  } catch (err) {
    const name = err?.name || "";
    if (name === "NotAllowedError" || name === "AbortError") {
      return { ok: false, entries: [], reason: "denied" };
    }
    if (name === "NotFoundError") {
      return { ok: false, entries: [], reason: "missing" };
    }
    console.warn("restoreDirectoryEntries failed:", err);
    return { ok: false, entries: [], reason: "error" };
  }
}

export async function writeBlobToHandle(fileHandle, blob) {
  await ensureWritePermission(fileHandle);
  const buffer = await blob.arrayBuffer();
  const size = buffer.byteLength;
  if (!size) {
    throw new Error("Refusing to write empty file — geotag produced no data.");
  }

  const writable = await fileHandle.createWritable({ keepExistingData: false });
  try {
    await writable.write({ type: "write", position: 0, data: buffer });
    await writable.truncate(size);
  } finally {
    await writable.close();
  }
}
