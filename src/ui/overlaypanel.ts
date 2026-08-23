/**
 * Overlays panel: view flags (no regeneration needed) feeding
 * buildRenderModel's OverlayFlags. All default on.
 */

import type { OverlayFlags } from "../render/renderer.js";

interface OverlayRow {
  key: keyof OverlayFlags;
  label: string;
}

const ROWS: OverlayRow[] = [
  { key: "doors", label: "Doors" },
  { key: "deadEnds", label: "Dead ends" },
  { key: "markers", label: "Markers" },
  { key: "unreachable", label: "Unreachable tint" },
];

export function buildOverlayPanel(
  root: HTMLElement,
  flags: OverlayFlags,
  onChange: () => void,
): void {
  root.textContent = "";
  for (const row of ROWS) {
    const label = document.createElement("label");
    label.className = "param-check";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = true;
    check.id = `overlay-${row.key}`;
    check.addEventListener("change", () => {
      flags[row.key] = check.checked;
      onChange();
    });
    const name = document.createElement("span");
    name.className = "param-name";
    name.textContent = row.label;
    label.append(check, name);
    root.appendChild(label);
  }
}
