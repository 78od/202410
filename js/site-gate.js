const siteGateScriptUrl = document.currentScript.src;
const dailyMusicAssetVersion = "ea44cf1b892b";
const gateStorageKey = "202410-site-access-granted";
const gatePassword = "pyaiod";
let playerScriptLoaded = false;

function unlockSite() {
  const gate = document.querySelector(".site-gate");
  if (gate) {
    gate.remove();
  }
  document.body.classList.remove("gated-page");
  if (!playerScriptLoaded && document.querySelector("#daily-song")) {
    const playerScript = document.createElement("script");
    const playerScriptUrl = new URL("daily-music.js", siteGateScriptUrl);
    playerScriptUrl.searchParams.set("v", dailyMusicAssetVersion);
    playerScript.src = playerScriptUrl.href;
    playerScript.defer = true;
    document.body.append(playerScript);
    playerScriptLoaded = true;
  }
}

function showPasswordGate() {
  const gate = document.createElement("div");
  gate.className = "site-gate";
  gate.setAttribute("role", "dialog");
  gate.setAttribute("aria-modal", "true");
  gate.setAttribute("aria-labelledby", "site-gate-title");

  const form = document.createElement("form");
  form.className = "site-gate-card";
  form.id = "site-gate-form";

  const heading = document.createElement("h1");
  heading.id = "site-gate-title";
  heading.textContent = "请输入访问密码";

  const label = document.createElement("label");
  label.className = "visually-hidden";
  label.htmlFor = "site-gate-password";
  label.textContent = "访问密码";

  const passwordInput = document.createElement("input");
  passwordInput.id = "site-gate-password";
  passwordInput.name = "password";
  passwordInput.type = "password";
  passwordInput.placeholder = "输入密码";
  passwordInput.autocomplete = "current-password";
  passwordInput.required = true;

  const submitButton = document.createElement("button");
  submitButton.className = "site-gate-submit";
  submitButton.type = "submit";
  submitButton.textContent = "进入主站";

  const status = document.createElement("p");
  status.className = "site-gate-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  form.append(heading, label, passwordInput, submitButton, status);
  gate.append(form);
  document.body.append(gate);
  passwordInput.focus();

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (passwordInput.value !== gatePassword) {
      passwordInput.value = "";
      status.textContent = "密码不正确，请重试。";
      passwordInput.focus();
      return;
    }

    try {
      localStorage.setItem(gateStorageKey, "true");
    } catch (error) {
      status.textContent = "验证成功，但浏览器无法记住访问状态。";
      console.error("无法保存访问验证状态", error);
    }

    unlockSite();
  });
}

try {
  if (localStorage.getItem(gateStorageKey) === "true") {
    unlockSite();
  } else {
    showPasswordGate();
  }
} catch (error) {
  console.error("无法读取访问验证状态", error);
  showPasswordGate();
}
