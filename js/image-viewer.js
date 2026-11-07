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

const imageViewerImage = document.createElement("img");
imageViewerImage.className = "image-viewer-image";

const imageViewerCaption = document.createElement("figcaption");
imageViewerCaption.className = "image-viewer-caption";

imageViewerContent.append(imageViewerClose, imageViewerImage, imageViewerCaption);
imageViewer.append(imageViewerContent);
document.body.append(imageViewer);

for (const image of document.querySelectorAll("img[alt]:not([alt=''])")) {
  if (image.closest("[aria-hidden='true']")) {
    continue;
  }

  image.classList.add("image-viewer-trigger");
  if (!image.hasAttribute("title")) {
    image.title = "双击放大查看";
  }
}

function closeImageViewer() {
  imageViewer.close();
}

imageViewerClose.addEventListener("click", closeImageViewer);
imageViewer.addEventListener("click", (event) => {
  if (event.target === imageViewer) {
    closeImageViewer();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && imageViewer.open) {
    event.preventDefault();
    closeImageViewer();
  }
});

document.addEventListener("dblclick", (event) => {
  if (!(event.target instanceof HTMLImageElement)) {
    return;
  }

  const image = event.target;
  if (
    !image.isConnected ||
    !image.currentSrc ||
    !image.alt.trim() ||
    image.closest("[aria-hidden='true']") ||
    imageViewer.contains(image)
  ) {
    return;
  }

  event.preventDefault();
  imageViewerImage.src = image.currentSrc;
  imageViewerImage.alt = image.alt;
  imageViewerCaption.textContent = image.alt;
  imageViewer.showModal();
  imageViewerClose.focus();
});
