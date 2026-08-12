import { adjCss, objectPosition } from "./state.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function imageAttrs(layer, src) {
  return [
    `src="${escapeHtml(src)}"`,
    `style="--hc-adj:${adjCss(layer)};object-position:${objectPosition(layer)}"`,
    'alt=""',
  ].join(" ");
}

function clampNum(n, min, max, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

// 포인트 컬러(accentColor)에서 밝기가 다른 변형 4가지를 뽑아서 반짝이 파티클 색으로 써요.
// 예전엔 파티클 색이 무조건 골드 계열로 고정돼 있어서, 테마를 바꿔도 반짝이만 안 어울렸어요.
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  if (!m) return { r: 255, g: 214, b: 107 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function mixChannel(a, b, t) {
  return Math.round(a + (b - a) * t);
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}
function deriveSparkColors(hex) {
  const { r, g, b } = hexToRgb(hex);
  return [
    rgbToHex(r, g, b),
    rgbToHex(mixChannel(r, 255, 0.35), mixChannel(g, 255, 0.35), mixChannel(b, 255, 0.35)),
    rgbToHex(mixChannel(r, 0, 0.2), mixChannel(g, 0, 0.2), mixChannel(b, 0, 0.2)),
    rgbToHex(mixChannel(r, 255, 0.7), mixChannel(g, 255, 0.7), mixChannel(b, 255, 0.7)),
  ];
}

// 파티클 모양별 글자(유니코드) 세트
const PARTICLE_GLYPHS = {
  star: ["\u2726", "\u2727", "\u25CF"], // ✦ ✧ ●
  heart: ["\u2764", "\u2765", "\u2661"], // ❤ ❥ ♡
  flower: ["\u2740", "\u273F", "\u2731"], // ✿ ✿(alt) ✱
  bubble: ["\u25CF", "\u25CB", "\u25CE"], // ● ○ ◎
  snow: ["\u2744", "\u2745", "\u2746"], // ❄ ❅ ❆
  sparkle: ["\u2736", "\u2737", "\u2735"], // ✶ ✷ ✵
  musicnote: ["\u266A", "\u266B", "\u266C"], // ♪ ♫ ♬
  letter: ["\u2709", "\u{1F48C}", "\u2764"], // ✉ 💌 ❤
};

export function buildHoverCellMarkup(state, { mode = "embedded", cellId = "hc-mb" } = {}) {
  const overlaySrc = mode === "files" ? "./overlay.webp" : state.overlaySrc;
  const baseSrc = mode === "files" ? "./base.webp" : state.baseSrc;
  const radius = Number(state.borderRadius) || 0;
  const floatClass = state.effects.float ? " hc-float bob" : " hc-float";
  const rippleClass = state.effects.ripple ? " hc-ripple-enabled" : "";
  const shineBlock = state.effects.shine
    ? '<div class="hc-shinewrap"><div class="hc-shine"></div></div>'
    : "";
  const revealMode = state.revealMode || "fade";
  const intensity = clampNum(state.intensity, 0, 100, 60);
  const speed = clampNum(state.speed, 50, 200, 100);
  const accent = escapeHtml(state.accentColor || "#ffd66b");
  const glowClass = state.effects.glow ? " hc-glow-enabled" : "";
  const needsPerspective = revealMode === "flip3d" || state.effects.tilt;

  const mbStyle = [
    `border-radius:${radius}px`,
    `--hc-i:${(intensity / 100).toFixed(2)}`,
    `--hc-dur:${(100 / speed).toFixed(3)}`,
    `--hc-accent:${accent}`,
  ].join(";");
  // 바깥 래퍼(hc-float)에도 같은 둥근 모서리를 줘서, 리플(파동) 링이 카드 모양과 맞게 나와요.
  const wrapStyleParts = [`border-radius:${radius}px`];
  if (needsPerspective) wrapStyleParts.push("perspective:900px");
  const wrapStyle = ` style="${wrapStyleParts.join(";")}"`;

  return `<div class="${(floatClass + rippleClass).trim()}"${wrapStyle}><div class="hc-mb${glowClass}" id="${cellId}" data-reveal="${revealMode}" style="${mbStyle}">
  <img class="hc-base" ${imageAttrs(state.adjust.base, baseSrc)}>
  <img class="hc-overlay" ${imageAttrs(state.adjust.overlay, overlaySrc)}>
  ${shineBlock}
</div></div>`;
}

export function buildHoverCellScript(state, { cellId = "hc-mb", hostSelector = "body" } = {}) {
  const sparksEnabled = state.effects.sparks ? "true" : "false";
  const tiltEnabled = state.effects.tilt ? "true" : "false";
  const intensity = clampNum(state.intensity, 0, 100, 60);
  const speed = clampNum(state.speed, 50, 200, 100);
  const glyphs = JSON.stringify(PARTICLE_GLYPHS[state.particleShape] || PARTICLE_GLYPHS.star);
  const sparkColors = JSON.stringify(deriveSparkColors(state.accentColor || "#ffd66b"));

  return `<script>
(function(){
var sparksEnabled=${sparksEnabled};
var tiltEnabled=${tiltEnabled};
var intensity=${intensity};
var speedMult=${(100 / speed).toFixed(3)};
var glyphs=${glyphs};
var sparkCount=Math.max(3,Math.round(4+10*(intensity/100)));
function sparks(host,n){
  if(!sparksEnabled||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
  var colors=${sparkColors};
  for(var i=0;i<n;i++){
    var s=document.createElement("span");
    s.textContent=glyphs[Math.floor(Math.random()*glyphs.length)];
    s.style.cssText="position:absolute;left:50%;top:50%;z-index:40;pointer-events:none;"
      +"font:700 "+(9+Math.random()*13)+"px sans-serif;color:"+colors[i%4]+";"
      +"text-shadow:0 0 6px rgba(255,215,130,.8);transform:translate(-50%,-50%);will-change:transform,opacity";
    host.appendChild(s);
    var a=Math.random()*Math.PI*2,d=80+Math.random()*150;
    var dx=Math.cos(a)*d,dy=Math.sin(a)*d-30;
    s.animate([
      {transform:"translate(-50%,-50%) scale(.4) rotate(0deg)",opacity:1},
      {transform:"translate(calc(-50% + "+dx+"px), calc(-50% + "+dy+"px)) scale(1.15) rotate("+(Math.random()*260-130)+"deg)",opacity:0}
    ],{duration:(650+Math.random()*400)*speedMult,easing:"cubic-bezier(.15,.75,.4,1)"})
    .onfinish=(function(el){return function(){el.remove();};})(s);
  }
}
var mb=document.getElementById("${cellId}"),lastTouch=0;
function on(){if(!mb.classList.contains("on")){mb.classList.add("on");sparks(mb,sparkCount);}}
function off(){mb.classList.remove("on");}
function onContextMenu(e){e.preventDefault();}
mb.addEventListener("contextmenu",onContextMenu);
var hit=${hostSelector === "body" ? "document.body" : `document.querySelector(${JSON.stringify(hostSelector)})`},tT=0,tMoved=false,tStart=0;
function onTouchStart(){lastTouch=Date.now();tStart=Date.now();tMoved=false;clearTimeout(tT);tT=setTimeout(function(){if(!tMoved)on();},140);}
function onTouchMove(){tMoved=true;clearTimeout(tT);}
function onTouchEnd(e){lastTouch=Date.now();clearTimeout(tT);if(!tMoved&&Date.now()-tStart<260){if(mb.classList.contains("on"))off();else on();return;}if(e.touches.length===0)off();}
function onTouchCancel(){clearTimeout(tT);off();}
function onMouseEnter(){if(Date.now()-lastTouch>800)on();}
function onMouseLeave(){if(Date.now()-lastTouch>800)off();}
hit.addEventListener("touchstart",onTouchStart,{passive:true});
hit.addEventListener("touchmove",onTouchMove,{passive:true});
hit.addEventListener("touchend",onTouchEnd);
hit.addEventListener("touchcancel",onTouchCancel);
hit.addEventListener("mouseenter",onMouseEnter);
hit.addEventListener("mouseleave",onMouseLeave);
mb.tabIndex=0;mb.setAttribute("role","button");mb.setAttribute("aria-label","사진 공개하기");
function onKeydown(e){if(e.key!=="Enter"&&e.key!==" ")return;e.preventDefault();mb.classList.toggle("on");}
mb.addEventListener("keydown",onKeydown);
// 3D 마우스 틸트: 정밀 포인터(마우스)에서만, reduced-motion이 아닐 때만 동작
var onTiltMove=null,onTiltLeave=null;
if(tiltEnabled&&matchMedia("(pointer:fine)").matches&&!matchMedia("(prefers-reduced-motion: reduce)").matches){
  var maxTilt=4+10*(intensity/100);
  onTiltMove=function(e){
    var r=mb.getBoundingClientRect();
    var px=(e.clientX-r.left)/r.width-.5;
    var py=(e.clientY-r.top)/r.height-.5;
    mb.style.transform="rotateX("+(-py*maxTilt).toFixed(2)+"deg) rotateY("+(px*maxTilt).toFixed(2)+"deg)";
  };
  onTiltLeave=function(){mb.style.transform="";};
  hit.addEventListener("mousemove",onTiltMove);
  hit.addEventListener("mouseleave",onTiltLeave);
}
// 미리보기에서는 슬라이더/옵션을 바꿀 때마다 이 스크립트가 다시 실행되는데,
// 여기서 만든 리스너들을 안 지우면 계속 쌓여서 느려지고 효과가 중복돼요.
// 그래서 정리 함수를 mb에 매달아두고, preview.js가 다시 그리기 전에 이걸 호출해서 지워요.
mb._hcCleanup=function(){
  hit.removeEventListener("touchstart",onTouchStart);
  hit.removeEventListener("touchmove",onTouchMove);
  hit.removeEventListener("touchend",onTouchEnd);
  hit.removeEventListener("touchcancel",onTouchCancel);
  hit.removeEventListener("mouseenter",onMouseEnter);
  hit.removeEventListener("mouseleave",onMouseLeave);
  if(onTiltMove)hit.removeEventListener("mousemove",onTiltMove);
  if(onTiltLeave)hit.removeEventListener("mouseleave",onTiltLeave);
  clearTimeout(tT);
};
})();
<\/script>`;
}

export function buildHoverCellStyles() {
  return `<style>
.hc-float{line-height:0;will-change:transform;position:relative}
.hc-float.bob{animation:hc-bob calc(6s * var(--hc-dur,1)) ease-in-out infinite}
@keyframes hc-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
.hc-mb{position:relative;line-height:0;overflow:hidden;cursor:pointer;box-shadow:0 18px 42px rgba(0,0,0,.30),0 4px 12px rgba(0,0,0,.16);transition:transform .2s ease-out,box-shadow .4s ease}
.hc-mb img{-webkit-touch-callout:none;user-select:none;-webkit-user-drag:none;pointer-events:none}
.hc-base{max-width:96vw;max-height:94vh;width:auto;height:auto;display:block;transform:var(--hc-adj,translate(0,0) scale(1)) scale(1.06);transition:transform calc(1.1s * var(--hc-dur,1)) cubic-bezier(.2,.7,.3,1);will-change:transform}
.hc-overlay{position:absolute;top:-1px;left:-1px;width:calc(100% + 2px);height:calc(100% + 2px);object-fit:cover;transform:var(--hc-adj,translate(0,0) scale(1));transition:opacity calc(.55s * var(--hc-dur,1)) ease,transform calc(.55s * var(--hc-dur,1)) ease;will-change:opacity,transform}
.hc-shinewrap{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:3}
.hc-shine{position:absolute;inset:0;opacity:0;background:linear-gradient(115deg,transparent 42%,rgba(255,255,255,.38) 50%,transparent 58%);transform:translateX(-120%)}
.hc-mb.on .hc-overlay{opacity:0;transform:var(--hc-adj,translate(0,0) scale(1)) scale(1.04)}
.hc-mb.on .hc-base{transform:var(--hc-adj,translate(0,0) scale(1)) scale(1)}
.hc-mb.on .hc-shine{opacity:1;animation:hc-sweep calc(.9s * var(--hc-dur,1)) ease .05s forwards}
@keyframes hc-sweep{from{transform:translateX(-120%)}to{transform:translateX(120%)}}

/* --- 공개 애니메이션: 줌+블러 --- */
.hc-mb[data-reveal="zoomblur"] .hc-overlay{transition:opacity calc(.6s * var(--hc-dur,1)) ease,transform calc(.6s * var(--hc-dur,1)) ease,filter calc(.6s * var(--hc-dur,1)) ease;filter:blur(0)}
.hc-mb[data-reveal="zoomblur"].on .hc-overlay{opacity:0;filter:blur(calc(4px + 8px * var(--hc-i,0.6)));transform:var(--hc-adj,translate(0,0) scale(1)) scale(1.18)}
.hc-mb[data-reveal="zoomblur"] .hc-base{filter:blur(calc(10px * var(--hc-i,0.6)));transition:transform calc(1.1s * var(--hc-dur,1)) cubic-bezier(.2,.7,.3,1),filter calc(.9s * var(--hc-dur,1)) ease}
.hc-mb[data-reveal="zoomblur"].on .hc-base{filter:blur(0)}

/* --- 공개 애니메이션: 슬라이드 --- */
.hc-mb[data-reveal="slide"] .hc-overlay{transition:transform calc(.6s * var(--hc-dur,1)) cubic-bezier(.65,0,.35,1),opacity calc(.6s * var(--hc-dur,1)) ease}
.hc-mb[data-reveal="slide"].on .hc-overlay{transform:var(--hc-adj,translate(0,0) scale(1)) translateX(-105%);opacity:1}

/* --- 공개 애니메이션: 와이프 --- */
.hc-mb[data-reveal="wipe"] .hc-overlay{transition:clip-path calc(.7s * var(--hc-dur,1)) cubic-bezier(.65,0,.35,1);clip-path:inset(0 0 0 0);opacity:1;transform:var(--hc-adj,translate(0,0) scale(1))}
.hc-mb[data-reveal="wipe"].on .hc-overlay{clip-path:inset(0 0 0 100%)}

/* --- 공개 애니메이션: 3D 플립 --- */
.hc-mb[data-reveal="flip3d"] .hc-base,.hc-mb[data-reveal="flip3d"] .hc-overlay{transition:transform calc(.7s * var(--hc-dur,1)) cubic-bezier(.3,.7,.4,1),opacity calc(.5s * var(--hc-dur,1)) ease;backface-visibility:hidden}
.hc-mb[data-reveal="flip3d"] .hc-overlay{transform:var(--hc-adj,translate(0,0) scale(1)) rotateY(0deg)}
.hc-mb[data-reveal="flip3d"].on .hc-overlay{transform:var(--hc-adj,translate(0,0) scale(1)) rotateY(-100deg);opacity:0}
.hc-mb[data-reveal="flip3d"] .hc-base{transform:var(--hc-adj,translate(0,0) scale(1)) rotateY(90deg) scale(1.06)}
.hc-mb[data-reveal="flip3d"].on .hc-base{transform:var(--hc-adj,translate(0,0) scale(1)) rotateY(0deg) scale(1)}

/* --- 공개 애니메이션: 아이리스(원형 확장) --- */
.hc-mb[data-reveal="iris"] .hc-overlay{transition:clip-path calc(.7s * var(--hc-dur,1)) cubic-bezier(.65,0,.35,1);clip-path:circle(150% at 50% 50%);opacity:1;transform:var(--hc-adj,translate(0,0) scale(1))}
.hc-mb[data-reveal="iris"].on .hc-overlay{clip-path:circle(0% at 50% 50%)}

/* --- 공개 애니메이션: 드롭(아래로 떨어짐) --- */
.hc-mb[data-reveal="drop"] .hc-overlay{transition:transform calc(.6s * var(--hc-dur,1)) cubic-bezier(.55,0,.85,.35),opacity calc(.6s * var(--hc-dur,1)) ease}
.hc-mb[data-reveal="drop"].on .hc-overlay{transform:var(--hc-adj,translate(0,0) scale(1)) translateY(115%) rotate(8deg);opacity:.05}

/* --- 글로우 --- */
.hc-mb.hc-glow-enabled{box-shadow:0 18px 42px rgba(0,0,0,.30),0 4px 12px rgba(0,0,0,.16),0 0 calc(6px + 14px * var(--hc-i,0.6)) 0 var(--hc-accent,#ffd66b)}
.hc-mb.hc-glow-enabled.on{animation:hc-glow-pulse calc(2.2s * var(--hc-dur,1)) ease-in-out infinite}
@keyframes hc-glow-pulse{
  0%,100%{box-shadow:0 18px 42px rgba(0,0,0,.30),0 4px 12px rgba(0,0,0,.16),0 0 calc(10px + 26px * var(--hc-i,0.6)) 0 var(--hc-accent,#ffd66b)}
  50%{box-shadow:0 18px 42px rgba(0,0,0,.30),0 4px 12px rgba(0,0,0,.16),0 0 calc(4px + 10px * var(--hc-i,0.6)) 0 var(--hc-accent,#ffd66b)}
}

/* --- 리플(파동): 호버할 때 카드 테두리에서 링이 한 번 퍼져나가요 --- */
.hc-float.hc-ripple-enabled::after{content:"";position:absolute;inset:0;border-radius:inherit;border:2px solid var(--hc-accent,#ffd66b);opacity:0;pointer-events:none;z-index:5}
.hc-float.hc-ripple-enabled:has(.hc-mb.on)::after{animation:hc-ripple calc(.9s * var(--hc-dur,1)) ease-out}
@keyframes hc-ripple{0%{opacity:.85;transform:scale(1)}100%{opacity:0;transform:scale(1.22)}}
</style>`;
}

export function buildSnippet(state, mode = "embedded") {
  if (!state.overlaySrc || !state.baseSrc) {
    throw new Error("표지·공개 이미지를 모두 업로드해 주세요.");
  }
  const cellId = `hc-${Math.random().toString(36).slice(2, 8)}`;
  return [
    buildHoverCellStyles(),
    buildHoverCellMarkup(state, { mode, cellId }),
    buildHoverCellScript(state, { cellId }),
  ].join("\n");
}

export function buildStandalonePage(state, mode = "embedded") {
  const body = buildSnippet(state, mode);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>호버방셀</title>
<style>html,body{height:100%;margin:0;padding:0;overflow:hidden;background:transparent}body{display:flex;justify-content:center;align-items:center;-webkit-tap-highlight-color:transparent}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename, text) {
  downloadBlob(filename, new Blob([text], { type: "text/html;charset=utf-8" }));
}
