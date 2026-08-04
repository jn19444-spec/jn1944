// 서비스워커: 사이트 껍데기(HTML/CSS/JS/아이콘)만 캐싱해서 재방문 시 빠르게 뜨게 해요.
// 게시글/이미지 데이터는 Firebase·ImgBB에서 오는 거라 여기서는 건드리지 않아요(항상 최신 데이터를 가져옴).
const CACHE_NAME = "gugu-shell-v4";
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

  // HTML 문서는 네트워크를 우선 시도하고, 오프라인이면 캐시로 대체(항상 최신 화면을 우선함).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // CSS/JS/아이콘 같은 정적 파일은 캐시를 먼저 보여주고, 뒤에서 최신 버전으로 갱신해요.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
