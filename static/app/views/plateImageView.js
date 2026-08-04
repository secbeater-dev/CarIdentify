import { escapeHtml } from "../shared/utils.js?v=20260804a";

function isLocalPlateImageUrl(value) {
  return String(value ?? "").trim().startsWith("blob:");
}

export function renderPlateImageThumbnailHtml(value) {
  const url = String(value ?? "").trim();
  if (!isLocalPlateImageUrl(url)) {
    return '<span class="plate-image-missing">無圖片</span>';
  }
  return `<button type="button" class="plate-image-thumbnail" title="檢視牌照圖片"><img src="${escapeHtml(url)}" alt="牌照圖片" loading="lazy" decoding="async"></button>`;
}

function closePlateImageDialog(dialog, image) {
  if (dialog?.open) {
    dialog.close();
  }
  image?.removeAttribute("src");
}

export function initPlateImageViewer() {
  const dialog = document.getElementById("plate-image-dialog");
  const image = document.getElementById("plate-image-dialog-image");
  const closeButton = document.getElementById("plate-image-dialog-close");
  if (!dialog || !image || !closeButton || dialog.__plateImageViewerReady) return;

  document.addEventListener("click", (event) => {
    const thumbnail = event.target.closest?.(".plate-image-thumbnail");
    if (!thumbnail) return;
    const sourceImage = thumbnail.querySelector("img");
    const url = sourceImage?.src || "";
    if (!isLocalPlateImageUrl(url)) return;
    image.src = url;
    image.alt = "牌照圖片";
    if (!dialog.open) {
      dialog.showModal();
    }
  });

  closeButton.addEventListener("click", () => closePlateImageDialog(dialog, image));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closePlateImageDialog(dialog, image);
    }
  });
  dialog.addEventListener("cancel", () => {
    window.setTimeout(() => image.removeAttribute("src"), 0);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.open) {
      event.preventDefault();
      closePlateImageDialog(dialog, image);
    }
  });
  dialog.__plateImageViewerReady = true;
}
