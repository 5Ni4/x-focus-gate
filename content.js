(() => {
  "use strict";

  const DEFAULT_SETTINGS = {
    enabled: true,
    intervalMinutes: 10,
    gateOnOpen: true
  };
  const VALID_INTERVALS = new Set([1, 3, 5, 10, 15]);

  const HOST_ATTRIBUTE = "data-x-focus-gate-host";
  const ROUTE_CHECK_MS = 700;
  const INTERVAL_CHECK_MS = 15_000;
  const GATE_REPAIR_MS = 250;
  const BLOCKED_EVENT_TYPES = [
    "click",
    "dblclick",
    "pointerdown",
    "pointerup",
    "pointermove",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchmove",
    "touchend",
    "wheel",
    "contextmenu",
    "dragstart",
    "drop",
    "selectstart",
    "keydown",
    "keypress",
    "keyup"
  ];
  const HOST_STYLE = [
    "position: fixed !important",
    "inset: 0 !important",
    "display: block !important",
    "width: 100vw !important",
    "height: 100vh !important",
    "z-index: 2147483647 !important",
    "pointer-events: auto !important",
    "visibility: visible !important",
    "opacity: 1 !important"
  ].join("; ");

  let settings = { ...DEFAULT_SETTINGS };
  let settingsReady = false;
  let previousUrl = window.location.href;
  let wasProtectedXPage = isProtectedXPage();
  let overlay = null;
  let currentProblem = null;
  let lastSolvedAt = 0;
  let documentObserver = null;
  let gateObserver = null;
  let repairTimer = 0;

  void start();

  async function start() {
    installEventGuards();
    installDocumentObserver();
    window.setInterval(() => {
      if (overlay) ensureGate();
    }, GATE_REPAIR_MS);

    settings = await loadSettings();
    settingsReady = true;

    if (settings.enabled && settings.gateOnOpen && isProtectedXPage()) {
      showGate("open");
    }

    window.setInterval(checkRoute, ROUTE_CHECK_MS);
    window.setInterval(checkTimedGate, INTERVAL_CHECK_MS);

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      if (changes.enabled) {
        settings.enabled = Boolean(changes.enabled.newValue);
        if (!settings.enabled) removeGate();
      }

      if (changes.intervalMinutes) {
        const nextInterval = Number(changes.intervalMinutes.newValue);
        settings.intervalMinutes = VALID_INTERVALS.has(nextInterval)
          ? nextInterval
          : DEFAULT_SETTINGS.intervalMinutes;
      }

      if (changes.gateOnOpen) {
        settings.gateOnOpen = changes.gateOnOpen.newValue !== false;
      }
    });
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
    const storedInterval = Number(stored.intervalMinutes);
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      intervalMinutes: VALID_INTERVALS.has(storedInterval)
        ? storedInterval
        : DEFAULT_SETTINGS.intervalMinutes
    };
  }

  function checkRoute() {
    if (!settingsReady) return;

    const currentUrl = window.location.href;
    if (currentUrl === previousUrl) return;

    const onProtectedXPage = isProtectedXPage();
    previousUrl = currentUrl;

    if (!onProtectedXPage) {
      wasProtectedXPage = false;
      removeGate();
      return;
    }

    if (!wasProtectedXPage && settings.enabled && settings.gateOnOpen) {
      showGate("open");
    }

    wasProtectedXPage = true;
  }

  function checkTimedGate() {
    if (!settingsReady || !settings.enabled || !isProtectedXPage()) return;
    if (!lastSolvedAt || overlay || settings.intervalMinutes <= 0) return;

    const elapsed = Date.now() - lastSolvedAt;
    if (elapsed >= settings.intervalMinutes * 60_000) {
      showGate("interval");
    }
  }

  function isProtectedXPage() {
    const host = window.location.hostname;
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const isXHost = host === "x.com" || host === "twitter.com";
    const isAuthPage = ["/i/flow/login", "/i/flow/signup", "/account/access"]
      .some((prefix) => path.startsWith(prefix));
    return isXHost && !isAuthPage;
  }

  function showGate(reason, force = false) {
    if (overlay) {
      ensureGate();
      return;
    }

    if (!force && (!settings.enabled || !isProtectedXPage())) return;

    currentProblem = createProblem();

    const host = document.createElement("div");
    host.setAttribute(HOST_ATTRIBUTE, "");
    host.setAttribute("aria-hidden", "false");

    const shadowRoot = host.attachShadow({ mode: "closed" });
    overlay = {
      host,
      shadowRoot,
      root: null,
      problemElement: null,
      form: null,
      input: null,
      submit: null,
      status: null
    };

    repairHostStyle();
    document.documentElement.appendChild(host);
    mountGateContents();
    observeGate();
  }

  function mountGateContents() {
    if (!overlay || !currentProblem) return;

    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = chrome.runtime.getURL("styles.css");

    const root = document.createElement("div");
    root.className = "x-focus-gate-overlay";
    root.style.cssText = [
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "display: grid",
      "place-items: center",
      "width: 100vw",
      "height: 100vh",
      "box-sizing: border-box",
      "pointer-events: auto"
    ].join("; ");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "解け！");
    root.innerHTML = `
      <div class="x-focus-gate-card">
        <h1 id="x-focus-gate-title">解け！</h1>
        <div class="x-focus-gate-problem" aria-live="polite"></div>
        <form class="x-focus-gate-form">
          <label class="x-focus-gate-label visually-hidden" for="x-focus-gate-answer">答え</label>
          <div class="x-focus-gate-input-row">
            <input
              id="x-focus-gate-answer"
              class="x-focus-gate-input"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              aria-describedby="x-focus-gate-status"
            />
            <button class="x-focus-gate-submit" type="submit">回答</button>
          </div>
          <p id="x-focus-gate-status" class="x-focus-gate-status" role="status"></p>
        </form>
      </div>
    `;

    overlay.shadowRoot.replaceChildren(stylesheet, root);

    const problemElement = root.querySelector(".x-focus-gate-problem");
    const form = root.querySelector(".x-focus-gate-form");
    const input = root.querySelector(".x-focus-gate-input");
    const submit = root.querySelector(".x-focus-gate-submit");
    const status = root.querySelector(".x-focus-gate-status");

    overlay.root = root;
    overlay.problemElement = problemElement;
    overlay.form = form;
    overlay.input = input;
    overlay.submit = submit;
    overlay.status = status;

    problemElement.textContent = currentProblem.display;
    input.focus();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const answer = parseAnswer(input.value);

      if (answer === null) {
        status.textContent = "数値を入力してください。";
        input.focus();
        return;
      }

      if (answer !== currentProblem.answer) {
        status.textContent = "不正解です。";
        input.select();
        return;
      }

      submit.disabled = true;
      status.textContent = "正解。";
      lastSolvedAt = Date.now();
      window.setTimeout(removeGate, 180);
    });

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        status.textContent = "回答してください。";
      }
    });
  }

  function removeGate() {
    if (!overlay) return;

    gateObserver?.disconnect();
    gateObserver = null;
    overlay.host.remove();
    overlay = null;
    currentProblem = null;
  }

  function installDocumentObserver() {
    if (documentObserver || !document.documentElement) return;

    documentObserver = new MutationObserver(scheduleGateRepair);
    documentObserver.observe(document.documentElement, { childList: true });
  }

  function observeGate() {
    gateObserver?.disconnect();
    if (!overlay) return;

    gateObserver = new MutationObserver(scheduleGateRepair);
    gateObserver.observe(overlay.host, {
      attributes: true,
      attributeFilter: ["style", "hidden", "aria-hidden"],
      childList: true,
      subtree: true
    });
    gateObserver.observe(overlay.shadowRoot, {
      attributes: true,
      attributeFilter: ["style", "class", "hidden", "aria-hidden"],
      childList: true,
      subtree: true
    });
  }

  function scheduleGateRepair() {
    if (repairTimer || !overlay) return;

    repairTimer = window.setTimeout(() => {
      repairTimer = 0;
      ensureGate();
    }, 0);
  }

  function ensureGate() {
    if (!overlay || !currentProblem) return;

    if (overlay.host.parentNode !== document.documentElement) {
      document.documentElement.appendChild(overlay.host);
    }

    repairHostStyle();

    const requiredNodesExist = [
      overlay.root,
      overlay.problemElement,
      overlay.form,
      overlay.input,
      overlay.submit,
      overlay.status
    ].every((node) => node?.isConnected);

    if (!requiredNodesExist) {
      mountGateContents();
      return;
    }

    if (overlay.problemElement.textContent !== currentProblem.display) {
      overlay.problemElement.textContent = currentProblem.display;
    }

    const rootStyle = window.getComputedStyle(overlay.root);
    const rootIsHidden =
      rootStyle.display === "none" ||
      rootStyle.visibility === "hidden" ||
      rootStyle.pointerEvents === "none" ||
      Number.parseFloat(rootStyle.opacity) === 0;

    if (rootIsHidden) mountGateContents();
  }

  function repairHostStyle() {
    if (!overlay) return;

    const currentStyle = overlay.host.getAttribute("style");
    if (currentStyle !== HOST_STYLE) {
      overlay.host.setAttribute("style", HOST_STYLE);
    }
  }

  function installEventGuards() {
    const guard = (event) => {
      if (!overlay || isEventInsideGate(event)) return;

      event.preventDefault();
      event.stopImmediatePropagation();
    };

    for (const eventType of BLOCKED_EVENT_TYPES) {
      window.addEventListener(eventType, guard, {
        capture: true,
        passive: false
      });
    }

    window.addEventListener(
      "focusin",
      (event) => {
        if (!overlay || isEventInsideGate(event)) return;

        event.stopImmediatePropagation();
        window.setTimeout(() => overlay?.input?.focus(), 0);
      },
      true
    );
  }

  function isEventInsideGate(event) {
    if (!overlay?.host) return false;
    if (event.target === overlay.host) return true;

    return (
      typeof event.composedPath === "function" &&
      event.composedPath().includes(overlay.host)
    );
  }

  function parseAnswer(value) {
    const normalized = String(value)
      .trim()
      .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
      .replace(/[，,\s]/g, "");

    if (!/^-?\d+$/.test(normalized)) return null;

    const answer = Number(normalized);
    return Number.isSafeInteger(answer) ? answer : null;
  }

  function createProblem() {
    const operation = pick(["+", "+", "-", "×", "÷"]);
    let a;
    let b;
    let answer;

    if (operation === "+") {
      a = randomInt(10_000, 99_999);
      b = randomInt(100, 9_999);
      answer = a + b;
    } else if (operation === "-") {
      a = randomInt(10_000, 99_999);
      b = randomInt(100, Math.min(9_999, a - 1));
      answer = a - b;
    } else if (operation === "×") {
      a = randomInt(10_000, 99_999);
      b = randomInt(2, 12);
      answer = a * b;
    } else {
      b = randomInt(2, 9);
      const quotient = randomInt(Math.ceil(10_000 / b), Math.floor(99_999 / b));
      a = quotient * b;
      answer = quotient;
    }

    return {
      display: `${formatNumber(a)} ${operation} ${formatNumber(b)} = ?`,
      answer
    };
  }

  function formatNumber(value) {
    return value.toLocaleString("ja-JP");
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pick(items) {
    return items[randomInt(0, items.length - 1)];
  }
})();
