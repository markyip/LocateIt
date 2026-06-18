/**
 * Folder album browser — preview all images, click any to load the folder.
 */

import { applyThumbToImg } from "./thumbs.js";

/** @type {HTMLElement | null} */
let root = null;
/** @type {HTMLElement | null} */
let titleEl = null;
/** @type {HTMLElement | null} */
let gridEl = null;
/** @type {(() => void) | null} */
let onSelect = null;
/** @type {(() => void) | null} */
let onCancel = null;
let open = false;

function ensureDom() {
  if (root) return;
  root = document.createElement("div");
  root.id = "album-picker";
  root.className = "album-picker hidden";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.innerHTML = `
    <div class="album-picker-panel">
      <header class="album-picker-header">
        <div>
          <h2 class="album-picker-title">Select album</h2>
          <p class="album-picker-subtitle">Click any photo to load this folder</p>
        </div>
        <button type="button" class="album-picker-close" aria-label="Close (Esc)">&times;</button>
      </header>
      <div class="album-picker-grid scroll-subtle" role="list"></div>
    </div>
  `;
  document.body.appendChild(root);
  titleEl = root.querySelector(".album-picker-title");
  gridEl = root.querySelector(".album-picker-grid");
  root.querySelector(".album-picker-close")?.addEventListener("click", () => closeAlbumPicker(true));
  root.addEventListener("click", (e) => {
    if (e.target === root) closeAlbumPicker(true);
  });
}

function onKeyDown(e) {
  if (!open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeAlbumPicker(true);
  }
}

/**
 * @param {{
 *   entries: Array<{ file: File, name?: string, relativePath?: string }>,
 *   folderLabel?: string,
 *   onSelect: () => void | Promise<void>,
 *   onCancel?: () => void,
 * }} opts
 */
export function openAlbumPicker(opts) {
  const { entries, folderLabel = "Album", onSelect: selectCb, onCancel: cancelCb } = opts;
  if (!entries.length) return;

  ensureDom();
  onSelect = selectCb;
  onCancel = cancelCb ?? null;
  open = true;

  if (titleEl) {
    titleEl.textContent = folderLabel;
  }
  if (gridEl) {
    gridEl.innerHTML = "";
    for (const entry of entries) {
      const name = entry.file?.name || entry.name || entry.relativePath || "photo";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "album-picker-item";
      btn.setAttribute("role", "listitem");
      btn.title = name;

      const img = document.createElement("img");
      img.alt = name;
      img.draggable = false;
      applyThumbToImg(img, { file: entry.file, mode: "blob" });

      const cap = document.createElement("span");
      cap.className = "album-picker-name";
      cap.textContent = name;

      btn.appendChild(img);
      btn.appendChild(cap);
      btn.addEventListener("click", () => {
        closeAlbumPicker(false);
        onSelect?.();
      });
      gridEl.appendChild(btn);
    }
  }

  root?.classList.remove("hidden");
  document.body.classList.add("album-picker-open");
  document.addEventListener("keydown", onKeyDown);
}

export function closeAlbumPicker(cancelled = false) {
  if (!open) return;
  open = false;
  root?.classList.add("hidden");
  document.body.classList.remove("album-picker-open");
  document.removeEventListener("keydown", onKeyDown);
  if (cancelled) onCancel?.();
  onSelect = null;
  onCancel = null;
  if (gridEl) gridEl.innerHTML = "";
}
