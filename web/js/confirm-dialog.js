/**
 * Themed confirm dialog (replaces window.confirm).
 */

/** @type {HTMLElement | null} */
let root = null;
/** @type {HTMLElement | null} */
let brandEl = null;
/** @type {HTMLElement | null} */
let titleEl = null;
/** @type {HTMLElement | null} */
let messageEl = null;
/** @type {HTMLElement | null} */
let confirmBtn = null;
/** @type {HTMLElement | null} */
let cancelBtn = null;
/** @type {((value: boolean) => void) | null} */
let resolvePromise = null;
let open = false;

function ensureDom() {
  if (root) return;
  root = document.createElement("div");
  root.id = "app-confirm";
  root.className = "app-confirm hidden";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.innerHTML = `
    <div class="app-confirm-panel">
      <header class="app-confirm-header">
        <img class="app-confirm-logo" src="img/logo-mark.png" width="32" height="32" alt="" aria-hidden="true" />
        <span class="app-confirm-brand">LocateIt</span>
      </header>
      <div class="app-confirm-body">
        <h2 class="app-confirm-title"></h2>
        <p class="app-confirm-message"></p>
      </div>
      <footer class="app-confirm-actions">
        <button type="button" class="btn btn-sm app-confirm-cancel">Cancel</button>
        <button type="button" class="btn btn-sm primary app-confirm-ok">Save</button>
      </footer>
    </div>
  `;
  document.body.appendChild(root);

  brandEl = root.querySelector(".app-confirm-brand");
  titleEl = root.querySelector(".app-confirm-title");
  messageEl = root.querySelector(".app-confirm-message");
  confirmBtn = root.querySelector(".app-confirm-ok");
  cancelBtn = root.querySelector(".app-confirm-cancel");

  cancelBtn?.addEventListener("click", () => finish(false));
  confirmBtn?.addEventListener("click", () => finish(true));
  root.addEventListener("click", (e) => {
    if (e.target === root) finish(false);
  });
}

function finish(value) {
  if (!open) return;
  open = false;
  root?.classList.add("hidden");
  document.body.classList.remove("app-confirm-open");
  document.removeEventListener("keydown", onKeyDown);
  resolvePromise?.(value);
  resolvePromise = null;
}

function onKeyDown(e) {
  if (!open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    finish(false);
  } else if (e.key === "Enter") {
    e.preventDefault();
    finish(true);
  }
}

/**
 * @param {{
 *   brand?: string,
 *   title: string,
 *   message: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 * }} opts
 * @returns {Promise<boolean>}
 */
export function showConfirm(opts) {
  const {
    brand = "LocateIt",
    title,
    message,
    confirmLabel = "Save",
    cancelLabel = "Cancel",
  } = opts;

  ensureDom();
  if (open) finish(false);

  if (brandEl) brandEl.textContent = brand;
  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;
  if (confirmBtn) confirmBtn.textContent = confirmLabel;
  if (cancelBtn) cancelBtn.textContent = cancelLabel;

  root?.setAttribute("aria-labelledby", "app-confirm-title");
  if (titleEl) titleEl.id = "app-confirm-title";

  open = true;
  root?.classList.remove("hidden");
  document.body.classList.add("app-confirm-open");
  document.addEventListener("keydown", onKeyDown);
  confirmBtn?.focus();

  return new Promise((resolve) => {
    resolvePromise = resolve;
  });
}

/**
 * @param {number} count
 * @returns {Promise<boolean>}
 */
export function confirmSaveGeotags(count) {
  const noun = count === 1 ? "photo" : "photos";
  return showConfirm({
    title: `Save GPS to ${count} ${noun}?`,
    message:
      `LocateIt will write the map position you chose for each photo into its original file. ` +
      `Any existing GPS data in those files will be replaced. JPEG and RAW are supported.`,
    confirmLabel: count === 1 ? "Save GPS" : `Save ${count} photos`,
    cancelLabel: "Cancel",
  });
}
