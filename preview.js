import { buildHoverCellMarkup, buildHoverCellScript } from "./generator.js";

export function mountPreview(container, state) {
  const prevMb = container.querySelector(".hc-mb");
  if (prevMb && typeof prevMb._hcCleanup === "function") prevMb._hcCleanup();
  container.innerHTML = "";
  if (!state.overlaySrc || !state.baseSrc) return false;

  const cellId = "preview-hc";
  container.insertAdjacentHTML(
    "beforeend",
    buildHoverCellMarkup(state, { mode: "embedded", cellId })
  );

  const script = document.createElement("script");
  script.textContent = buildHoverCellScript(state, { cellId, hostSelector: "#preview-stage" })
    .replace(/^<script>/, "")
    .replace(/<\/script>$/, "");
  container.appendChild(script);
  return true;
}

export function bindAdjustSliders(root, state, onChange) {
  const sliders = [
    { key: "x", label: "가로 이동", min: -30, max: 30, step: 0.1 },
    { key: "y", label: "세로 이동", min: -30, max: 30, step: 0.1 },
    { key: "scale", label: "크기", min: 0.5, max: 1.5, step: 0.01 },
    { key: "posX", label: "크롭 X", min: 0, max: 100, step: 0.1 },
    { key: "posY", label: "크롭 Y", min: 0, max: 100, step: 0.1 },
  ];

  root.innerHTML = sliders
    .map(
      (item) => `<div class="slider-row" data-key="${item.key}">
        <label><span>${item.label}</span><strong data-value>0</strong></label>
        <input type="range" min="${item.min}" max="${item.max}" step="${item.step}" value="0">
      </div>`
    )
    .join("");

  // 슬라이더를 드래그하면 짧은 시간에 input 이벤트가 수십~수백 번 발생해요.
  // 매번 바로 다시 그리면 버벅일 수 있어서, 한 프레임(requestAnimationFrame)에 한 번만 반영해요.
  let rafId = null;
  function scheduleChange() {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      onChange();
    });
  }

  root.querySelectorAll(".slider-row").forEach((row) => {
    const key = row.dataset.key;
    const input = row.querySelector("input");
    const valueEl = row.querySelector("[data-value]");
    input.addEventListener("input", () => {
      const layer = state.adjust[state.activeLayer];
      layer[key] = Number(input.value);
      valueEl.textContent = Number(input.value).toFixed(key === "scale" ? 2 : 1);
      scheduleChange();
    });
    row._sync = (layer) => {
      input.value = String(layer[key]);
      valueEl.textContent = Number(layer[key]).toFixed(key === "scale" ? 2 : 1);
    };
  });

  return {
    sync(layerName) {
      const layer = state.adjust[layerName];
      root.querySelectorAll(".slider-row").forEach((row) => row._sync(layer));
    },
  };
}
