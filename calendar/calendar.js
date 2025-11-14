// Handles rendering and interactivity for the advent calendar experience.

const ORDER = [7, 22, 1, 14, 9, 18, 3, 24, 6, 13, 2, 17, 10, 5, 20, 11, 4, 16, 8, 21, 12, 19, 15, 23];
const ENCRYPTED_DIR = "images";
const STORAGE_KEY = "calendarUnlocked";

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
const gameFrame = document.getElementById("gameFrame");
const replayGameLink = document.getElementById("replayGame");

const encoder = new TextEncoder();
const payloadCache = new Map();
const doorPreviewRefs = new Map();
const doorPreviewCache = new Map();
let activeObjectUrl = null;
let currentDay = null;
let storedPasswords = loadStoredPasswords();

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
    grid.appendChild(btn);
  });
}

function openDay(day) {
  currentDay = day;
  modalTitle.textContent = `Den ${day}`;
  setGameSource(day);
  resetModalState();
  modal.showModal();
  autoUnlockIfStored(day);
}

function resetModalState() {
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
        throw new Error(`Nepodarilo se nacíst šifrovaný soubor: ${url}`);
      }
      return response.json();
    });
    payloadCache.set(day, request);
  }
  return payloadCache.get(day);
}

async function decryptImage(password, day) {
  if (!window.crypto?.subtle) {
    throw new Error("Prohlížec nepodporuje Web Crypto API.");
  }
  if (!password) {
    throw new Error("Chybí heslo.");
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
  dayImage.alt = `Obrázek pro den ${day}`;
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
  dayInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleUnlock(event);
    }
  });
  closeModal.addEventListener("click", () => modal.close());
  modal.addEventListener("close", resetModalState);
}

function initSnow() {
  const holder = document.getElementById("snow");
  const count = 60;
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
registerEvents();
initSnow();
bootstrapUnlockedPreviews();

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
  gameFrame.src = url;
  replayGameLink.href = url;
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
