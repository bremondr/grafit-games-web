// Handles rendering and interactivity for the advent calendar experience.

// Pre-generated day order so everyone sees the same randomized layout.
const ORDER = [7, 22, 1, 14, 9, 18, 3, 24, 6, 13, 2, 17, 10, 5, 20, 11, 4, 16, 8, 21, 12, 19, 15, 23];
const ENCRYPTED_DIR = "images";

// Cached DOM lookups
const grid = document.getElementById("grid");
const modal = document.getElementById("dayModal");
const modalTitle = document.getElementById("modalTitle");
const dayImage = document.getElementById("dayImage");
const dayInput = document.getElementById("dayInput");
const submitNote = document.getElementById("submitNote");
const closeModal = document.getElementById("closeModal");
const unlockHint = document.getElementById("unlockHint");
const playGameLink = document.getElementById("playGameLink");

const encoder = new TextEncoder();
const payloadCache = new Map();
let activeObjectUrl = null;
let currentDay = null;

// Render a button for each calendar day so the HTML stays minimal.
function renderDoors() {
  grid.innerHTML = "";
  ORDER.forEach((day) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "door";
    btn.setAttribute("aria-label", `${day}.12.`);
    btn.textContent = `${day}.12.`;
    btn.addEventListener("click", () => openDay(day));
    grid.appendChild(btn);
  });
}

// Inline SVG used as a "locked" preview until the user enters the password.
const LOCKED_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="338">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="#0f1730"/><stop offset="100%" stop-color="#172446"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/>` +
      `<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#f7c948" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="20">Zadej kód pro zobrazení</text>` +
      `</svg>`,
  );

function openDay(day) {
  currentDay = day;
  modalTitle.textContent = `${day}.12.`;
  playGameLink.href = `games/${day}/index.html`;
  resetModalState();
  modal.showModal();
}

function resetModalState() {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
  dayImage.src = LOCKED_PLACEHOLDER;
  dayInput.value = "";
  unlockHint.style.display = "none";
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
        throw new Error(`Nepodařilo se načíst šifrovaný soubor: ${url}`);
      }
      return response.json();
    });
    payloadCache.set(day, request);
  }
  return payloadCache.get(day);
}

async function decryptImage(password, day) {
  if (!window.crypto?.subtle) {
    throw new Error("Prohlížeč nepodporuje Web Crypto API.");
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
  const blob = new Blob([decrypted], { type: contentType });
  return URL.createObjectURL(blob);
}

async function handleUnlock(event) {
  event.preventDefault();
  if (currentDay == null) {
    return;
  }

  submitNote.disabled = true;

  try {
    const url = await decryptImage(dayInput.value.trim(), currentDay);
    unlockHint.style.display = "none";
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
    }
    activeObjectUrl = url;
    dayImage.src = url;
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

// Adds a handful of snowflakes for lightweight ambient motion.
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
