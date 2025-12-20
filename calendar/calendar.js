// Handles rendering and interactivity for the advent calendar experience.

const ORDER = [7, 22, 1, 14, 9, 18, 3, 24, 6, 13, 2, 17, 10, 5, 20, 11, 4, 16, 8, 21, 12, 19, 15, 23];
const TOTAL_DAYS = ORDER.length;
const ENFORCE_SERVER_DATE_LIMIT = true; // Flip to false for testing to keep every day clickable.
const ENCRYPTED_DIR = "images";
const FINAL_MESSAGE_URL = "messages/finale.json";
const STORAGE_KEY = "calendarUnlocked";
const FINAL_MESSAGE_STORAGE_KEY = "calendarFinalMessage";
const TIME_API_ENDPOINT = "https://worldtimeapi.org/api/timezone/Europe/Prague";

// Cached DOM lookups
const grid = document.getElementById("grid");
const modal = document.getElementById("dayModal");
const modalTitle = document.getElementById("modalTitle");
const dayImage = document.getElementById("dayImage");
const dayInput = document.getElementById("dayInput");
const submitNote = document.getElementById("submitNote");
const closeModal = document.getElementById("closeModal");
const unlockHint = document.getElementById("unlockHint");
const gamePanel = document.getElementById("gamePanel");
const replayGameLink = document.getElementById("replayGame");
const footerTrack = document.getElementById("footerTrack");
const footerRobot = document.getElementById("footerRobot");
const footerText = document.getElementById("footerText");
const lightsElement = document.querySelector(".lights");
const finalePanel = document.getElementById("finalePanel");
const finaleInput = document.getElementById("finaleInput");
const finaleSubmit = document.getElementById("finaleSubmit");
const finaleHint = document.getElementById("finaleHint");
const finaleMessage = document.getElementById("finaleMessage");

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const payloadCache = new Map();
const doorPreviewRefs = new Map();
const doorPreviewCache = new Map();
let activeObjectUrl = null;
let currentDay = null;
let storedPasswords = loadStoredPasswords();
let unityInstance = null;
let unityLoaderScript = null;
let unityMountedDay = null;
let dateGateReady = !ENFORCE_SERVER_DATE_LIMIT;
let maxActiveDay = ENFORCE_SERVER_DATE_LIMIT ? 0 : 24;
let footerRobotState = null;
let footerRobotControls = { left: false, right: false, jump: false };
let footerAnimationFrame = null;
let calendarComplete = false;
let finalMessagePayloadPromise = null;
let storedFinalMessage = loadStoredFinalMessage();
let attemptedFinalAutoReveal = false;

function renderDoors() {
  grid.innerHTML = "";
  ORDER.forEach((day) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "door";
    btn.setAttribute("aria-label", `Den ${day}`);
    btn.innerHTML = `<img class="door__preview" alt="" aria-hidden="true"><span>${day}</span>`;
    const previewImg = btn.querySelector(".door__preview");
    hydrateDoorPreview(day, previewImg, btn);
    btn.addEventListener("click", () => openDay(day));
    updateDoorInteractivity(day, btn);
    grid.appendChild(btn);
  });
}

function openDay(day) {
  currentDay = day;
  modalTitle.textContent = `Den ${day}`;
  resetModalState();
  setGameSource(day);
  modal.showModal();
  autoUnlockIfStored(day);
}

function resetModalState() {
  if (!modal.open) {
    teardownUnity();
  }
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
  dayImage.removeAttribute("src");
  dayImage.alt = "";
  dayImage.hidden = true;
  dayImage.setAttribute("aria-hidden", "true");
  dayInput.value = "";
  unlockHint.style.display = "none";
  gamePanel.hidden = false;
  replayGameLink.hidden = true;
}

function base64ToArrayBuffer(str) {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function loadEncryptedPayload(day) {
  if (!payloadCache.has(day)) {
    const url = `${ENCRYPTED_DIR}/${day}.json`;
    const request = fetch(url).then((response) => {
      if (!response.ok) {
        throw new Error(`Nepodarilo se nacist sifrovany soubor: ${url}`);
      }
      return response.json();
    });
    payloadCache.set(day, request);
  }
  return payloadCache.get(day);
}

async function decryptImage(password, day) {
  if (!window.crypto?.subtle) {
    throw new Error("Prohlizec nepodporuje Web Crypto API.");
  }
  if (!password) {
    throw new Error("Chybi heslo.");
  }

  const payload = await loadEncryptedPayload(day);
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToArrayBuffer(payload.salt),
      iterations: payload.iterations,
      hash: "SHA-1",
    },
    keyMaterial,
    { name: "AES-CBC", length: 256 },
    false,
    ["decrypt"],
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-CBC",
      iv: base64ToArrayBuffer(payload.iv),
    },
    key,
    base64ToArrayBuffer(payload.data),
  );

  const contentType = payload.contentType || "image/png";
  return new Blob([decrypted], { type: contentType });
}

async function showImageForPassword(password, day) {
  const blob = await decryptImage(password, day);
  const url = URL.createObjectURL(blob);
  unlockHint.style.display = "none";
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
  }
  activeObjectUrl = url;
  dayImage.src = url;
  dayImage.alt = `Obrazek pro den ${day}`;
  dayImage.hidden = false;
  dayImage.removeAttribute("aria-hidden");
  gamePanel.hidden = true;
  replayGameLink.hidden = false;
  setDoorPreview(day, blob);
}

async function handleUnlock(event) {
  event.preventDefault();
  if (currentDay == null) {
    return;
  }

  submitNote.disabled = true;
  const password = dayInput.value.trim();

  try {
    await showImageForPassword(password, currentDay);
    rememberPassword(currentDay, password);
  } catch (error) {
    console.error("Decrypt failed", error);
    unlockHint.style.display = "inline";
    dayInput.focus();
  } finally {
    submitNote.disabled = false;
  }
}

function registerEvents() {
  submitNote.addEventListener("click", handleUnlock);
  ["keydown", "keypress", "keyup"].forEach((type) => {
    dayInput.addEventListener(
      type,
      (event) => {
        if (type === "keydown" && event.key === "Enter") {
          handleUnlock(event);
        }
        // Stop Unity's global listeners from stealing keyboard events while typing.
        event.stopPropagation();
      },
      true,
    );
  });
  closeModal.addEventListener("click", () => modal.close());
  modal.addEventListener("close", () => {
    resetModalState();
    teardownUnity();
  });
  if (finaleSubmit && finaleInput) {
    const submitFinale = (event) => {
      if (event) {
        event.preventDefault();
      }
      handleFinaleUnlock();
    };
    finaleSubmit.addEventListener("click", submitFinale);
    finaleInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        submitFinale(event);
      }
    });
  }
}

function initSnow() {
  const holder = document.getElementById("snow");
  const count = (60 * (currentDay || 1))%1000;
  for (let i = 0; i < count; i++) {
    const flake = document.createElement("i");
    flake.className = "flake";
    flake.style.left = Math.random() * 100 + "vw";
    flake.style.animationDuration = 6 + Math.random() * 12 + "s";
    flake.style.opacity = (0.4 + Math.random() * 0.6).toFixed(2);
    flake.style.width = flake.style.height = 2 + Math.random() * 4 + "px";
    holder.appendChild(flake);
  }
}

renderDoors();
updateCompletionState();
registerEvents();
initSnow();
bootstrapUnlockedPreviews();
initDateGate();
initFooterRobotEasterEgg();

function loadStoredPasswords() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistPasswords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storedPasswords));
  } catch {
    // Ignore storage failures (e.g., disabled cookies)
  }
}

function rememberPassword(day, password) {
  if (!password) {
    return;
  }
  storedPasswords[day] = password;
  persistPasswords();
}

function forgetPassword(day) {
  if (storedPasswords[day]) {
    delete storedPasswords[day];
    persistPasswords();
    clearDoorPreview(day);
  }
}

async function autoUnlockIfStored(day) {
  const cached = storedPasswords[day];
  if (!cached) {
    return;
  }
  submitNote.disabled = true;
  try {
    dayInput.value = cached;
    await showImageForPassword(cached, day);
  } catch (error) {
    console.warn("Cached password invalid, clearing entry.", error);
    forgetPassword(day);
  } finally {
    submitNote.disabled = false;
  }
}

function setGameSource(day) {
  const url = `games/${day}/index.html`;
  replayGameLink.href = url;
  mountUnityGame(day);
}

function mountUnityGame(day) {
  teardownUnity();
  unityMountedDay = day;
  gamePanel.innerHTML = `
    <div class="unity-shell">
      <canvas id="unity-canvas" tabindex="-1"></canvas>
      <div id="unity-loading-bar" class="unity-loading">
        <div id="unity-progress-bar-empty">
          <div id="unity-progress-bar-full"></div>
        </div>
      </div>
      <div id="unity-warning" class="unity-warning"></div>
    </div>
  `;

  const canvas = gamePanel.querySelector("#unity-canvas");
  const loadingBar = gamePanel.querySelector("#unity-loading-bar");
  const progressBarFull = gamePanel.querySelector("#unity-progress-bar-full");
  const warningBanner = gamePanel.querySelector("#unity-warning");

  const unityShowBanner = (msg, type) => {
    warningBanner.textContent = msg || "";
    warningBanner.classList.toggle("error", type === "error");
    warningBanner.classList.toggle("warning", type === "warning");
    warningBanner.style.display = msg ? "block" : "none";
    if (msg && type !== "error") {
      setTimeout(() => {
        warningBanner.textContent = "";
        warningBanner.style.display = "none";
      }, 5000);
    }
  };

  const buildName = `Day_${day}`;
  const baseUrl = `games/${day}`;
  const buildUrl = `${baseUrl}/Build`;
  const loaderUrl = `${buildUrl}/${buildName}.loader.js`;
  const config = {
    arguments: [],
    dataUrl: `${buildUrl}/${buildName}.data.unityweb`,
    frameworkUrl: `${buildUrl}/${buildName}.framework.js.unityweb`,
    codeUrl: `${buildUrl}/${buildName}.wasm.unityweb`,
    streamingAssetsUrl: `${baseUrl}/StreamingAssets`,
    companyName: "DefaultCompany",
    productName: "Project Radiance",
    productVersion: "1.0",
    showBanner: unityShowBanner,
    matchWebGLToCanvasSize: true,
  };

  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  loadingBar.style.display = "block";

  const script = document.createElement("script");
  unityLoaderScript = script;
  script.src = loaderUrl;
  script.onload = () => {
    createUnityInstance(canvas, config, (progress) => {
      progressBarFull.style.width = 100 * progress + "%";
    })
      .then((instance) => {
        unityInstance = instance;
        loadingBar.style.display = "none";
      })
      .catch((message) => {
        alert(message);
      });
  };
  script.onerror = () => {
    unityShowBanner("Nepodarilo se nacist hru.", "error");
    loadingBar.style.display = "none";
  };
  document.body.appendChild(script);
}

function teardownUnity() {
  unityMountedDay = null;
  if (unityInstance?.Quit) {
    unityInstance.Quit().catch(() => {});
  }
  unityInstance = null;
  if (unityLoaderScript?.parentNode) {
    unityLoaderScript.parentNode.removeChild(unityLoaderScript);
  }
  unityLoaderScript = null;
  gamePanel.innerHTML = "";
}

function updateDoorInteractivity(day, button) {
  const isUnlocked = isDayUnlocked(day);
  button.disabled = !isUnlocked;
  button.classList.toggle("door--locked", !isUnlocked);
}

function applyDoorLockState() {
  doorPreviewRefs.forEach(({ button }, day) => {
    if (button) {
      updateDoorInteractivity(day, button);
    }
  });
}

function isDayUnlocked(day) {
  if (!ENFORCE_SERVER_DATE_LIMIT) {
    return true;
  }
  if (!dateGateReady) {
    return false;
  }
  return day <= maxActiveDay;
}

async function initDateGate() {
  if (!ENFORCE_SERVER_DATE_LIMIT) {
    return;
  }
  try {
    const serverCalendarInfo = await fetchServerCalendarInfo();
    maxActiveDay = deriveMaxActiveDay(serverCalendarInfo);
  } catch (error) {
    console.warn("Server date lookup failed, falling back to client clock.", error);
    maxActiveDay = deriveMaxActiveDay(createCalendarInfoFromDate(new Date()));
  } finally {
    dateGateReady = true;
    applyDoorLockState();
  }
}

async function fetchServerCalendarInfo() {
  const response = await fetch(TIME_API_ENDPOINT, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Time endpoint responded with ${response.status}`);
  }
  const payload = await response.json();
  if (typeof payload.datetime !== "string" || payload.datetime.length < 10) {
    throw new Error("Time endpoint response missing datetime.");
  }

  const isoDate = payload.datetime;
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  if (Number.isNaN(month) || Number.isNaN(day)) {
    throw new Error("Unable to parse datetime from server.");
  }
  return { month, day };
}

function deriveMaxActiveDay(calendarInfo) {
  if (!calendarInfo) {
    return 24;
  }
  const monthIndex = Number(calendarInfo.month) - 1;
  const day = Number(calendarInfo.day);
  if (Number.isNaN(monthIndex) || Number.isNaN(day)) {
    return 24;
  }
  if (monthIndex < 11) {
    return 0;
  }
  if (monthIndex > 11) {
    return 24;
  }
  return Math.max(0, Math.min(day, 24));
}

function createCalendarInfoFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return { month: 1, day: 0 };
  }
  return {
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function hydrateDoorPreview(day, imgEl, button) {
  doorPreviewRefs.set(day, { imgEl, button });
  const cachedUrl = doorPreviewCache.get(day.toString());
  if (cachedUrl) {
    imgEl.src = cachedUrl;
    button.classList.add("has-preview");
  }
}

function setDoorPreview(day, blob) {
  const key = day.toString();
  const existing = doorPreviewCache.get(key);
  if (existing) {
    URL.revokeObjectURL(existing);
  }
  const previewUrl = URL.createObjectURL(blob);
  doorPreviewCache.set(key, previewUrl);
  const refs = doorPreviewRefs.get(day);
  if (refs) {
    refs.imgEl.src = previewUrl;
    refs.button.classList.add("has-preview");
  }
  updateCompletionState();
}

function clearDoorPreview(day) {
  const key = day.toString();
  const cached = doorPreviewCache.get(key);
  if (cached) {
    URL.revokeObjectURL(cached);
    doorPreviewCache.delete(key);
  }
  const refs = doorPreviewRefs.get(day);
  if (refs) {
    refs.imgEl.removeAttribute("src");
    refs.button.classList.remove("has-preview");
  }
  updateCompletionState();
}

function hasDoorPreview(day) {
  return doorPreviewCache.has(day.toString());
}

function updateCompletionState() {
  if (!grid) {
    return;
  }
  const complete = doorPreviewCache.size >= TOTAL_DAYS && ORDER.every(hasDoorPreview);
  if (complete === calendarComplete) {
    return;
  }
  calendarComplete = complete;
  grid.classList.toggle("grid--complete", complete);
  toggleFinalePanel(complete);
}

async function bootstrapUnlockedPreviews() {
  const entries = Object.entries(storedPasswords);
  for (const [dayStr, password] of entries) {
    const dayNum = Number(dayStr);
    if (!password || Number.isNaN(dayNum)) {
      continue;
    }
    try {
      const blob = await decryptImage(password, dayNum);
      setDoorPreview(dayNum, blob);
    } catch (error) {
      console.warn(`Failed to restore preview for day ${dayNum}`, error);
      forgetPassword(dayNum);
    }
  }
}

function loadFinalMessagePayload() {
  if (!finalMessagePayloadPromise) {
    finalMessagePayloadPromise = fetch(FINAL_MESSAGE_URL, { cache: "no-store" }).then((response) => {
      if (!response.ok) {
        throw new Error(`Nepodarilo se nacist tajnou zpravu: ${response.status}`);
      }
      return response.json();
    });
  }
  return finalMessagePayloadPromise;
}

async function decryptFinalMessage(password) {
  if (!window.crypto?.subtle) {
    throw new Error("Prohlizec nepodporuje Web Crypto API.");
  }
  if (!password) {
    throw new Error("Chybi heslo.");
  }
  const payload = await loadFinalMessagePayload();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: base64ToArrayBuffer(payload.salt),
      iterations: payload.iterations,
      hash: "SHA-1",
    },
    keyMaterial,
    { name: "AES-CBC", length: 256 },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-CBC",
      iv: base64ToArrayBuffer(payload.iv),
    },
    key,
    base64ToArrayBuffer(payload.data),
  );
  return decoder.decode(new Uint8Array(decrypted));
}

async function handleFinaleUnlock() {
  if (!calendarComplete || !finaleInput || !finaleSubmit) {
    return;
  }
  const password = finaleInput.value.trim();
  if (!password) {
    finaleInput.focus();
    return;
  }
  setFinaleHintMessage("");
  setFinaleLoading(true);
  try {
    const message = await decryptFinalMessage(password);
    showFinalMessage(message);
    rememberFinalMessage(password, message);
  } catch (error) {
    console.error("Final message decrypt failed", error);
    setFinaleHintMessage("Nesprávný kód. Zkus to znovu.");
    finaleInput.focus();
  } finally {
    setFinaleLoading(false);
  }
}

function showFinalMessage(text) {
  if (!finaleMessage || !finalePanel) {
    return;
  }
  finaleMessage.innerHTML = text;
  finaleMessage.hidden = false;
  finalePanel.classList.add("finale-panel--unlocked");
  setFinaleHintMessage("");
}

function setFinaleLoading(isLoading) {
  if (finaleSubmit) {
    finaleSubmit.disabled = isLoading;
  }
  if (finaleInput) {
    finaleInput.disabled = isLoading;
  }
}

function setFinaleHintMessage(text) {
  if (!finaleHint) {
    return;
  }
  if (!text) {
    finaleHint.textContent = "";
    finaleHint.hidden = true;
    return;
  }
  finaleHint.textContent = text;
  finaleHint.hidden = false;
}

function toggleFinalePanel(show) {
  if (!finalePanel) {
    return;
  }
  finalePanel.hidden = !show;
  if (show && !attemptedFinalAutoReveal) {
    attemptedFinalAutoReveal = true;
    autoRevealFinalMessage();
  } else if (!show) {
    attemptedFinalAutoReveal = false;
    setFinaleHintMessage("");
    if (finaleInput) {
      finaleInput.value = "";
      finaleInput.disabled = false;
    }
    if (finaleMessage) {
      finaleMessage.hidden = true;
      finaleMessage.textContent = "";
    }
    finalePanel.classList.remove("finale-panel--unlocked");
  }
}

async function autoRevealFinalMessage() {
  if (!storedFinalMessage) {
    return;
  }
  if (storedFinalMessage.text) {
    showFinalMessage(storedFinalMessage.text);
  }
  if (!storedFinalMessage.password) {
    return;
  }
  try {
    setFinaleLoading(true);
    const message = await decryptFinalMessage(storedFinalMessage.password);
    showFinalMessage(message);
    rememberFinalMessage(storedFinalMessage.password, message);
    if (finaleInput) {
      finaleInput.value = storedFinalMessage.password;
    }
  } catch (error) {
    console.warn("Stored finale password invalid, clearing entry.", error);
    forgetFinalMessage();
    if (finaleInput) {
      finaleInput.value = "";
    }
  } finally {
    setFinaleLoading(false);
  }
}

function rememberFinalMessage(password, message) {
  storedFinalMessage = { password, text: message };
  persistFinalMessage();
}

function persistFinalMessage() {
  try {
    if (storedFinalMessage) {
      localStorage.setItem(FINAL_MESSAGE_STORAGE_KEY, JSON.stringify(storedFinalMessage));
    } else {
      localStorage.removeItem(FINAL_MESSAGE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

function loadStoredFinalMessage() {
  try {
    const raw = localStorage.getItem(FINAL_MESSAGE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function forgetFinalMessage() {
  storedFinalMessage = null;
  persistFinalMessage();
  if (finaleMessage) {
    finaleMessage.hidden = true;
    finaleMessage.textContent = "";
  }
  if (finalePanel) {
    finalePanel.classList.remove("finale-panel--unlocked");
  }
}

function initFooterRobotEasterEgg() {
  if (!footerTrack || !footerRobot || !footerText) {
    return;
  }
  footerRobotState = createFooterRobotState();
  applyFooterRobotTransforms();
  window.addEventListener("keydown", handleFooterRobotKeyDown);
  window.addEventListener("keyup", handleFooterRobotKeyUp);
  window.addEventListener("resize", () => {
    if (!footerRobotState) {
      return;
    }
    recalcFooterRobotStage();
  });
  footerAnimationFrame = requestAnimationFrame(stepFooterRobot);
}

function createFooterRobotState() {
  const margin = 0;
  const trackWidth = getFooterTrackWidth();
  const robotWidth = footerRobot.offsetWidth || 36;
  const robotHeight = footerRobot.offsetHeight || 36;
  const textWidth = footerText.offsetWidth || 150;
  const usableWidth = trackWidth;
  const textStart = clampValue((usableWidth - textWidth) / 2, 0, Math.max(usableWidth - textWidth, 0));
  const startOnLeft = Math.random() < 0.5;
  const startX = startOnLeft ? 0 : Math.max(usableWidth - robotWidth, 0);
  return {
    margin,
    trackWidth,
    usableWidth,
    robotWidth,
    robotHeight,
    textWidth,
    robotX: startX,
    robotY: 0,
    robotVX: 0,
    robotVY: 0,
    textX: textStart,
    textVX: 0,
    grounded: true,
    currentPlatform: null,
    lastTextEdge: null,
    facing: startOnLeft ? "right" : "left",
  };
}

function handleFooterRobotKeyDown(event) {
  if (!footerRobotState || isTypingTarget(event.target)) {
    return;
  }
  if (event.code === "ArrowLeft" || event.code === "ArrowRight" || event.code === "Space") {
    event.preventDefault();
  }
  if (event.code === "ArrowLeft") {
    footerRobotControls.left = true;
  }
  if (event.code === "ArrowRight") {
    footerRobotControls.right = true;
  }
  if (event.code === "Space") {
    footerRobotControls.jump = true;
  }
}

function handleFooterRobotKeyUp(event) {
  if (!footerRobotState) {
    return;
  }
  if (event.code === "ArrowLeft") {
    footerRobotControls.left = false;
  }
  if (event.code === "ArrowRight") {
    footerRobotControls.right = false;
  }
  if (event.code === "Space") {
    footerRobotControls.jump = false;
  }
}

function stepFooterRobot() {
  if (!footerRobotState) {
    return;
  }
  updateFooterRobotPhysics();
  applyFooterRobotTransforms();
  footerAnimationFrame = requestAnimationFrame(stepFooterRobot);
}

function updateFooterRobotPhysics() {
  const state = footerRobotState;
  const controls = footerRobotControls;
  const ACCEL = 0.28;
  const FRICTION = 0.86;
  const MAX_SPEED = 3.4;
  const GRAVITY = -0.3;
  const JUMP_FORCE = 5.5;
  const TEXT_PLATFORM_MARGIN = 5;

  if (controls.left) {
    state.robotVX = Math.max(state.robotVX - ACCEL, -MAX_SPEED);
  }
  if (controls.right) {
    state.robotVX = Math.min(state.robotVX + ACCEL, MAX_SPEED);
  }
  if (!controls.left && !controls.right) {
    state.robotVX *= FRICTION;
    if (Math.abs(state.robotVX) < 0.01) {
      state.robotVX = 0;
    }
  }

  if (controls.jump && state.grounded) {
    state.robotVY = JUMP_FORCE;
    state.grounded = false;
  }
  if (!state.grounded) {
    state.robotVY += GRAVITY;
  }
  state.robotY += state.robotVY;
  let groundedNow = false;
  const platform = getFooterPlatformCollision(state, TEXT_PLATFORM_MARGIN);
  if (platform?.landed) {
    state.robotY = platform.height;
    if (state.robotVY < 0) {
      state.robotVY = 0;
    }
    groundedNow = true;
    state.currentPlatform = platform.id;
  } else if (state.robotY <= 0) {
    state.robotY = 0;
    if (state.robotVY < 0) {
      state.robotVY = 0;
    }
    groundedNow = true;
    state.currentPlatform = null;
  } else {
    state.currentPlatform = null;
  }
  state.grounded = groundedNow;

  state.robotX += state.robotVX;
  const maxRobotX = Math.max(state.usableWidth - state.robotWidth, 0);
  if (state.robotX < 0) {
    state.robotX = 0;
    state.robotVX = 0;
  } else if (state.robotX > maxRobotX) {
    state.robotX = maxRobotX;
    state.robotVX = 0;
  }
  if (state.robotVX > 0.1) {
    state.facing = "right";
  } else if (state.robotVX < -0.1) {
    state.facing = "left";
  }

  state.textWidth = footerText.offsetWidth || state.textWidth;
  state.textVX *= 0.9;
  handleFooterTextCollision(state, controls);
  state.textX += state.textVX;
  const maxTextX = Math.max(state.usableWidth - state.textWidth, 0);
  if (state.textX < 0) {
    state.textX = 0;
    state.textVX = 0;
  } else if (state.textX > maxTextX) {
    state.textX = maxTextX;
    state.textVX = 0;
  }
  let currentEdge = null;
  if (state.textX <= 0) {
    currentEdge = "left";
  } else if (state.textX >= maxTextX) {
    currentEdge = "right";
  }
  if (currentEdge && currentEdge !== state.lastTextEdge) {
    triggerLights();
  }
  state.lastTextEdge = currentEdge;
}

function handleFooterTextCollision(state, controls) {
  const textMin = state.textX;
  const textMax = state.textX + state.textWidth;
  const robotMin = state.robotX;
  const robotMax = state.robotX + state.robotWidth;
  const verticalOverlap = state.robotY < state.robotHeight * 0.25;
  const horizontalContact = robotMax > textMin && robotMin < textMax;
  if (!horizontalContact || !verticalOverlap || state.currentPlatform === "text") {
    return;
  }
  const direction = resolveFooterDirection(state, controls);
  if (!direction) {
    return;
  }
  const overlap = direction > 0 ? robotMax - textMin : textMax - robotMin;
  state.textVX += direction * Math.min(Math.max(Math.abs(state.robotVX) * 0.4, 0.18), 1);
  if (direction > 0) {
    state.robotX -= overlap;
  } else {
    state.robotX += overlap;
  }
}

function resolveFooterDirection(state, controls) {
  if (state.robotVX > 0.05) {
    return 1;
  }
  if (state.robotVX < -0.05) {
    return -1;
  }
  if (controls.right && !controls.left) {
    return 1;
  }
  if (controls.left && !controls.right) {
    return -1;
  }
  return 0;
}

function applyFooterRobotTransforms() {
  if (!footerRobotState) {
    return;
  }
  const state = footerRobotState;
  footerRobot.style.left = `${state.robotX}px`;
  footerRobot.style.transform = `translate3d(0, ${-state.robotY}px, 0)`;
  footerRobot.classList.toggle("robot-left", state.facing === "left");
  footerText.style.left = `${state.textX}px`;
}

function recalcFooterRobotStage() {
  if (!footerRobotState) {
    return;
  }
  const state = footerRobotState;
  const previousUsable = state.usableWidth || 1;
  state.trackWidth = getFooterTrackWidth();
  state.usableWidth = state.trackWidth;
  const scale = previousUsable > 0 ? state.usableWidth / previousUsable : 1;
  state.robotWidth = footerRobot.offsetWidth || state.robotWidth;
  state.robotHeight = footerRobot.offsetHeight || state.robotHeight;
  state.textWidth = footerText.offsetWidth || state.textWidth;
  state.robotX = clampValue(state.robotX * scale, 0, Math.max(state.usableWidth - state.robotWidth, 0));
  state.textX = clampValue(state.textX * scale, 0, Math.max(state.usableWidth - state.textWidth, 0));
}

function isTypingTarget(element) {
  if (!element) {
    return false;
  }
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || element.isContentEditable;
}

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getFooterTrackWidth() {
  return footerTrack?.offsetWidth || Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0);
}

function getFooterPlatformCollision(state, margin) {
  const platformHeight = state.robotHeight * 0.5;
  const textMin = state.textX - margin;
  const textMax = state.textX + state.textWidth + margin;
  const robotMin = state.robotX;
  const robotMax = state.robotX + state.robotWidth;
  const robotCenter = robotMin + state.robotWidth / 2;
  const horizontalOverlap = robotCenter > textMin && robotCenter < textMax;
  const descending = state.robotVY <= 0;
  const nearPlatform = Math.abs(state.robotY - platformHeight) <= state.robotHeight * 0.35;
  if (!horizontalOverlap || !descending || !nearPlatform) {
    return null;
  }
  return {
    id: "text",
    landed: true,
    height: platformHeight,
  };
}

function triggerLights() {
  if (!lightsElement) {
    return;
  }
  lightsElement.classList.add("lights-on");
}
