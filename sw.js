// 서비스워커: 사이트 껍데기(HTML/CSS/JS/아이콘)만 캐싱해서 재방문 시 빠르게 뜨게 해요.
// 게시글/이미지 데이터는 Firebase·ImgBB에서 오는 거라 여기서는 건드리지 않아요(항상 최신 데이터를 가져옴).
//
// 사이트를 한창 자주 업데이트하는 중이라, CSS/JS도 "일단 저장된 것부터 보여주기"가 아니라
// HTML처럼 "새 버전을 먼저 받아오고 실패했을 때만 저장된 것으로 대체"하도록 함.
// (저장된 옛날 CSS가 최신 HTML 구조랑 안 맞아서 스타일이 깨지는 문제 방지)
const CACHE_NAME = "gugu-shell-v7";
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
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // GET 요청 + 우리 사이트(같은 출처)일 때만 관여해요.
  // Firebase/ImgBB/구글 폰트 같은 외부 요청은 그대로 통과시켜서 정상 동작을 보장해요.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  // 모든 우리 사이트 파일(HTML/CSS/JS/아이콘)은 네트워크를 먼저 시도하고,
  // 오프라인이라 실패할 때만 저장된 걸로 대체해요 (항상 최신 파일을 우선 보여줌).
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
