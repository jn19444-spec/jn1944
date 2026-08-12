export const DEFAULT_STATE = {
  overlaySrc: "",
  baseSrc: "",
  overlayName: "overlay.webp",
  baseName: "base.webp",
  activeLayer: "overlay",
  adjust: {
    overlay: { x: 0, y: 0, scale: 1, posX: 50, posY: 50 },
    base: { x: 0, y: 0, scale: 1, posX: 50, posY: 50 },
  },
  effects: {
    float: true,
    shine: true,
    sparks: true,
    glow: false,
    tilt: false,
  },
  // 공개(호버) 애니메이션 종류
  revealMode: "fade", // fade | zoomblur | slide | wipe | flip3d
  // 파티클(반짝이) 모양
  particleShape: "star", // star | heart | flower | bubble
  // 글로우/파티클/틸트 등에 쓰이는 포인트 컬러
  accentColor: "#ffd66b",
  // 효과 강도(0~100) - 파티클 개수, 글로우 세기, 틸트 각도, 블러 세기 등에 반영
  intensity: 60,
  // 효과 속도(50~200, 100=기본) - 값이 클수록 빠르게 재생
  speed: 100,
  borderRadius: 22,
  // 현재 적용된 테마 이름 (UI 하이라이트용). 슬라이더를 직접 만지면 "custom"으로 바뀜
  theme: "custom",
};

// 빠른 시작용 테마 프리셋. "적용"하면 DEFAULT_STATE 위에 이 값들만 덮어씀.
export const THEME_PRESETS = {
  romance: {
    label: "로맨스",
    accentColor: "#ff8fb3",
    revealMode: "zoomblur",
    particleShape: "heart",
    effects: { float: true, shine: true, sparks: true, glow: true, tilt: false },
    intensity: 65,
    speed: 90,
  },
  night: {
    label: "나이트",
    accentColor: "#7c9cff",
    revealMode: "wipe",
    particleShape: "bubble",
    effects: { float: true, shine: false, sparks: true, glow: true, tilt: true },
    intensity: 55,
    speed: 110,
  },
  fairy: {
    label: "페어리",
    accentColor: "#8fffb3",
    revealMode: "slide",
    particleShape: "flower",
    effects: { float: true, shine: true, sparks: true, glow: false, tilt: false },
    intensity: 75,
    speed: 100,
  },
  vintage: {
    label: "빈티지",
    accentColor: "#ffb347",
    revealMode: "flip3d",
    particleShape: "star",
    effects: { float: false, shine: true, sparks: false, glow: false, tilt: false },
    intensity: 45,
    speed: 80,
  },
};

export function cloneState(state) {
  return structuredClone(state);
}

export function applyTheme(state, themeKey) {
  const preset = THEME_PRESETS[themeKey];
  if (!preset) return state;
  state.theme = themeKey;
  state.accentColor = preset.accentColor;
  state.revealMode = preset.revealMode;
  state.particleShape = preset.particleShape;
  state.effects = { ...state.effects, ...preset.effects };
  state.intensity = preset.intensity;
  state.speed = preset.speed;
  return state;
}

export function adjCss(layer) {
  return `translate(${layer.x.toFixed(2)}%, ${layer.y.toFixed(2)}%) scale(${layer.scale.toFixed(3)})`;
}

export function objectPosition(layer) {
  return `${layer.posX.toFixed(2)}% ${layer.posY.toFixed(2)}%`;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function sanitizeFilename(name, fallback) {
  const cleaned = String(name || fallback)
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}
