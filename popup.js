(() => {
  "use strict";

  const DEFAULT_SETTINGS = {
    enabled: true,
    intervalMinutes: 10,
    gateOnOpen: true
  };
  const VALID_INTERVALS = new Set([1, 3, 5, 10, 15]);

  const enabled = document.querySelector("#enabled");
  const intervalMinutes = document.querySelector("#intervalMinutes");
  const openXButton = document.querySelector("#openX");
  const status = document.querySelector("#status");

  void init();

  async function init() {
    const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
    enabled.checked = settings.enabled !== false;
    const storedInterval = Number(settings.intervalMinutes);
    const selectedInterval = VALID_INTERVALS.has(storedInterval)
      ? storedInterval
      : DEFAULT_SETTINGS.intervalMinutes;
    intervalMinutes.value = String(selectedInterval);

    if (selectedInterval !== storedInterval) {
      await save({ intervalMinutes: selectedInterval });
    }

    enabled.addEventListener("change", async () => {
      await save({ enabled: enabled.checked });
      showStatus(enabled.checked ? "チェックを有効にしました" : "チェックを無効にしました");
    });

    intervalMinutes.addEventListener("change", async () => {
      await save({ intervalMinutes: Number(intervalMinutes.value) || 0 });
      showStatus("設定を保存しました");
    });

    openXButton.addEventListener("click", () => {
      chrome.tabs.create({ url: "https://x.com/home" });
      window.close();
    });
  }

  async function save(values) {
    await chrome.storage.local.set(values);
  }

  function showStatus(message) {
    status.textContent = message;
    window.setTimeout(() => {
      if (status.textContent === message) status.textContent = "";
    }, 2_500);
  }
})();
