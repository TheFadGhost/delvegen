/**
 * Global keyboard shortcuts and the flat help modal.
 *
 * Shortcuts are ignored while the event target is an input, select or
 * textarea (typing always wins). In step mode ArrowLeft/Right step frames;
 * otherwise they pan the camera.
 */

import { THEMES } from "./themes.js";

export interface ShortcutHandlers {
  generate(): void;
  copySeed(): void | Promise<void>;
  cycleTheme(): void;
  zoomCenter(factor: number): void;
  panCamera(dxPx: number, dyPx: number): void;
  toggleHelp(): void;
  closeHelp(): void;
  isStepMode(): boolean;
  transportPlayPause(): void;
  transportStep(delta: number): void;
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "SELECT" ||
    tag === "TEXTAREA" ||
    el.isContentEditable === true
  );
}

export function installShortcuts(handlers: ShortcutHandlers): void {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      handlers.closeHelp();
      return; // Esc works even from inputs (closes the help modal only)
    }
    if (isTypingTarget(e.target)) return;

    switch (e.key) {
      case "g":
      case "G":
        e.preventDefault();
        handlers.generate();
        break;
      case "c":
      case "C":
        void handlers.copySeed();
        break;
      case "t":
      case "T":
        handlers.cycleTheme();
        break;
      case "+":
      case "=":
        handlers.zoomCenter(1.25);
        break;
      case "-":
      case "_":
        handlers.zoomCenter(0.8);
        break;
      case "?":
        handlers.toggleHelp();
        break;
      case "ArrowLeft":
      case "ArrowRight":
        if (handlers.isStepMode()) {
          e.preventDefault();
          handlers.transportStep(e.key === "ArrowLeft" ? -1 : 1);
        } else {
          e.preventDefault();
          const dx = e.key === "ArrowLeft" ? -48 : 48;
          handlers.panCamera(dx, 0);
        }
        break;
      case "ArrowUp":
      case "ArrowDown":
        if (!handlers.isStepMode()) {
          e.preventDefault();
          handlers.panCamera(0, e.key === "ArrowUp" ? -48 : 48);
        }
        break;
      case " ":
      case "Spacebar":
        if (handlers.isStepMode()) {
          e.preventDefault();
          handlers.transportPlayPause();
        }
        break;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Help modal                                                          */
/* ------------------------------------------------------------------ */

const SHORTCUT_ROWS: Array<[string, string]> = [
  ["G", "Generate"],
  ["C", "Copy seed"],
  ["T", "Cycle theme"],
  ["+ / −", "Zoom in / out (centered)"],
  ["Arrow keys", "Pan camera"],
  ["Space", "Play / pause (step mode)"],
  ["← / →", "Step one frame (step mode)"],
  ["?", "Toggle this help"],
  ["Esc", "Close help"],
];

const MOUSE_ROWS: Array<[string, string]> = [
  ["Drag", "Pan map"],
  ["Wheel", "Zoom at cursor"],
];

export function setupHelpOverlay(
  overlay: HTMLElement,
  closeBtn: HTMLButtonElement,
): { open(): void; close(): void; toggle(): void } {
  const table = overlay.querySelector("table");
  if (table) {
    const body = table.tBodies[0]!;
    const rows: HTMLTableRowElement[] = [];
    for (const [k, v] of SHORTCUT_ROWS) rows.push(helpRow(k, v));
    for (const [k, v] of MOUSE_ROWS) {
      const tr = helpRow(k, v);
      tr.dataset.mouseRow = "true";
      rows.push(tr);
    }
    body.replaceChildren(...rows);
  }

  const open = () => {
    overlay.classList.remove("hidden");
    closeBtn.focus();
  };
  const close = () => overlay.classList.add("hidden");
  const toggle = () => (overlay.classList.contains("hidden") ? open() : close());
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) close(); // click on backdrop dismisses
  });
  return { open, close, toggle };
}

function helpRow(kbdText: string, desc: string): HTMLTableRowElement {
  const tr = document.createElement("tr");
  const tdK = document.createElement("td");
  tdK.className = "help-k";
  const kbd = document.createElement("kbd");
  kbd.textContent = kbdText;
  tdK.appendChild(kbd);
  const tdV = document.createElement("td");
  tdV.textContent = desc;
  tr.append(tdK, tdV);
  return tr;
}

/** Next theme id in cycle order, applied by caller. */
export function nextThemeId(currentId: string): string {
  const i = THEMES.findIndex((t) => t.id === currentId);
  return THEMES[(i + 1 + THEMES.length) % THEMES.length]?.id ?? THEMES[0]!.id;
}
