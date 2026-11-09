(() => {
  const pet = document.querySelector(".site-pet");
  if (!pet) return;

  const button = pet.querySelector(".site-pet-button");
  const bubble = pet.querySelector(".site-pet-bubble");
  if (!button || !bubble) return;

  const messages = [
    "汪！今天也要好好听歌。",
    "欧弟爱听，没办法。",
    "读书累了，就摸一会儿鱼吧。",
    "我在右下角陪你。",
    "要不要随机换一首？",
    "今天也要开心一点。"
  ];

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let hideTimer = 0;
  let lastMessage = -1;
  let bounceTimer = 0;

  function hideBubble() {
    window.clearTimeout(hideTimer);
    hideTimer = 0;
    bubble.classList.remove("is-visible");
  }

  function showBubble(message) {
    window.clearTimeout(hideTimer);
    bubble.textContent = message;
    bubble.classList.add("is-visible");
    hideTimer = window.setTimeout(hideBubble, 3800);
  }

  function pickMessage() {
    let next = Math.floor(Math.random() * messages.length);
    if (messages.length > 1 && next === lastMessage) {
      next = (next + 1) % messages.length;
    }
    lastMessage = next;
    return messages[next];
  }

  function bounce() {
    if (reduceMotion.matches) return;
    window.clearTimeout(bounceTimer);
    pet.classList.remove("is-petting");
    void pet.offsetWidth;
    pet.classList.add("is-petting");
    bounceTimer = window.setTimeout(() => pet.classList.remove("is-petting"), 650);
  }

  button.addEventListener("click", () => {
    showBubble(pickMessage());
    bounce();
  });

  button.addEventListener("pointerenter", () => {
    if (!bubble.classList.contains("is-visible")) {
      showBubble("汪！");
    }
  });

  button.addEventListener("focus", () => {
    if (!bubble.classList.contains("is-visible")) {
      showBubble("汪！");
    }
  });

  button.addEventListener("blur", hideBubble);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideBubble();
  });
})();
