/**
 * Thumbnail loading — browser blob for standard images, server decode for RAW/HEIC.
 * Applies EXIF orientation (RAWviewer-style) so portrait photos display upright.
 */

const RAW_EXT = new Set([
  "3fr", "arw", "cr2", "cr3", "dng", "erf", "iiq", "nef", "nrw", "orf", "pef",
  "raf", "raw", "rw2", "srw", "x3f", "cap", "fff", "mef", "mos", "rwl", "srf",
]);

const SERVER_THUMB_EXT = new Set([
  ...RAW_EXT,
  "heic", "heif", "tif", "tiff",
]);

const thumbUrlCache = new WeakMap();
const previewUrlCache = new WeakMap();

export function isRawFileName(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return RAW_EXT.has(ext);
}

export function needsServerThumb(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return SERVER_THUMB_EXT.has(ext);
}

function waitImgLoad(img) {
  return new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) {
      resolve();
      return;
    }
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("image load failed"));
    };
    const cleanup = () => {
      img.removeEventListener("load", onLoad);
      img.removeEventListener("error", onError);
    };
    img.addEventListener("load", onLoad);
    img.addEventListener("error", onError);
  });
}

async function loadServerPathImg(img, url) {
  img.src = url;
  await waitImgLoad(img);
}

async function fetchServerThumb(file) {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/thumbnail/upload", { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`thumbnail ${res.status}`);
  }
  return URL.createObjectURL(await res.blob());
}

async function fetchServerPreview(file) {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/preview/upload", { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`preview ${res.status}`);
  }
  return URL.createObjectURL(await res.blob());
}

/**
 * Bake EXIF orientation into pixels (matches browser RAWviewer preview behavior).
 * @param {File | Blob} file
 * @param {{ maxEdge?: number, quality?: number }} [opts]
 */
async function createOrientedBlobUrl(file, opts = {}) {
  const { maxEdge = 0, quality = 0.88 } = opts;
  if (typeof createImageBitmap !== "function") {
    return URL.createObjectURL(file);
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    let w = bitmap.width;
    let h = bitmap.height;
    if (maxEdge > 0) {
      const longest = Math.max(w, h);
      if (longest > maxEdge) {
        const scale = maxEdge / longest;
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return URL.createObjectURL(file);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        quality
      );
    });
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}

function markThumbMissing(img) {
  img.removeAttribute("src");
  img.classList.add("thumb-missing");
}

/** Resolve server vs blob source (path-only pending items need server mode). */
export function resolveImageSource({ file, path, mode = "blob" }) {
  if (path && (mode === "server" || !file)) {
    return { file: file ?? null, path, mode: "server" };
  }
  return { file: file ?? null, path: path ?? null, mode: "blob" };
}

async function applyServerPathPreview(img, path) {
  const previewUrl = `/api/preview?path=${encodeURIComponent(path)}`;
  try {
    await loadServerPathImg(img, previewUrl);
    return;
  } catch (previewErr) {
    console.warn("Server preview failed, using thumbnail:", path, previewErr);
    const thumbUrl = `/api/thumbnail?path=${encodeURIComponent(path)}`;
    await loadServerPathImg(img, thumbUrl);
  }
}

/**
 * @param {HTMLImageElement} img
 * @param {{ file?: File, path?: string, mode?: 'blob' | 'server' }} source
 */
export async function applyThumbToImg(img, source) {
  const resolved = resolveImageSource(source);
  const { file, path, mode } = resolved;
  img.classList.remove("thumb-missing", "thumb-loading");
  img.classList.add("thumb-loading");

  try {
    if (mode === "server" && path) {
      await loadServerPathImg(img, `/api/thumbnail?path=${encodeURIComponent(path)}`);
      return;
    }

    if (!file) {
      throw new Error("No file for thumbnail");
    }

    const cached = thumbUrlCache.get(file);
    if (cached) {
      img.src = cached;
      return;
    }

    if (needsServerThumb(file.name)) {
      const url = await fetchServerThumb(file);
      thumbUrlCache.set(file, url);
      img.src = url;
      return;
    }

    try {
      const url = await createOrientedBlobUrl(file, { maxEdge: 640, quality: 0.82 });
      thumbUrlCache.set(file, url);
      img.src = url;
    } catch {
      const url = await fetchServerThumb(file);
      thumbUrlCache.set(file, url);
      img.src = url;
    }
  } catch (err) {
    console.warn("Thumbnail failed:", file?.name || path, err);
    markThumbMissing(img);
  } finally {
    img.classList.remove("thumb-loading");
  }
}

/**
 * Full-screen preview — full file in browser when possible, large server JPEG otherwise.
 * @param {HTMLImageElement} img
 * @param {{ file?: File, path?: string, mode?: 'blob' | 'server' }} source
 */
export async function applyPreviewToImg(img, source) {
  const resolved = resolveImageSource(source);
  const { file, path, mode } = resolved;
  img.classList.remove("thumb-missing", "thumb-loading");
  img.classList.add("thumb-loading");

  try {
    if (mode === "server" && path) {
      await applyServerPathPreview(img, path);
      return;
    }

    if (!file) {
      throw new Error("No file or path for preview");
    }

    if (!needsServerThumb(file.name)) {
      const cached = previewUrlCache.get(file);
      if (cached) {
        img.src = cached;
        await waitImgLoad(img);
        return;
      }

      try {
        const url = await createOrientedBlobUrl(file, { maxEdge: 1920, quality: 0.9 });
        previewUrlCache.set(file, url);
        img.src = url;
        await waitImgLoad(img);
      } catch {
        const url = await fetchServerPreview(file);
        previewUrlCache.set(file, url);
        img.src = url;
        await waitImgLoad(img);
      }
      return;
    }

    const cached = previewUrlCache.get(file);
    if (cached) {
      img.src = cached;
      await waitImgLoad(img);
      return;
    }

    const url = await fetchServerPreview(file);
    previewUrlCache.set(file, url);
    img.src = url;
    await waitImgLoad(img);
  } catch (err) {
    console.warn("Preview failed:", file?.name || path, err);
    img.classList.remove("thumb-missing");
    try {
      await applyThumbToImg(img, resolved);
      if (!img.classList.contains("thumb-missing") && img.src) {
        return;
      }
    } catch {
      /* fall through */
    }
    markThumbMissing(img);
    throw err;
  } finally {
    img.classList.remove("thumb-loading");
  }
}
