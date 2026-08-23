/**
 * Shared control builders: the paired slider+number pattern used by both the
 * algorithm parameter panel and the post-processing panel.
 */

import type { FloatParamSpec, IntParamSpec } from "../core/types.js";

export interface NumericParamControl {
  root: HTMLElement;
  key: string;
  getValue(): number;
}

type NumericSpec = IntParamSpec | FloatParamSpec;

function formatValue(v: number, isInt: boolean): string {
  return isInt ? String(Math.round(v)) : v.toFixed(2).replace(/\.?0+$/, "");
}

/** Label row + slider/number pair + "min – max" range note, per DESIGN.md. */
export function buildNumericParam(spec: NumericSpec, onInput: () => void): NumericParamControl {
  const wrap = document.createElement("div");
  wrap.className = "param";

  const labelRow = document.createElement("div");
  labelRow.className = "param-label-row";
  const name = document.createElement("span");
  name.className = "param-name";
  name.textContent = spec.label;
  const value = document.createElement("span");
  value.className = "param-value";
  value.textContent = formatValue(spec.default, spec.type === "int");
  labelRow.append(name, value);

  const step = spec.step ?? (spec.type === "int" ? 1 : 0.01);
  const clamp = (v: number) => Math.min(spec.max, Math.max(spec.min, v));

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(spec.min);
  slider.max = String(spec.max);
  slider.step = String(step);
  slider.value = String(spec.default);
  slider.setAttribute("aria-label", spec.label);

  const number = document.createElement("input");
  number.type = "number";
  number.min = String(spec.min);
  number.max = String(spec.max);
  number.step = String(step);
  number.value = String(spec.default);
  number.setAttribute("aria-label", `${spec.label} numeric value`);

  const rangeNote = document.createElement("div");
  rangeNote.className = "param-range";
  rangeNote.textContent = `${spec.min} – ${spec.max}`;

  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    value.textContent = formatValue(v, spec.type === "int");
    number.value = String(v);
    onInput();
  });
  number.addEventListener("input", () => {
    const v = Number(number.value);
    if (Number.isFinite(v)) {
      value.textContent = formatValue(v, spec.type === "int");
      slider.value = String(clamp(v));
      onInput();
    }
  });

  const numRow = document.createElement("div");
  numRow.className = "param-numrow";
  numRow.append(slider, number);

  wrap.append(labelRow, numRow, rangeNote);

  return {
    root: wrap,
    key: spec.key,
    getValue() {
      const v = Number(number.value);
      return Number.isFinite(v) ? clamp(v) : spec.default;
    },
  };
}
