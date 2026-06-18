/**
 * Leaflet map: cluster pins with count badges and hover thumbnail strip.
 */

import { applyThumbToImg } from "./thumbs.js";
import { openLightbox } from "./lightbox.js";

const PIN_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];

export class ClusterMap {
  constructor(containerId) {
    this.map = L.map(containerId, {
      zoomControl: false,
      scrollWheelZoom: true,
      zoomSnap: 1,
      zoomDelta: 1,
      wheelPxPerZoomLevel: 55,
      wheelDebounceTime: 25,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);

    this.layer = L.layerGroup().addTo(this.map);
    this.placementLayer = L.layerGroup().addTo(this.map);
    this.searchLayer = L.layerGroup().addTo(this.map);
    this.hoverBox = document.getElementById("hover-preview");
    this.thumbnailMode = "server"; // 'server' | 'blob'
    this._hideTimer = null;
    this._hoverGeneration = 0;
    this._onMapDrop = null;
    this._placementHandlers = null;
    this._galleryDragActive = false;
    this._placementDragActive = false;

    this._setupHoverPreviewEvents();
    this.map.setView([20, 0], 2);
    this._scheduleInvalidateSize();
    window.addEventListener("resize", () => this.invalidateSize());
  }

  invalidateSize() {
    this.map.invalidateSize(true);
  }

  _scheduleInvalidateSize() {
    requestAnimationFrame(() => this.invalidateSize());
    window.addEventListener("load", () => this.invalidateSize(), { once: true });
  }

  setView(lat, lon, zoom = 12) {
    this.invalidateSize();
    this.map.setView([lat, lon], zoom);
  }

  flyToLocation(lat, lon, { zoom = 14, label = "" } = {}) {
    this.invalidateSize();
    this.searchLayer.clearLayers();
    const icon = L.divIcon({
      className: "cluster-pin-wrap",
      html: `<div class="search-pin" title="${label.replace(/"/g, "&quot;")}">
        <span class="search-pin-dot"></span>
      </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    L.marker([lat, lon], { icon }).addTo(this.searchLayer);
    this.map.flyTo([lat, lon], zoom, { duration: 0.8 });
  }

  setThumbnailMode(mode) {
    this.thumbnailMode = mode;
  }

  setMapDropHandler(fn) {
    this._onMapDrop = fn;
  }

  setPlacementHandlers(handlers) {
    this._placementHandlers = handlers;
  }

  _sidebarDropTarget() {
    return document.querySelector(".sidebar");
  }

  _unpinHighlightEl() {
    return document.getElementById("pending-panel") || this._sidebarDropTarget();
  }

  _pointerFromEvent(e) {
    const ev = e?.originalEvent ?? e;
    return {
      x: ev?.clientX ?? 0,
      y: ev?.clientY ?? 0,
    };
  }

  _isPointerOverUnpinZone(clientX, clientY) {
    if (!clientX && !clientY) return false;

    const sidebar = this._sidebarDropTarget();
    if (sidebar) {
      const r = sidebar.getBoundingClientRect();
      if (
        clientX >= r.left &&
        clientX <= r.right &&
        clientY >= r.top &&
        clientY <= r.bottom
      ) {
        return true;
      }
    }

    const hit = document.elementFromPoint(clientX, clientY);
    return Boolean(hit?.closest(".sidebar"));
  }

  _setPlacementDragActive(active) {
    if (active) {
      this.map.dragging.disable();
      this.map.scrollWheelZoom.disable();
      this.map.doubleClickZoom.disable();
    } else {
      this.map.dragging.enable();
      this.map.scrollWheelZoom.enable();
      this.map.doubleClickZoom.enable();
    }
  }

  _isPointerOverMap(clientX, clientY) {
    if (!clientX && !clientY) return false;
    const rect = this.map.getContainer().getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  }

  _shouldBlockClusterHover() {
    return this._galleryDragActive || this._placementDragActive;
  }

  beginGalleryPointerDrag() {
    this._galleryDragActive = true;
    this.hideHoverPreview();
    this._setPlacementDragActive(true);
  }

  updateGalleryPointerDrag(clientX, clientY) {
    const over = this._isPointerOverMap(clientX, clientY);
    this.map.getContainer().classList.toggle("map-drop-target", over);
  }

  finishGalleryPointerDrag(clientX, clientY, ids) {
    this.map.getContainer().classList.remove("map-drop-target");
    this._galleryDragActive = false;
    this._setPlacementDragActive(false);
    if (this._isPointerOverMap(clientX, clientY) && ids?.length && this._onMapDrop) {
      const latlng = this._latLngFromClient(clientX, clientY);
      if (latlng) this._onMapDrop(ids, latlng.lat, latlng.lng);
    }
  }

  cancelGalleryPointerDrag() {
    this.map.getContainer().classList.remove("map-drop-target");
    this._galleryDragActive = false;
    this._setPlacementDragActive(false);
  }

  renderPlacements(placements) {
    this.placementLayer.clearLayers();
    if (!placements?.length) return;

    placements.forEach((pt) => {
      const pendingId = pt.pendingId;
      const icon = L.divIcon({
        className: "cluster-pin-wrap placement-pin-wrap",
        html: `<div class="placement-pin" title="Drag to move · drop on the left panel to unpin">
          <span class="placement-pin-dot"></span>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });

      const marker = L.marker([pt.lat, pt.lon], {
        icon,
        draggable: true,
        autoPan: false,
        zIndexOffset: 1200,
      });
      marker.pendingId = pendingId;
      marker.placement = pt;
      let dragOrigin = null;
      let pointerOverSidebar = false;
      let lastPointer = { x: 0, y: 0 };

      marker.on("dragstart", () => {
        dragOrigin = marker.getLatLng();
        pointerOverSidebar = false;
        this._placementDragActive = true;
        this.hideHoverPreview();
        this._setPlacementDragActive(true);
      });

      marker.on("drag", (e) => {
        const ptr = this._pointerFromEvent(e);
        if (ptr.x || ptr.y) lastPointer = ptr;
        pointerOverSidebar = this._isPointerOverUnpinZone(ptr.x, ptr.y);
        this._unpinHighlightEl()?.classList.toggle("sidebar-unpin-target", pointerOverSidebar);
        if (pointerOverSidebar && dragOrigin) {
          marker.setLatLng(dragOrigin);
          return;
        }
        const latlng = this._latLngFromClient(ptr.x, ptr.y);
        if (latlng) marker.setLatLng(latlng);
      });

      marker.on("dragend", (e) => {
        this._placementDragActive = false;
        this._setPlacementDragActive(false);
        this._unpinHighlightEl()?.classList.remove("sidebar-unpin-target");

        const ptr = this._pointerFromEvent(e);
        const px = ptr.x || lastPointer.x;
        const py = ptr.y || lastPointer.y;
        const shouldUnpin =
          pointerOverSidebar || this._isPointerOverUnpinZone(px, py);

        if (shouldUnpin) {
          if (dragOrigin) marker.setLatLng(dragOrigin);
          this._placementHandlers?.onUnpin?.(pendingId);
          return;
        }

        const latlng = this._latLngFromClient(px, py) || marker.getLatLng();
        marker.setLatLng(latlng);
        this._placementHandlers?.onMove?.(pendingId, latlng.lat, latlng.lng);
      });

      marker.on("click", () => {
        this.hideHoverPreview();
        if (this._placementHandlers?.onClick) {
          this._placementHandlers.onClick(pt);
        }
      });

      marker.addTo(this.placementLayer);
    });
  }

  _setupHoverPreviewEvents() {
    if (!this.hoverBox) return;
    this.hoverBox.addEventListener("mouseenter", () => clearTimeout(this._hideTimer));
    this.hoverBox.addEventListener("mouseleave", () => this._scheduleHidePreview());
  }

  _shouldIgnoreMarkerMouseOut(event, marker) {
    const related = event?.relatedTarget;
    if (!(related instanceof Node)) return false;
    if (this.hoverBox?.contains(related)) return true;
    const el = marker?.getElement?.();
    if (el?.contains(related)) return true;
    return false;
  }

  _positionHoverPreview(event) {
    if (!this.hoverBox || !event) return;
    const pad = 12;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    this.hoverBox.style.left = `${Math.max(8, x)}px`;
    this.hoverBox.style.top = `${Math.max(8, y)}px`;
    this.hoverBox.style.bottom = "";
    this.hoverBox.style.transform = "";
    const rect = this.hoverBox.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 8) {
      x = event.clientX - rect.width - pad;
    }
    if (y + rect.height > window.innerHeight - 8) {
      y = event.clientY - rect.height - pad;
    }
    this.hoverBox.style.left = `${Math.max(8, x)}px`;
    this.hoverBox.style.top = `${Math.max(8, y)}px`;
  }

  _latLngFromClient(clientX, clientY) {
    if (clientX == null || clientY == null) return null;
    const rect = this.map.getContainer().getBoundingClientRect();
    return this.map.containerPointToLatLng(
      L.point(clientX - rect.left, clientY - rect.top)
    );
  }

  clear() {
    this.layer.clearLayers();
    this.placementLayer.clearLayers();
    this.hideHoverPreview();
  }

  renderClusters(clusters) {
    this.layer.clearLayers();
    this.hideHoverPreview();
    if (!clusters.length) {
      return;
    }

    clusters.forEach((cluster, idx) => {
      const color = PIN_COLORS[idx % PIN_COLORS.length];
      const countLabel = cluster.count > 99 ? "99+" : String(cluster.count);
      const icon = L.divIcon({
        className: "cluster-pin-wrap",
        html: `<div class="cluster-pin" style="--pin-color:${color}">
          <span class="cluster-pin-dot">${countLabel}</span>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([cluster.lat, cluster.lon], { icon, zIndexOffset: 200 });
      marker.cluster = cluster;
      marker.on("mouseover", (e) => {
        if (this._shouldBlockClusterHover()) return;
        clearTimeout(this._hideTimer);
        this._onPinHover(e.target.cluster, e.originalEvent);
      });
      marker.on("mouseout", (e) => {
        if (this._shouldIgnoreMarkerMouseOut(e.originalEvent, e.target)) return;
        this._scheduleHidePreview();
      });
      marker.on("click", () => {
        this.hideHoverPreview();
        openLightbox(cluster.members, 0, { thumbnailMode: this.thumbnailMode });
      });
      marker.addTo(this.layer);
    });
  }

  fitAllBounds(clusterBounds, _placementBounds = []) {
    const all = [...clusterBounds];
    if (!all.length) {
      return;
    }
    if (all.length === 1) {
      this.map.setView(all[0], 14);
      return;
    }
    this.map.fitBounds(all, { padding: [48, 48], maxZoom: 16 });
  }

  _scheduleHidePreview() {
    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this.hideHoverPreview(), 280);
  }

  hideHoverPreview() {
    clearTimeout(this._hideTimer);
    this._hoverGeneration += 1;
    if (!this.hoverBox) return;
    this.hoverBox.classList.add("hidden");
    this.hoverBox.innerHTML = "";
  }

  async _onPinHover(cluster, event) {
    const hoverId = ++this._hoverGeneration;
    clearTimeout(this._hideTimer);
    if (!this.hoverBox) return;

    const maxThumbs = 8;
    const members = cluster.members.slice(0, maxThumbs);
    const title = `${cluster.count} image${cluster.count === 1 ? "" : "s"} · ${cluster.lat.toFixed(5)}, ${cluster.lon.toFixed(5)}`;

    this.hoverBox.innerHTML = `<div class="hover-title">${title}</div><div class="hover-grid"></div>`;
    this.hoverBox.classList.remove("hidden");
    this._positionHoverPreview(event);

    const grid = this.hoverBox.querySelector(".hover-grid");
    if (!grid) return;

    const cells = members.map((m) => {
      const cell = document.createElement("div");
      cell.className = "hover-thumb";
      const img = document.createElement("img");
      img.alt = m.name || "photo";
      img.classList.add("thumb-loading");
      img.draggable = false;
      const cap = document.createElement("span");
      cap.className = "hover-thumb-name";
      cap.textContent = m.name || "";
      cell.appendChild(img);
      cell.appendChild(cap);
      grid.appendChild(cell);
      return { m, img };
    });

    if (hoverId !== this._hoverGeneration) return;

    await Promise.all(
      cells.map(async ({ m, img }) => {
        if (hoverId !== this._hoverGeneration) return;
        try {
          if (m.blobUrl) {
            img.src = m.blobUrl;
          } else {
            await applyThumbToImg(img, {
              file: m.file,
              path: m.path,
              mode: this.thumbnailMode,
            });
          }
        } catch {
          img.classList.add("thumb-missing");
        } finally {
          img.classList.remove("thumb-loading");
        }
      })
    );

    if (hoverId !== this._hoverGeneration) return;

    if (cluster.count > maxThumbs) {
      const more = document.createElement("div");
      more.className = "hover-more";
      more.textContent = `+${cluster.count - maxThumbs} more`;
      grid.appendChild(more);
    }

    this._positionHoverPreview(event);
  }
}
