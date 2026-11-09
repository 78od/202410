(() => {
  const pet = document.querySelector(".site-pet");
  if (!pet) return;

  const button = pet.querySelector(".site-pet-button");
  if (!button) return;

  const eyes = pet.querySelector(".site-pet-eyes");
  const actionNames = ["jump", "wiggle", "spin", "squash", "shake", "lean"];
  const dragThreshold = 5;
  const snapDistance = 34;
  const edge = 8;

  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;
  let offsetX = 0;
  let offsetY = 0;
  let moved = false;
  let suppressClickUntil = 0;
  let perchedCard = null;
  let perchOffsetX = 0;
  let perchFrame = 0;
  let actionTimer = 0;
  let actionClass = "";
  let lastAction = -1;
  let eyeFrame = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerKnown = false;

  function setPosition(left, top) {
    pet.style.left = Math.round(left) + "px";
    pet.style.top = Math.round(top) + "px";
    pet.style.right = "auto";
    pet.style.bottom = "auto";
  }

  function clampPosition(left, top) {
    const width = pet.offsetWidth;
    const height = pet.offsetHeight;
    const maxLeft = Math.max(edge, window.innerWidth - width - edge);
    const maxTop = Math.max(edge, window.innerHeight - height - edge);
    return {
      left: Math.min(Math.max(left, edge), maxLeft),
      top: Math.min(Math.max(top, edge), maxTop)
    };
  }

  function updatePerchedPosition() {
    perchFrame = 0;
    if (!perchedCard || dragging) return;

    const cardRect = perchedCard.getBoundingClientRect();
    const width = pet.offsetWidth;
    const left = Math.min(
      Math.max(cardRect.left + perchOffsetX, edge),
      Math.max(edge, window.innerWidth - width - edge)
    );
    setPosition(left, cardRect.top - pet.offsetHeight + 1);
  }

  function schedulePerchUpdate() {
    if (!perchedCard || dragging || perchFrame) return;
    perchFrame = window.requestAnimationFrame(updatePerchedPosition);
  }

  function findSnapCard() {
    const petRect = pet.getBoundingClientRect();
    const centerX = petRect.left + petRect.width / 2;
    const bottom = petRect.top + petRect.height;
    let best = null;
    let bestDistance = snapDistance;

    document.querySelectorAll(".card, .topbar").forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.width < 40 || rect.height < 24) return;
      if (rect.top < 0 || rect.top > window.innerHeight) return;
      if (centerX < rect.left + 6 || centerX > rect.right - 6) return;

      const distance = Math.abs(bottom - rect.top);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = card;
      }
    });

    return best;
  }

  function snapAfterDrag() {
    const card = findSnapCard();
    if (card) {
      const cardRect = card.getBoundingClientRect();
      const petRect = pet.getBoundingClientRect();
      perchedCard = card;
      perchOffsetX = petRect.left - cardRect.left;
      updatePerchedPosition();
      return;
    }

    perchedCard = null;
    const petRect = pet.getBoundingClientRect();
    const position = clampPosition(petRect.left, petRect.top);
    setPosition(position.left, position.top);
  }

  function clearAction() {
    window.clearTimeout(actionTimer);
    actionTimer = 0;
    if (actionClass) {
      pet.classList.remove(actionClass);
      actionClass = "";
    }
  }

  function updateEyes() {
    eyeFrame = 0;
    if (!eyes || !pointerKnown) return;

    const rect = pet.getBoundingClientRect();
    if (rect.width === 0) return;

    const centerX = rect.left + rect.width * 0.49;
    const centerY = rect.top + rect.height * 0.515;
    let dx = pointerX - centerX;
    let dy = pointerY - centerY;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 1) {
      eyes.style.setProperty("--pet-look-x", "0px");
      eyes.style.setProperty("--pet-look-y", "0px");
      return;
    }

    const maxShift = Math.max(1, rect.width * 0.015);
    dx = (dx / length) * maxShift;
    dy = (dy / length) * maxShift;
    eyes.style.setProperty("--pet-look-x", dx.toFixed(2) + "px");
    eyes.style.setProperty("--pet-look-y", dy.toFixed(2) + "px");
  }

  function trackPointer(event) {
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerKnown = true;
    if (!eyeFrame) {
      eyeFrame = window.requestAnimationFrame(updateEyes);
    }
  }

  function playRandomAction() {
    clearAction();

    let next = Math.floor(Math.random() * actionNames.length);
    if (actionNames.length > 1 && next === lastAction) {
      next = (next + 1) % actionNames.length;
    }
    lastAction = next;
    actionClass = "is-action-" + actionNames[next];
    pet.classList.add(actionClass);
    actionTimer = window.setTimeout(() => {
      pet.classList.remove(actionClass);
      actionClass = "";
      actionTimer = 0;
    }, 900);
  }

  function beginDrag(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    clearAction();
    perchedCard = null;

    const petRect = pet.getBoundingClientRect();
    startX = event.clientX;
    startY = event.clientY;
    startLeft = petRect.left;
    startTop = petRect.top;
    offsetX = event.clientX - petRect.left;
    offsetY = event.clientY - petRect.top;
    moved = false;
    dragging = true;
    pointerId = event.pointerId;

    pet.classList.add("is-dragging");

    try {
      button.setPointerCapture(event.pointerId);
    } catch (error) {
      // Pointer capture is a progressive enhancement.
    }
  }

  function moveDrag(event) {
    if (!dragging || event.pointerId !== pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) < dragThreshold) return;

    if (!moved) {
      moved = true;
      setPosition(startLeft, startTop);
    }

    const position = clampPosition(
      event.clientX - offsetX,
      event.clientY - offsetY
    );
    setPosition(position.left, position.top);

    if (event.cancelable) event.preventDefault();
  }

  function endDrag(event) {
    if (!dragging || event.pointerId !== pointerId) return;

    dragging = false;
    pointerId = null;
    pet.classList.remove("is-dragging");

    try {
      button.releasePointerCapture(event.pointerId);
    } catch (error) {
      // The capture may already have been released.
    }

    if (moved) {
      suppressClickUntil = performance.now() + 450;
      snapAfterDrag();
    }
  }

  button.addEventListener("pointerdown", beginDrag);
  button.addEventListener("pointermove", moveDrag);
  button.addEventListener("pointerup", endDrag);
  button.addEventListener("pointercancel", endDrag);

  button.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) {
      event.preventDefault();
      return;
    }
    playRandomAction();
  });

  window.addEventListener("pointermove", trackPointer, { passive: true });
  window.addEventListener("scroll", schedulePerchUpdate, { passive: true });
  window.addEventListener("resize", schedulePerchUpdate);
})();
