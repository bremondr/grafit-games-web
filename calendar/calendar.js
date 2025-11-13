// Handles rendering and interactivity for the advent calendar experience.

// Pre-generated day order so everyone sees the same randomized layout.
const ORDER = [7, 22, 1, 14, 9, 18, 3, 24, 6, 13, 2, 17, 10, 5, 20, 11, 4, 16, 8, 21, 12, 19, 15, 23];

// Cached DOM lookups
const grid = document.getElementById("grid");
const modal = document.getElementById("dayModal");
const modalTitle = document.getElementById("modalTitle");
const dayImage = document.getElementById("dayImage");
const dayInput = document.getElementById("dayInput");
const submitNote = document.getElementById("submitNote");
const closeModal = document.getElementById("closeModal");
const unlockHint = document.getElementById("unlockHint");

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
  modalTitle.textContent = `${day}.12.`;
  dayImage.src = LOCKED_PLACEHOLDER;
  dayInput.value = "";
  unlockHint.style.display = "none";
  modal.showModal();
}

function unlockImage() {
  const code = dayInput.value.trim();
  if (code === "heslo1234") {
    // Successful unlock reveals the actual PNG asset.
    dayImage.src = "../assets/graphic_text_min.png";
    unlockHint.style.display = "none";
  } else {
    // Show helper text and keep the modal open for another try.
    unlockHint.style.display = "inline";
    dayInput.focus();
  }
}

function registerEvents() {
  submitNote.addEventListener("click", unlockImage);
  closeModal.addEventListener("click", () => modal.close());
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
