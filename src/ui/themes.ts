/**
 * Theme tokens. Single source of truth for both chrome (CSS custom
 * properties) and the canvas painter (palette objects). No component or
 * painter code may hardcode a colour.
 */

export interface TilePalette {
  wall: string;
  wallEdge: string;
  room: string;
  corridor: string;
  doorFill: string;
  doorBar: string;
  deadEnd: string;
  markerInk: string;
  entrance: string;
  exit: string;
  unreachableTint: string;
  unreachableHatch: string;
}

export interface Theme {
  id: string;
  name: string;
  isDark: boolean;
  chrome: Record<string, string>;
  tiles: TilePalette;
}

const darkChrome: Record<string, string> = {
  "--bg": "#101419",
  "--panel": "#171d24",
  "--panel-2": "#131820",
  "--border": "#232c36",
  "--ink": "#e8edf2",
  "--ink-muted": "#8fa0ae",
  "--accent": "#e0a53c",
  "--accent-ink": "#101419",
  "--focus": "#e0a53c",
  "--danger": "#ef6a5a",
  "--ok": "#43b8a5",
};

const lightChrome: Record<string, string> = {
  "--bg": "#eceef1",
  "--panel": "#f7f8f9",
  "--panel-2": "#eff1f4",
  "--border": "#d4d9de",
  "--ink": "#1b2127",
  "--ink-muted": "#5a6672",
  "--accent": "#b07908",
  "--accent-ink": "#ffffff",
  "--focus": "#b07908",
  "--danger": "#c0392b",
  "--ok": "#0e8a77",
};

const hcChrome: Record<string, string> = {
  "--bg": "#000000",
  "--panel": "#0a0a0a",
  "--panel-2": "#000000",
  "--border": "#666666",
  "--ink": "#ffffff",
  "--ink-muted": "#cccccc",
  "--accent": "#ffd23c",
  "--accent-ink": "#000000",
  "--focus": "#ffe066",
  "--danger": "#ff9d8f",
  "--ok": "#37ffd0",
};

const relicChrome: Record<string, string> = {
  "--bg": "#171310",
  "--panel": "#201a14",
  "--panel-2": "#1a1510",
  "--border": "#3a2f22",
  "--ink": "#e9dcc3",
  "--ink-muted": "#a8977d",
  "--accent": "#c89b4b",
  "--accent-ink": "#171310",
  "--focus": "#c89b4b",
  "--danger": "#d96a4a",
  "--ok": "#7fae87",
};

export const THEMES: Theme[] = [
  {
    id: "dark",
    name: "Dark technical",
    isDark: true,
    chrome: darkChrome,
    tiles: {
      wall: "#26303b",
      wallEdge: "#33404d",
      room: "#5b6b7c",
      corridor: "#3c4956",
      doorFill: "#5b6b7c",
      doorBar: "#101419",
      deadEnd: "#3c4956",
      markerInk: "#f2f6fa",
      entrance: "#43b8a5",
      exit: "#ef9d45",
      unreachableTint: "#6e5a80",
      unreachableHatch: "#b39ecb",
    },
  },
  {
    id: "light",
    name: "Light",
    isDark: false,
    chrome: lightChrome,
    tiles: {
      wall: "#3d4753",
      wallEdge: "#4d5866",
      room: "#ffffff",
      corridor: "#cfd6dc",
      doorFill: "#ffffff",
      doorBar: "#1b2127",
      deadEnd: "#cfd6dc",
      markerInk: "#101419",
      entrance: "#0e8a77",
      exit: "#c05f00",
      unreachableTint: "#b3a3c4",
      unreachableHatch: "#6a5880",
    },
  },
  {
    id: "high-contrast",
    name: "High contrast",
    isDark: true,
    chrome: hcChrome,
    tiles: {
      wall: "#1a1a1a",
      wallEdge: "#333333",
      room: "#f2f2f2",
      corridor: "#a6a6a6",
      doorFill: "#f2f2f2",
      doorBar: "#000000",
      deadEnd: "#a6a6a6",
      markerInk: "#ffffff",
      entrance: "#37ffd0",
      exit: "#ffb300",
      unreachableTint: "#7a6a8c",
      unreachableHatch: "#d0bce8",
    },
  },
  {
    id: "relic",
    name: "Relic (stylised)",
    isDark: true,
    chrome: relicChrome,
    tiles: {
      wall: "#45372a",
      wallEdge: "#57462f",
      room: "#e3d3ac",
      corridor: "#cdb98e",
      doorFill: "#e3d3ac",
      doorBar: "#241c10",
      deadEnd: "#cdb98e",
      markerInk: "#1d150b",
      entrance: "#1f6e60",
      exit: "#a34d12",
      unreachableTint: "#7d6a52",
      unreachableHatch: "#9c8763",
    },
  },
];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

/** Apply a theme's chrome tokens to :root CSS variables. */
export function applyTheme(id: string): void {
  const theme = getTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  for (const [k, v] of Object.entries(theme.chrome)) {
    root.style.setProperty(k, v);
  }
}
