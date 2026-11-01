const siteGate = document.querySelector("#site-gate");
const siteGateForm = document.querySelector("#site-gate-form");
const siteGatePassword = document.querySelector("#site-gate-password");
const siteGateStatus = document.querySelector("#site-gate-status");
const siteContent = document.querySelector("#site-content");
const gateStorageKey = "202410-site-access-granted";
const gatePassword = "pyaiod";

function unlockSite() {
  siteGate.hidden = true;
  siteContent.inert = false;
}

try {
  if (localStorage.getItem(gateStorageKey) === "true") {
    unlockSite();
  }
} catch (error) {
  console.error("无法读取访问验证状态", error);
  siteGateStatus.textContent = "浏览器无法读取记住状态，请输入密码继续。";
}

siteGateForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (siteGatePassword.value !== gatePassword) {
    siteGatePassword.value = "";
    siteGateStatus.textContent = "密码不正确，请重试。";
    siteGatePassword.focus();
    return;
  }

  try {
    localStorage.setItem(gateStorageKey, "true");
    siteGateStatus.textContent = "";
  } catch (error) {
    siteGateStatus.textContent = "验证成功，但浏览器无法记住访问状态。";
    console.error("无法保存访问验证状态", error);
  }

  unlockSite();
});
