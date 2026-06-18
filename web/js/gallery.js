/**
 * Pending-photo gallery grid (RAWviewer-style thumbnails).
 */

import { applyThumbToImg } from "./thumbs.js";

const DRAG_THRESHOLD_PX = 8;
const FOLLOWER_OFFSET_X = 12;
const FOLLOWER_OFFSET_Y = 10;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function buildDragFollowerCanvas(sourceImg, dragCount) {
  const pad = 4;
  const thumbW = 68;
  const thumbH = 51;
  const w = thumbW + pad * 2;
  const h = thumbH + pad * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "rgba(15, 20, 30, 0.82)";
  roundRect(ctx, 0, 0, w, h, 8);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = 1;
  roundRect(ctx, 0.5, 0.5, w - 1, h - 1, 8);
  ctx.stroke();

  if (sourceImg?.complete && sourceImg.naturalWidth > 0) {
    ctx.save();
    ctx.globalAlpha = 0.78;
    roundRect(ctx, pad, pad, thumbW, thumbH, 5);
    ctx.clip();
    const sw = sourceImg.naturalWidth;
    const sh = sourceImg.naturalHeight;
    const scale = Math.max(thumbW / sw, thumbH / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(
      sourceImg,
      pad + (thumbW - dw) / 2,
      pad + (thumbH - dh) / 2,
      dw,
      dh
    );
    ctx.restore();
  } else {
    ctx.fillStyle = "rgb(36, 48, 68)";
    roundRect(ctx, pad, pad, thumbW, thumbH, 5);
    ctx.fill();
  }

  if (dragCount > 1) {
    const label = String(dragCount);
    ctx.globalAlpha = 1;
    ctx.font = "bold 11px Segoe UI, system-ui, sans-serif";
    const badgeW = Math.max(20, ctx.measureText(label).width + 10);
    const bx = w - badgeW + 4;
    ctx.fillStyle = "rgb(245, 158, 11)";
    roundRect(ctx, bx, 0, badgeW, 18, 9);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.5;
    roundRect(ctx, bx + 0.75, 0.75, badgeW - 1.5, 15, 9);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, bx + badgeW / 2, 9);
  }

  return canvas;
}

function createFollower(sourceImg, dragCount) {
  const el = document.createElement("div");
  el.className = "gallery-drag-follower";
  el.appendChild(buildDragFollowerCanvas(sourceImg, dragCount));
  document.body.appendChild(el);
  return el;
}

function positionFollower(follower, clientX, clientY) {
  follower.style.transform = `translate(${clientX + FOLLOWER_OFFSET_X}px, ${clientY + FOLLOWER_OFFSET_Y}px)`;
}

function attachGalleryPointerDrag(tile, item, opts) {
  const {
    getDragIds,
    onPointerDragStart,
    onPointerDragMove,
    onPointerDragDrop,
    onPointerDragCancel,
  } = opts;

  tile.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".gallery-unpin-btn")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const ids = getDragIds(item.id);
    let active = false;
    let follower = null;
    let suppressClick = false;

    const onMove = (ev) => {
      if (!active) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        active = true;
        suppressClick = true;
        tile.classList.add("dragging");
        document.body.classList.add("gallery-pointer-dragging");
        follower = createFollower(tile.querySelector(".gallery-thumb"), ids.length);
        positionFollower(follower, ev.clientX, ev.clientY);
        onPointerDragStart?.();
      }
      if (follower) positionFollower(follower, ev.clientX, ev.clientY);
      onPointerDragMove?.(ev.clientX, ev.clientY);
    };

    const onUp = (ev) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("gallery-pointer-dragging");
      tile.classList.remove("dragging");
      follower?.remove();

      if (active) {
        onPointerDragDrop?.(ev.clientX, ev.clientY, ids);
      } else {
        onPointerDragCancel?.();
      }

      if (suppressClick) {
        tile.addEventListener(
          "click",
          (clickEv) => {
            clickEv.preventDefault();
            clickEv.stopPropagation();
          },
          { capture: true, once: true }
        );
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  });
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   items: Array<object>,
 *   selectedIds: Set<string>,
 *   onToggleSelect: (id: string, selected: boolean) => void,
 *   onPreviewItem?: (id: string) => void,
 *   onUnpinItem?: (id: string) => void,
 *   getDragIds: (id: string) => string[],
 *   onPointerDragStart?: () => void,
 *   onPointerDragMove?: (clientX: number, clientY: number) => void,
 *   onPointerDragDrop?: (clientX: number, clientY: number, ids: string[]) => void,
 *   onPointerDragCancel?: () => void,
 * }} opts
 */
export function renderPendingGallery(container, opts) {
  const {
    items,
    selectedIds,
    onToggleSelect,
    onPreviewItem,
    onUnpinItem,
    getDragIds,
    onPointerDragStart,
    onPointerDragMove,
    onPointerDragDrop,
    onPointerDragCancel,
  } = opts;
  container.innerHTML = "";

  for (const item of items) {
    const tile = document.createElement("div");
    tile.className = "gallery-tile";
    tile.dataset.id = item.id;
    if (item.lat != null) tile.classList.add("placed");
    if (selectedIds.has(item.id)) tile.classList.add("selected");

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "gallery-thumb-wrap";
    thumbWrap.title = "Click to preview · drag to map";
    thumbWrap.setAttribute("role", "button");
    thumbWrap.setAttribute("aria-label", `Preview ${item.name}`);

    const img = document.createElement("img");
    img.className = "gallery-thumb";
    img.alt = item.name;
    img.draggable = false;
    applyThumbToImg(img, item.path
      ? { path: item.path, mode: "server" }
      : { file: item.file, mode: "blob" });

    if (item.lat != null) {
      const badge = document.createElement("span");
      badge.className = "gallery-gps-badge";
      badge.title = `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`;
      badge.textContent = "📍";
      thumbWrap.appendChild(badge);

      const unpinBtn = document.createElement("button");
      unpinBtn.type = "button";
      unpinBtn.className = "gallery-unpin-btn";
      unpinBtn.title = "Remove from map";
      unpinBtn.setAttribute("aria-label", `Remove ${item.name} from map`);
      unpinBtn.textContent = "×";
      unpinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        onUnpinItem?.(item.id);
      });
      thumbWrap.appendChild(unpinBtn);
    }

    const previewHint = document.createElement("span");
    previewHint.className = "gallery-preview-hint";
    previewHint.setAttribute("aria-hidden", "true");
    previewHint.textContent = "⤢";

    thumbWrap.appendChild(img);
    thumbWrap.appendChild(previewHint);

    const caption = document.createElement("div");
    caption.className = "gallery-caption";
    caption.title = "Click to select · select several, then drag together";
    caption.setAttribute("role", "button");
    caption.setAttribute("tabindex", "0");
    caption.setAttribute("aria-pressed", String(selectedIds.has(item.id)));
    caption.setAttribute("aria-label", `Select ${item.name}`);

    const nameEl = document.createElement("span");
    nameEl.className = "gallery-name";
    nameEl.textContent = item.name;
    nameEl.title = item.name;

    const coordsEl = document.createElement("span");
    coordsEl.className = "gallery-coords";
    coordsEl.textContent =
      item.lat != null
        ? `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)} · on map`
        : "Drag to map";

    caption.appendChild(nameEl);
    caption.appendChild(coordsEl);

    tile.appendChild(thumbWrap);
    tile.appendChild(caption);

    thumbWrap.addEventListener("click", (e) => {
      e.stopPropagation();
      onPreviewItem?.(item.id);
    });
    thumbWrap.addEventListener("dblclick", (e) => e.stopPropagation());

    caption.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggleSelect(item.id, !selectedIds.has(item.id));
    });
    caption.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      onToggleSelect(item.id, !selectedIds.has(item.id));
    });

    tile.addEventListener("click", () => {
      onToggleSelect(item.id, !selectedIds.has(item.id));
    });

    tile.addEventListener("dblclick", (e) => {
      e.preventDefault();
      onPreviewItem?.(item.id);
    });

    attachGalleryPointerDrag(tile, item, {
      getDragIds,
      onPointerDragStart,
      onPointerDragMove,
      onPointerDragDrop,
      onPointerDragCancel,
    });

    container.appendChild(tile);
  }
}

/**
 * Update tile states without full rebuild (selection / placed).
 */
export function syncGalleryTileStates(container, { selectedIds, itemsById }) {
  for (const tile of container.querySelectorAll(".gallery-tile")) {
    const id = tile.dataset.id;
    const item = itemsById.get(id);
    if (!item) continue;
    tile.classList.toggle("selected", selectedIds.has(id));
    tile.classList.toggle("placed", item.lat != null);
    const caption = tile.querySelector(".gallery-caption");
    if (caption) caption.setAttribute("aria-pressed", String(selectedIds.has(id)));
    const coords = tile.querySelector(".gallery-coords");
    if (coords) {
      coords.textContent =
        item.lat != null
          ? `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)} · on map`
          : "Drag to map";
    }
    let badge = tile.querySelector(".gallery-gps-badge");
    if (item.lat != null && !badge) {
      badge = document.createElement("span");
      badge.className = "gallery-gps-badge";
      badge.title = `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`;
      badge.textContent = "📍";
      tile.querySelector(".gallery-thumb-wrap")?.prepend(badge);
    } else if (item.lat == null && badge) {
      badge.remove();
    } else if (badge && item.lat != null) {
      badge.title = `${item.lat.toFixed(5)}, ${item.lon.toFixed(5)}`;
    }
  }
}
