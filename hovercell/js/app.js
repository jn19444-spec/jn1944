import {
  DEFAULT_STATE,
  THEME_PRESETS,
  cloneState,
  applyTheme,
  readFileAsDataUrl,
  sanitizeFilename,
} from "./state.js";
import {
  buildSnippet,
  buildStandalonePage,
  dataUrlToBlob,
  downloadBlob,
  downloadText,
} from "./generator.js";
import { mountPreview, bindAdjustSliders } from "./preview.js";

const state = cloneState(DEFAULT_STATE);
const els = {
  overlayInput: document.getElementById("overlay-input"),
  baseInput: document.getElementById("base-input"),
  adjustSliders: document.getElementById("adjust-sliders"),
  previewStage: document.getElementById("preview-stage"),
  previewMount: document.getElementById("preview-mount"),
  previewPlaceholder: document.getElementById("preview-placeholder"),
  exportOutput: document.getElementById("export-output"),
  themeRow: document.getElementById("theme-row"),
  revealMode: document.getElementById("reveal-mode"),
  fxGlow: document.getElementById("fx-glow"),
  fxTilt: document.getElementById("fx-tilt"),
  fxRipple: document.getElementById("fx-ripple"),
  particleShape: document.getElementById("particle-shape"),
  accentColor: document.getElementById("accent-color"),
  fxIntensity: document.getElementById("fx-intensity"),
  intensityValue: document.getElementById("intensity-value"),
  fxSpeed: document.getElementById("fx-speed"),
  speedValue: document.getElementById("speed-value"),
};

const sliderApi = bindAdjustSliders(els.adjustSliders, state, render);

function getExportMode() {
  return document.querySelector('input[name="export-mode"]:checked')?.value || "embedded";
}

function render() {
  const ready = mountPreview(els.previewMount, state);
  els.previewPlaceholder.hidden = ready;
  els.previewMount.hidden = !ready;
}

// state의 현재 값을 모든 컨트롤 UI에 반영 (테마 프리셋 적용 후 등에 사용)
function syncControlsFromState() {
  els.revealMode.value = state.revealMode;
  els.fxGlow.checked = state.effects.glow;
  els.fxTilt.checked = state.effects.tilt;
  els.fxRipple.checked = state.effects.ripple;
  els.particleShape.value = state.particleShape;
  els.accentColor.value = state.accentColor;
  els.fxIntensity.value = String(state.intensity);
  els.intensityValue.textContent = String(state.intensity);
  els.fxSpeed.value = String(state.speed);
  els.speedValue.textContent = String(state.speed);
  document.getElementById("fx-float").checked = state.effects.float;
  document.getElementById("fx-shine").checked = state.effects.shine;
  document.getElementById("fx-sparks").checked = state.effects.sparks;
  els.themeRow.querySelectorAll(".theme-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === state.theme);
  });
}

async function handleImageInput(which, file) {
  if (!file) return;
  const dataUrl = await readFileAsDataUrl(file);
  if (which === "overlay") {
    state.overlaySrc = dataUrl;
    state.overlayName = sanitizeFilename(file.name, "overlay.webp");
  } else {
    state.baseSrc = dataUrl;
    state.baseName = sanitizeFilename(file.name, "base.webp");
  }
  render();
}

els.overlayInput.addEventListener("change", (e) => {
  handleImageInput("overlay", e.target.files?.[0]);
});

els.baseInput.addEventListener("change", (e) => {
  handleImageInput("base", e.target.files?.[0]);
});

document.querySelectorAll(".layer-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".layer-tab").forEach((node) => node.classList.remove("active"));
    tab.classList.add("active");
    state.activeLayer = tab.dataset.layer;
    sliderApi.sync(state.activeLayer);
  });
});

// 테마 프리셋
els.themeRow.querySelectorAll(".theme-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    applyTheme(state, btn.dataset.theme);
    syncControlsFromState();
    render();
  });
});

document.getElementById("fx-float").addEventListener("change", (e) => {
  state.effects.float = e.target.checked;
  state.theme = "custom";
  render();
});
document.getElementById("fx-shine").addEventListener("change", (e) => {
  state.effects.shine = e.target.checked;
  state.theme = "custom";
  render();
});
document.getElementById("fx-sparks").addEventListener("change", (e) => {
  state.effects.sparks = e.target.checked;
  state.theme = "custom";
  render();
});
els.fxGlow.addEventListener("change", (e) => {
  state.effects.glow = e.target.checked;
  state.theme = "custom";
  render();
});
els.fxTilt.addEventListener("change", (e) => {
  state.effects.tilt = e.target.checked;
  state.theme = "custom";
  render();
});
els.fxRipple.addEventListener("change", (e) => {
  state.effects.ripple = e.target.checked;
  state.theme = "custom";
  render();
});

els.revealMode.addEventListener("change", (e) => {
  state.revealMode = e.target.value;
  state.theme = "custom";
  render();
});

els.particleShape.addEventListener("change", (e) => {
  state.particleShape = e.target.value;
  state.theme = "custom";
  render();
});

els.accentColor.addEventListener("input", (e) => {
  state.accentColor = e.target.value;
  state.theme = "custom";
  render();
});

els.fxIntensity.addEventListener("input", (e) => {
  state.intensity = Number(e.target.value);
  els.intensityValue.textContent = String(state.intensity);
  state.theme = "custom";
  render();
});

els.fxSpeed.addEventListener("input", (e) => {
  state.speed = Number(e.target.value);
  els.speedValue.textContent = String(state.speed);
  state.theme = "custom";
  render();
});

document.getElementById("border-radius").addEventListener("input", (e) => {
  state.borderRadius = Number(e.target.value);
  document.getElementById("radius-value").textContent = String(state.borderRadius);
  render();
});

document.getElementById("btn-reset").addEventListener("click", () => {
  Object.assign(state, cloneState(DEFAULT_STATE));
  els.overlayInput.value = "";
  els.baseInput.value = "";
  document.getElementById("border-radius").value = "22";
  document.getElementById("radius-value").textContent = "22";
  document.querySelector('input[name="export-mode"][value="embedded"]').checked = true;
  syncControlsFromState();
  sliderApi.sync(state.activeLayer);
  els.exportOutput.value = "";
  render();
});

function ensureReady() {
  if (!state.overlaySrc || !state.baseSrc) {
    alert("표지·공개 이미지를 모두 업로드해 주세요.");
    return false;
  }
  return true;
}

document.getElementById("btn-copy-html").addEventListener("click", async () => {
  if (!ensureReady()) return;
  const mode = getExportMode();
  const snippet = buildSnippet(state, mode);
  els.exportOutput.value = snippet;
  await navigator.clipboard.writeText(snippet);
});

document.getElementById("btn-download-html").addEventListener("click", async () => {
  if (!ensureReady()) return;
  const mode = getExportMode();
  downloadText("hover-cell.html", buildStandalonePage(state, mode));
  if (mode === "files") {
    downloadBlob("overlay.webp", await dataUrlToBlob(state.overlaySrc));
    downloadBlob("base.webp", await dataUrlToBlob(state.baseSrc));
  }
});

syncControlsFromState();
sliderApi.sync(state.activeLayer);
render();
