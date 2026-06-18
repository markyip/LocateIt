/**
 * Full-screen image viewer with film strip navigation.
 */

import { applyPreviewToImg, applyThumbToImg, resolveImageSource } from "./thumbs.js";

/** @type {HTMLElement | null} */
let root = null;
/** @type {HTMLImageElement | null} */
let mainImg = null;
/** @type {HTMLElement | null} */
let infoEl = null;
/** @type {HTMLElement | null} */
let stripEl = null;

/** @type {Array<object>} */
let members = [];
let currentIndex = 0;
let thumbnailMode = "blob";
let open = false;
/** @type {string | null} */
let mainBlobUrl = null;

function revokeMainBlob() {
  if (mainBlobUrl) {
    URL.revokeObjectURL(mainBlobUrl);
    mainBlobUrl = null;
  }
}

function ensureDom() {
  if (root) return;
  root = document.createElement("div");
  root.id = "image-lightbox";
  root.className = "image-lightbox hidden";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.innerHTML = `
    <button type="button" class="lightbox-close" aria-label="Close (Esc)">&times;</button>
    <div class="lightbox-main"><img class="lightbox-img" alt="" /></div>
    <div class="lightbox-info"></div>
    <div class="lightbox-strip" role="list"></div>
  `;
  document.body.appendChild(root);
  mainImg = root.querySelector(".lightbox-img");
  infoEl = root.querySelector(".lightbox-info");
  stripEl = root.querySelector(".lightbox-strip");
  stripEl?.classList.add("scroll-subtle");
  root.querySelector(".lightbox-close")?.addEventListener("click", closeLightbox);
  root.addEventListener("click", (e) => {
    if (e.target === root) closeLightbox();
  });
}

function onKeyDown(e) {
  if (!open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeLightbox();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    navigate(-1);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    navigate(1);
  }
}

async function loadMainImage(member) {
  if (!mainImg) return;
  mainImg.classList.add("loading");
  mainImg.classList.remove("thumb-missing");
  mainImg.removeAttribute("src");
  mainBlobUrl = null;
  const name = member.name || "photo";
  mainImg.alt = name;

  const source = resolveImageSource({
    file: member.file,
    path: member.path,
    mode: thumbnailMode,
  });

  try {
    await applyPreviewToImg(mainImg, source);
    if (member.file && mainImg.src?.startsWith("blob:")) {
      mainBlobUrl = mainImg.src;
    }
  } catch {
    try {
      await applyThumbToImg(mainImg, source);
    } catch {
      mainImg.classList.add("thumb-missing");
    }
  } finally {
    mainImg.classList.remove("loading");
  }

  if (infoEl) {
    const coords =
      member.lat != null && member.lon != null
        ? `${member.lat.toFixed(5)}, ${member.lon.toFixed(5)}`
        : "";
    const status = coords ? coords : "No GPS";
    infoEl.textContent = `${name} · ${status}`;
  }
}

function renderStrip() {
  if (!stripEl) return;
  stripEl.innerHTML = "";
  members.forEach((member, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lightbox-strip-item";
    btn.setAttribute("role", "listitem");
    if (idx === currentIndex) btn.classList.add("active");
    btn.title = member.name || "";
    const img = document.createElement("img");
    img.alt = member.name || "";
    img.draggable = false;
    applyThumbToImg(img, resolveImageSource({
      file: member.file,
      path: member.path,
      mode: thumbnailMode,
    }));
    btn.appendChild(img);
    btn.addEventListener("click", () => showIndex(idx));
    stripEl.appendChild(btn);
  });
  const active = stripEl.querySelector(".lightbox-strip-item.active");
  active?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}

async function showIndex(index) {
  if (!members.length) return;
  currentIndex = ((index % members.length) + members.length) % members.length;
  await loadMainImage(members[currentIndex]);
  stripEl?.querySelectorAll(".lightbox-strip-item").forEach((el, i) => {
    el.classList.toggle("active", i === currentIndex);
  });
  const active = stripEl?.querySelector(".lightbox-strip-item.active");
  active?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}

function navigate(delta) {
  showIndex(currentIndex + delta);
}

/**
 * @param {Array<object>} clusterMembers
 * @param {number} startIndex
 * @param {{ thumbnailMode?: string }} opts
 */
export function openLightbox(clusterMembers, startIndex = 0, opts = {}) {
  if (!clusterMembers?.length) return;
  ensureDom();
  members = clusterMembers;
  thumbnailMode = opts.thumbnailMode || "blob";
  currentIndex = Math.max(0, Math.min(startIndex, members.length - 1));
  open = true;
  root?.classList.remove("hidden");
  document.body.classList.add("lightbox-open");
  renderStrip();
  showIndex(currentIndex);
  document.addEventListener("keydown", onKeyDown);
}

export function closeLightbox() {
  if (!open) return;
  open = false;
  revokeMainBlob();
  root?.classList.add("hidden");
  document.body.classList.remove("lightbox-open");
  document.removeEventListener("keydown", onKeyDown);
  if (mainImg) {
    mainImg.removeAttribute("src");
    mainImg.classList.remove("loading", "thumb-missing");
  }
  members = [];
}
