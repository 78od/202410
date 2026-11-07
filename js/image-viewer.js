const imageViewer = document.createElement("dialog");
imageViewer.className = "image-viewer";
imageViewer.setAttribute("aria-label", "图片预览");

const imageViewerContent = document.createElement("figure");
imageViewerContent.className = "image-viewer-content";

const imageViewerClose = document.createElement("button");
imageViewerClose.className = "image-viewer-close";
imageViewerClose.type = "button";
imageViewerClose.setAttribute("aria-label", "关闭图片预览");
imageViewerClose.textContent = "×";

const imageViewerPrevious = document.createElement("button");
imageViewerPrevious.className = "image-viewer-nav image-viewer-previous";
imageViewerPrevious.type = "button";
imageViewerPrevious.setAttribute("aria-label", "上一张图片");
imageViewerPrevious.textContent = "‹";

const imageViewerImage = document.createElement("img");
imageViewerImage.className = "image-viewer-image";

const imageViewerCaption = document.createElement("figcaption");
imageViewerCaption.className = "image-viewer-caption";
imageViewerCaption.setAttribute("aria-live", "polite");

const imageViewerNext = document.createElement("button");
imageViewerNext.className = "image-viewer-nav image-viewer-next";
imageViewerNext.type = "button";
imageViewerNext.setAttribute("aria-label", "下一张图片");
imageViewerNext.textContent = "›";

const imageViewerRetry = document.createElement("button");
imageViewerRetry.className = "image-viewer-retry";
imageViewerRetry.type = "button";
imageViewerRetry.hidden = true;
imageViewerRetry.textContent = "重试加载图片";

imageViewerContent.append(
  imageViewerClose,
  imageViewerPrevious,
  imageViewerImage,
  imageViewerNext,
  imageViewerCaption,
  imageViewerRetry,
);
imageViewer.append(imageViewerContent);
document.body.append(imageViewer);

let imageViewerOpener = null;
let imageViewerSource = "";
let imageViewerGroup = [];
let imageViewerIndex = 0;

for (const image of document.querySelectorAll("img[alt]:not([alt=''])")) {
  if (image.closest("[aria-hidden='true']")) {
    continue;
  }

  image.classList.add("image-viewer-trigger");
  if (!image.closest("a, button")) {
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `查看大图：${image.alt}`);
  } else if (image.closest("a")) {
    const imageLink = image.closest("a");
    imageLink.setAttribute("aria-keyshortcuts", "Alt+Enter");
    imageLink.setAttribute("aria-description", "按 Alt+Enter 在浮窗中查看图片");
  }
}

function showImageViewer(image) {
  if (
    imageViewer.open ||
    !(image instanceof HTMLImageElement) ||
    !image.isConnected ||
    image.closest("[aria-hidden='true']")
  ) {
    return;
  }

  imageViewerOpener = image.closest("a, button") || image;
  const groupContainer = image.closest(".photo-strip, .mini-gallery, .detail-card") || image.parentElement;
  imageViewerGroup = Array.from(groupContainer.querySelectorAll("img[alt]:not([alt=''])")).filter(
    (candidate) => !candidate.closest("[aria-hidden='true']"),
  );
  imageViewerIndex = Math.max(0, imageViewerGroup.indexOf(image));
  imageViewerPrevious.hidden = imageViewerGroup.length < 2;
  imageViewerNext.hidden = imageViewerGroup.length < 2;
  renderImageViewerImage();
  imageViewer.showModal();
  imageViewerClose.focus();
}

function renderImageViewerImage() {
  const image = imageViewerGroup[imageViewerIndex];
  if (!image) {
    return;
  }

  imageViewerSource = image.currentSrc || image.src;
  imageViewerImage.hidden = false;
  imageViewerRetry.hidden = true;
  imageViewerImage.src = imageViewerSource;
  imageViewerImage.alt = image.alt;
  imageViewerImage.decoding = "async";
  imageViewerImage.fetchPriority = "high";
  imageViewerCaption.textContent = image.alt;
}

function moveImageViewer(delta) {
  if (!imageViewer.open || imageViewerGroup.length < 2) {
    return;
  }

  imageViewerIndex = (imageViewerIndex + delta + imageViewerGroup.length) % imageViewerGroup.length;
  renderImageViewerImage();
}

function closeImageViewer() {
  if (imageViewer.open) {
    imageViewer.close();
  }
}

imageViewer.addEventListener("close", () => {
  if (imageViewerOpener instanceof HTMLElement && imageViewerOpener.isConnected) {
    imageViewerOpener.focus({ preventScroll: true });
  }
  imageViewerOpener = null;
});

imageViewerImage.addEventListener("error", () => {
  imageViewerImage.hidden = true;
  imageViewerCaption.textContent = "图片加载失败，可以重试。";
  imageViewerRetry.hidden = false;
});

imageViewerRetry.addEventListener("click", () => {
  imageViewerRetry.hidden = true;
  imageViewerImage.hidden = false;
  imageViewerCaption.textContent = "正在重试加载图片…";
  imageViewerImage.removeAttribute("src");
  window.requestAnimationFrame(() => {
    if (imageViewer.open) {
      imageViewerImage.src = imageViewerSource;
    }
  });
});

imageViewerClose.addEventListener("click", closeImageViewer);
imageViewerPrevious.addEventListener("click", () => moveImageViewer(-1));
imageViewerNext.addEventListener("click", () => moveImageViewer(1));
imageViewer.addEventListener("click", (event) => {
  if (event.target === imageViewer) {
    closeImageViewer();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && imageViewer.open) {
    event.preventDefault();
    closeImageViewer();
    return;
  }

  if (imageViewer.open && event.key === "ArrowLeft") {
    event.preventDefault();
    moveImageViewer(-1);
    return;
  }
  if (imageViewer.open && event.key === "ArrowRight") {
    event.preventDefault();
    moveImageViewer(1);
    return;
  }

  if (event.altKey && event.key === "Enter") {
    const linkedImage =
      event.target instanceof HTMLImageElement
        ? event.target
        : event.target instanceof Element
          ? event.target.closest("a")?.querySelector("img[alt]:not([alt=''])")
          : null;
    if (linkedImage) {
      event.preventDefault();
      showImageViewer(linkedImage);
      return;
    }
  }

  if (!(event.target instanceof HTMLImageElement)) {
    return;
  }

  const image = event.target;
  if (image.closest("a, button")) {
    return;
  }

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    showImageViewer(image);
  }
});

document.addEventListener("click", (event) => {
  if (
    event.target instanceof HTMLImageElement &&
    !event.target.closest("a, button") &&
    !imageViewer.contains(event.target)
  ) {
    showImageViewer(event.target);
  }
});

document.addEventListener("dblclick", (event) => {
  if (!(event.target instanceof HTMLImageElement)) {
    return;
  }

  if (!event.target.alt.trim() || imageViewer.contains(event.target)) {
    return;
  }

  event.preventDefault();
  showImageViewer(event.target);
});
