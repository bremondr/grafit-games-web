// Weekly themes of the advent calendar. Each theme restyles the page (palette in
// calendar.css under :root[data-theme="<id>"]) and tags the days it covers, so the
// games for those days can follow the same theme.
//
// To define a theme: set `name` (shown under the title; leave null to hide it) and
// edit the matching palette block in calendar.css. To change when themes switch,
// edit `startDay` (the first December day a theme is active).

const CALENDAR_THEMES = [
  { id: "theme-1", name: null, startDay: 1 },
  { id: "theme-2", name: null, startDay: 7 },
  { id: "theme-3", name: null, startDay: 14 },
  { id: "theme-4", name: null, startDay: 21 },
];

function themeForDay(day) {
  const clamped = Math.min(Math.max(Number(day) || 1, 1), 24);
  let result = CALENDAR_THEMES[0];
  for (const theme of CALENDAR_THEMES) {
    if (clamped >= theme.startDay) {
      result = theme;
    }
  }
  return result;
}

// Testing override: ?day=15 previews the page as if it were 15 December,
// ?theme=theme-3 forces a specific theme. Only honoured when not enforcing the date.
function readThemeOverride(allowOverride) {
  if (!allowOverride) {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  const forced = CALENDAR_THEMES.find((theme) => theme.id === params.get("theme"));
  if (forced) {
    return forced;
  }
  const day = Number(params.get("day"));
  return Number.isInteger(day) && day >= 1 ? themeForDay(day) : null;
}

function applyPageTheme(theme) {
  document.documentElement.dataset.theme = theme.id;
  const label = document.getElementById("themeName");
  if (label) {
    label.textContent = theme.name || "";
    label.hidden = !theme.name;
  }
}
