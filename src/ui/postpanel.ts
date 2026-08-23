/**
 * Post-processing panel: one checkbox per registered pass (canonical order),
 * each exposing its numeric params inline only while enabled. Collects a
 * `post` config for generateDungeon: enabled passes map to `true` (no
 * params) or an object of current values.
 */

import { listPostPasses } from "../core/post-registry.js";
import type { PostPassConfig } from "../core/types.js";
import type { FloatParamSpec, IntParamSpec } from "../core/types.js";
import { buildNumericParam } from "./controls.js";

interface PassRow {
  id: string;
  check: HTMLInputElement;
  paramsRoot: HTMLDivElement;
  controls: ReturnType<typeof buildNumericParam>[];
}

export class PostPanel {
  private rows: PassRow[] = [];

  constructor(
    root: HTMLElement,
    private onChange: () => void,
  ) {
    root.textContent = "";
    for (const def of listPostPasses()) {
      const wrap = document.createElement("div");
      wrap.className = "param";

      const labelRow = document.createElement("label");
      labelRow.className = "param-check";
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = false;
      check.id = `post-check-${def.id}`;
      const name = document.createElement("span");
      name.className = "param-name";
      name.textContent = def.name;
      labelRow.append(check, name);

      const paramsRoot = document.createElement("div");
      paramsRoot.className = "post-params hidden";

      const controls = def.params
        .filter((p): p is IntParamSpec | FloatParamSpec => p.type === "int" || p.type === "float")
        .map((spec) => buildNumericParam(spec, () => this.onChange()));

      for (const c of controls) paramsRoot.appendChild(c.root);

      check.addEventListener("change", () => {
        paramsRoot.classList.toggle("hidden", !check.checked);
        this.onChange();
      });

      wrap.append(labelRow, paramsRoot);
      root.appendChild(wrap);
      this.rows.push({ id: def.id, check, paramsRoot, controls });
    }
  }

  /** Config keyed by pass id; disabled passes are omitted entirely. */
  collect(): Record<string, PostPassConfig> {
    const out: Record<string, PostPassConfig> = {};
    for (const row of this.rows) {
      if (!row.check.checked) continue;
      if (row.controls.length === 0) {
        out[row.id] = true;
      } else {
        const cfg: Record<string, unknown> = {};
        for (const c of row.controls) cfg[c.key] = c.getValue();
        out[row.id] = cfg;
      }
    }
    return out;
  }
}
