// 서비스워커: 사이트 껍데기(HTML/CSS/JS/아이콘)만 캐싱해서 재방문 시 빠르게 뜨게 해요.
// 게시글 데이터(글 내용)는 Firebase에서 오는 거라 여기서는 건드리지 않아요(항상 최신 데이터를 가져옴).
//
// 사이트를 한창 자주 업데이트하는 중이라, CSS/JS도 "일단 저장된 것부터 보여주기"가 아니라
// HTML처럼 "새 버전을 먼저 받아오고 실패했을 때만 저장된 것으로 대체"하도록 함.
// (저장된 옛날 CSS가 최신 HTML 구조랑 안 맞아서 스타일이 깨지는 문제 방지)
const CACHE_NAME = "gugu-shell-v8";

// 게시글 이미지(ImgBB 등)는 내용이 절대 안 바뀌는 파일이라 여기는 반대로
// "한 번 받으면 그대로 재사용"하는 별도 캐시를 둬요. 강제 새로고침을 해도
// 이 캐시는 안 지워지니까 사진이 매번 다시 다운로드되는 걸 막아줘요.
const IMG_CACHE_NAME = "gugu-images-v1";
const IMG_CACHE_MAX = 500; // 이 개수를 넘으면 오래 전에 저장된 것부터 지워요 (무한정 커지는 것 방지)

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE_NAME && n !== IMG_CACHE_NAME) // 이미지 캐시는 지우지 않음
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
});

function isImageRequest(req) {
  if (req.destination === "image") return true;
  try {
    const u = new URL(req.url);
    if (/\.(jpe?g|png|gif|webp|avif|bmp)$/i.test(u.pathname)) return true;
    if (u.hostname.includes("ibb.co")) return true; // ImgBB (i.ibb.co / ibb.co)
  } catch (e) {}
  return false;
}

// 이미지 캐시가 너무 커지지 않도록, 개수를 넘으면 오래된 것부터 정리해요.
async function trimImageCache() {
  const cache = await caches.open(IMG_CACHE_NAME);
  const keys = await cache.keys();
  const excess = keys.length - IMG_CACHE_MAX;
  if (excess > 0) {
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // ---------- 게시글 이미지: 캐시 우선, 없으면 받아서 저장 ----------
  // 강제 새로고침을 해도 서비스워커 캐시(Cache Storage)는 그대로 남아있어서
  // 이미 본 사진은 다시 다운로드하지 않고 바로 보여줄 수 있어요.
  if (isImageRequest(req)) {
    event.respondWith(
      caches.open(IMG_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            cache.put(req, res.clone());
            trimImageCache();
          }
          return res;
        } catch (e) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // 우리 사이트(같은 출처) 파일이 아니면(Firebase API, 구글 폰트 등) 관여하지 않아요.
  if (new URL(req.url).origin !== self.location.origin) return;

  // ---------- 사이트 껍데기(HTML/CSS/JS): 네트워크 우선, 실패하면 캐시 ----------
  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
      )
  );
});
