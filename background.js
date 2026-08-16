// 이미지 업로드용 Cloudinary 설정 (홈페이지 app.js와 동일한 계정/preset을 그대로 씀).
// unsigned upload preset이라 시크릿 키 없이도 이 값만으로 업로드가 가능해요.
const CLOUDINARY_CLOUD_NAME = "uzmdyc7a";
const CLOUDINARY_UPLOAD_PRESET = "dudwls";

// ---------- 저장된 설정 읽기/쓰기 ----------
async function getSettings() {
  const s = await chrome.storage.local.get([
    "apiKey", "projectId", "adminEmail",
    "idToken", "refreshToken", "tokenExpiresAt"
  ]);
  return s;
}

async function saveSettings(obj) {
  await chrome.storage.local.set(obj);
}

// ---------- Firebase Auth REST 로그인 (refreshToken 기반) ----------
async function ensureLogin() {
  const s = await getSettings();
  if (!s.apiKey || !s.adminEmail) {
    throw new Error("설정이 안 되어있어요. 확장프로그램 아이콘을 눌러 먼저 설정해주세요.");
  }
  const now = Date.now();
  if (s.idToken && s.tokenExpiresAt && now < s.tokenExpiresAt - 60000) {
    return s.idToken; // 아직 유효한 토큰
  }
  if (!s.refreshToken) {
    throw new Error("로그인 정보가 없어요. 확장프로그램 아이콘을 눌러 비밀번호를 다시 입력하고 저장해주세요.");
  }
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${s.apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: s.refreshToken }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error("로그인 갱신 실패: 확장프로그램 아이콘을 눌러 비밀번호를 다시 입력해주세요.");
  }
  const idToken = data.id_token;
  const expiresAt = Date.now() + Number(data.expires_in) * 1000;
  await saveSettings({ idToken, refreshToken: data.refresh_token, tokenExpiresAt: expiresAt });
  return idToken;
}

// ---------- 게시판 목록 가져오기 (공개 읽기) ----------
// 패널을 열 때마다 매번 새로 읽으면 Firestore 읽기 횟수만 늘어나니, 5분 동안은 캐시를 재사용해요.
const BOARDS_CACHE_TTL = 5 * 60 * 1000;

async function fetchBoards(force = false) {
  const s = await getSettings();
  if (!s.projectId) throw new Error("설정이 안 되어있어요. 확장프로그램 아이콘을 눌러 먼저 설정해주세요.");

  if (!force) {
    const cached = await chrome.storage.local.get(["boardsCache", "boardsCacheAt"]);
    if (cached.boardsCache && cached.boardsCacheAt && Date.now() - cached.boardsCacheAt < BOARDS_CACHE_TTL) {
      return cached.boardsCache;
    }
  }

  const url = `https://firestore.googleapis.com/v1/projects/${s.projectId}/databases/(default)/documents/boards?pageSize=200`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error("게시판 목록을 못 가져왔어요.");
  const docs = data.documents || [];
  const boards = docs
    .map(d => {
      const id = d.name.split("/").pop();
      const f = d.fields || {};
      return {
        id,
        type: f.type?.stringValue || "",
        name: f.name?.stringValue || "",
        isPrivate: f.isPrivate?.booleanValue || false,
        order: Number(f.order?.integerValue || f.order?.doubleValue || 0),
      };
    })
    .filter(b => b.type === "board")
    .sort((a, b) => a.order - b.order);

  await chrome.storage.local.set({ boardsCache: boards, boardsCacheAt: Date.now() });
  return boards;
}

// ---------- Firestore 문서 필드 변환 ----------
function toFirestoreValue(v) {
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  if (typeof v === "number") {
    return { integerValue: String(Math.trunc(v)) };
  }
  if (typeof v === "boolean") {
    return { booleanValue: v };
  }
  return { stringValue: String(v ?? "") };
}

function parseDateToISO(dateStr) {
  if (!dateStr) return new Date().toISOString();
  // "2026.07.28 20:15:40" 같은 표기를 "2026-07-28 20:15:40" 형태로만 정리 (날짜-시간 사이 공백은 유지)
  const cleaned = dateStr.trim().replace(/\./g, "-").replace(/-\s+/g, "-").replace(/\s+-/g, "-");
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

// ---------- 이미지를 ImgBB로 옮기기 ----------
// 여기(백그라운드 서비스워커)는 manifest의 host_permissions 덕분에, SOOP 이미지처럼
// CORS가 막힌 이미지도 페이지 안에서와 달리 그대로 fetch로 가져올 수 있어요.
// 그래서 채록소가 글을 올리는 바로 그 순간에 ImgBB로 옮겨서, 처음부터 안전한 링크로 저장돼요.
async function resizeImageBlob(blob, maxDim = 1600, quality = 0.85) {
  if (blob.type === "image/gif") return blob; // 움짤은 리사이즈하면 애니메이션이 깨지므로 원본 유지
  try {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    if (width <= maxDim && height <= maxDim) {
      bitmap.close();
      return blob;
    }
    const scale = Math.min(maxDim / width, maxDim / height);
    const newW = Math.round(width * scale);
    const newH = Math.round(height * scale);
    const canvas = new OffscreenCanvas(newW, newH);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, newW, newH);
    bitmap.close();
    const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return outBlob || blob;
  } catch (e) {
    return blob; // 리사이즈 실패하면 원본 그대로 업로드(안전망)
  }
}

async function fetchImageBlobWithRetry(srcUrl, attempts = 3) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const url = new URL(srcUrl);
      if (i > 0) url.searchParams.set("__soop_archiver_retry", `${Date.now()}_${i}`);

      const resp = await fetch(url.href, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        redirect: "follow",
        headers: {
          "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
        }
      });
      if (!resp.ok) throw new Error(`원본 이미지 HTTP ${resp.status} (${url.hostname})`);

      const blob = await resp.blob();
      if (!blob || !blob.size) throw new Error("빈 이미지 응답");

      // URL이 .jpg로 끝난다고 해서 HTML 404 페이지를 이미지로 취급하면 안 됩니다.
      // 실제 Content-Type을 우선하고, 서버가 타입을 비워 보내는 경우에만 파일 시그니처를 확인합니다.
      const type = (blob.type || "").toLowerCase();
      if (type.startsWith("image/")) return blob;

      const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
      const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
      const isGif = head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46;
      const isWebp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
      if (isJpeg || isPng || isGif || isWebp) return blob;

      throw new Error(`이미지가 아닌 응답(${type || "unknown"})`);
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 700 * (i + 1)));
    }
  }
  throw lastError || new Error("이미지를 가져오지 못함");
}

// ---------- iframe 호버방셀 원본 추출 ----------
// SOOP 게시글에 들어가는 w...-ihv iframe은 내부에
// .base-img / .overlay-img 두 장을 상대경로로 가지고 있습니다.
// iframe 자체를 ImgBB에 올리는 것이 아니라, 내부의 두 이미지를 추출해 각각 업로드합니다.
const hoverIframeCache = new Map();

async function resolveHoverIframeAssets(iframeUrl) {
  const key = String(iframeUrl || "").trim();
  if (!key) throw new Error("호버방셀 iframe 주소가 비어있어요.");
  if (hoverIframeCache.has(key)) return hoverIframeCache.get(key);

  let parsed;
  try { parsed = new URL(key); } catch (_) { throw new Error("호버방셀 iframe 주소가 올바르지 않아요."); }
  if (!/sidsid1823\.workers\.dev$/i.test(parsed.hostname) || !/-ihv\//i.test(parsed.pathname)) {
    throw new Error("지원하지 않는 호버방셀 iframe 주소예요.");
  }

  const resp = await fetch(parsed.href, {
    method: "GET",
    cache: "no-store",
    credentials: "include",
    redirect: "follow",
    headers: { "Accept": "text/html,application/xhtml+xml" }
  });
  if (!resp.ok) throw new Error(`호버방셀 iframe HTTP ${resp.status}`);
  const html = await resp.text();
  if (!html || html.length < 50) throw new Error("호버방셀 iframe 내용이 비어있어요.");

  // Chrome extension Service Worker에는 DOMParser가 없으므로 DOM 파싱을 사용하지 않습니다.
  // 이 iframe은 .base-img / .overlay-img 두 <img>를 포함하므로 문자열에서 직접 추출합니다.
  const imgTags = [];
  const imgRe = /<img\b[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = imgRe.exec(html))) imgTags.push(tagMatch[0]);

  const getAttr = (tag, name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp("\\b" + escaped + "\\s*=\\s*[\\\"']([^\\\"']*)[\\\"']", "i");
    const m = tag.match(re);
    return m ? m[1] : "";
  };
  const hasClass = (tag, cls) => {
    const c = getAttr(tag, "class");
    return new RegExp("(?:^|\\s)" + cls + "(?:\\s|$)", "i").test(c);
  };
  const resolveImgTag = (tag) => {
    const raw = getAttr(tag, "src") || getAttr(tag, "data-src") || getAttr(tag, "data-original");
    if (raw) {
      try { return new URL(raw, parsed.href).href; } catch (_) {}
    }
    const srcset = getAttr(tag, "srcset");
    if (srcset) {
      const first = srcset.split(",").map(x => x.trim()).filter(Boolean).pop();
      const rawSrc = first ? first.split(/\s+/)[0] : "";
      try { return rawSrc ? new URL(rawSrc, parsed.href).href : ""; } catch (_) {}
    }
    return "";
  };

  const baseTag = imgTags.find(tag => hasClass(tag, "base-img")) || imgTags[0];
  const overlayTag = imgTags.find(tag => hasClass(tag, "overlay-img")) || imgTags[1];
  if (!baseTag || !overlayTag) throw new Error("호버방셀 iframe에서 이미지 2장을 찾지 못했어요.");

  const baseUrl = resolveImgTag(baseTag);
  const overlayUrl = resolveImgTag(overlayTag);
  if (!baseUrl || !overlayUrl) throw new Error("호버방셀 이미지 주소를 찾지 못했어요.");
  if (baseUrl === overlayUrl) throw new Error("호버방셀의 두 이미지 주소가 같아요.");

  const result = { baseUrl, overlayUrl };
  hoverIframeCache.set(key, result);
  return result;
}

function toCloudinaryThumb(url) {
  return url.replace("/upload/", "/upload/w_300,c_limit,q_auto/");
}

async function uploadImageUrlToCloudinary(srcUrl, attempts = 3) {
  // Cloudinary URL이어도 여기서 끝내면 안 됩니다.
  // 사용자가 원하는 것은 "SOOP에 남아 있는 원본을 다시 다운로드 → 내 Cloudinary에 복사"이므로
  // res.cloudinary.com URL도 반드시 fetch해서 새 업로드를 수행합니다.
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const blob = await fetchImageBlobWithRetry(srcUrl, 3);
      const resized = await resizeImageBlob(blob);

      const formData = new FormData();
      // 원본 확장자를 억지로 image.jpg로 고정하지 않습니다.
      // Cloudinary가 실제 MIME 타입을 보고 정상적으로 이미지로 검증할 수 있게 합니다.
      const ext = (resized.type.split("/")[1] || "jpg").replace("jpeg", "jpg").split(";")[0];
      formData.append("file", resized, `soop-image.${ext}`);
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: "POST",
        body: formData,
        cache: "no-store",
      });

      let data = null;
      try { data = await res.json(); } catch (_) {
        throw new Error(`Cloudinary가 JSON이 아닌 응답을 반환함 (HTTP ${res.status})`);
      }

      if (!res.ok || !data?.secure_url) {
        const apiMessage = data?.error?.message || `HTTP ${res.status}`;
        throw new Error(`Cloudinary 업로드 실패: ${apiMessage}`);
      }

      // 중요: 여기서 Cloudinary URL을 다시 fetch해서 '검증'하지 않습니다.
      // Cloudinary의 업로드 성공 응답 자체가 최종 URL의 근거이며,
      // 브라우저/확장프로그램의 CORS·리다이렉트 차이 때문에 정상 업로드를
      // '검증 실패'로 오판하지 않도록 합니다.
      const url = data.secure_url;
      const thumbUrl = toCloudinaryThumb(url);
      // Cloudinary는 unsigned 업로드에 클라이언트용 delete_url을 안 줍니다(삭제엔 API 시크릿 필요).
      const deleteUrl = null;
      // public_id는 나중에 게시글을 지울 때 서버(백엔드 함수)에서 실제 이미지를 지우는 데 필요해요.
      const publicId = data.public_id || null;
      return { url, thumbUrl, deleteUrl, publicId };
    } catch (e) {
      lastError = e;
      if (attempt < attempts - 1) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }

  throw lastError || new Error("Cloudinary 업로드 실패");
}

async function findDuplicateTitle(projectId, idToken, boardId, title) {
  if (!title) return false;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "posts" }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: [
            { fieldFilter: { field: { fieldPath: "boardId" }, op: "EQUAL", value: { stringValue: boardId } } },
            { fieldFilter: { field: { fieldPath: "title" }, op: "EQUAL", value: { stringValue: title } } },
          ],
        },
      },
      limit: 1,
    },
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) return false; // 조회 실패 시 업로드 자체는 막지 않음
    const data = await res.json();
    return Array.isArray(data) && data.some(row => row && row.document);
  } catch (e) {
    return false;
  }
}

// ---------- 게시글 업로드 ----------
async function uploadPost(payload) {
  const s = await getSettings();
  const idToken = await ensureLogin();

  const boards = await fetchBoards();
  const targetBoard = boards.find(b => b.id === payload.boardId);

  if (!payload.force) {
    const isDup = await findDuplicateTitle(s.projectId, idToken, payload.boardId, payload.title);
    if (isDup) {
      const err = new Error("이미 같은 제목의 글이 이 게시판에 있어요.");
      err.duplicate = true;
      throw err;
    }
  }

  // 이미지를 Cloudinary로 옮깁니다. 하나라도 실패하면 원본 URL을 몰래 저장하지 않고
  // 정확한 실패 원인을 사용자에게 돌려줍니다. (복구 목적에서는 죽은 원본 링크를
  // 홈페이지에 저장하는 것이 가장 위험한 동작입니다.)
  let imageUrls = [];
  let imageThumbUrls = [];
  let imageDeleteUrls = [];
  let imagePublicIds = [];
  let results = [];
  if (payload.images && payload.images.length > 0) {
    results = [];
    for (let index = 0; index < payload.images.length; index++) {
      const src = payload.images[index];
      try {
        results.push(await uploadImageUrlToCloudinary(src));
      } catch (e) {
        console.error(`[SOOP Archiver] 이미지 ${index + 1} 복구/Cloudinary 업로드 실패`, src, e);
        throw new Error(`사진 ${index + 1} 업로드 실패: ${e.message} (원본: ${src})`);
      }
    }
    imageUrls = results.map(r => r.url);
    imageThumbUrls = results.map(r => r.thumbUrl);
    imageDeleteUrls = results.map(r => r.deleteUrl || null);
    imagePublicIds = results.map(r => r.publicId || null);
  }

  // 호버방셀: 기본(평상시) 이미지 + 호버(마우스오버) 이미지를 각각 Cloudinary로 옮깁니다.
  // 같은 원본 URL은 일반 이미지와 호버방셀 사이에서도 한 번만 업로드합니다.
  const uploadedCache = new Map();
  async function uploadCached(src) {
    if (!src) throw new Error("호버방셀 이미지 URL이 비어있어요.");
    if (uploadedCache.has(src)) return uploadedCache.get(src);
    const result = await uploadImageUrlToCloudinary(src);
    uploadedCache.set(src, result);
    return result;
  }

  // 위의 일반 이미지 업로드 결과를 캐시에 넣어 호버방셀과 중복 업로드되지 않게 합니다.
  results.forEach((r, i) => {
    const src = payload.images?.[i];
    if (src) uploadedCache.set(src, r);
  });

  let hoverCells = [];
  let hoverCellDeleteUrls = [];
  let hoverCellPublicIds = [];
  if (Array.isArray(payload.hoverCells) && payload.hoverCells.length) {
    for (let i = 0; i < payload.hoverCells.length; i++) {
      const cell = payload.hoverCells[i] || {};
      try {
        // iframe 방식이면 먼저 iframe 내부에서 실제 기본/호버 이미지를 추출합니다.
        let baseSource = cell.baseUrl || cell.base || cell.overlayUrl || cell.overlay;
        let overlaySource = cell.overlayUrl || cell.overlay || cell.baseUrl || cell.base;
        if (cell.iframeUrl) {
          const resolved = await resolveHoverIframeAssets(cell.iframeUrl);
          baseSource = resolved.baseUrl;
          overlaySource = resolved.overlayUrl;
        }
        const overlay = await uploadCached(overlaySource);
        const base = await uploadCached(baseSource);
        const item = {
          overlayUrl: overlay.url,
          baseUrl: base.url,
          overlayThumbUrl: overlay.thumbUrl,
          baseThumbUrl: base.thumbUrl,
          revealMode: cell.revealMode || "fade",
          borderRadius: Number.isFinite(Number(cell.borderRadius)) ? Number(cell.borderRadius) : 22,
          speed: Number.isFinite(Number(cell.speed)) ? Number(cell.speed) : 100,
          intensity: Number.isFinite(Number(cell.intensity)) ? Number(cell.intensity) : 60,
          accentColor: cell.accentColor || "#ffd66b"
        };
        hoverCells.push(item);
        hoverCellDeleteUrls.push(overlay.deleteUrl || null, base.deleteUrl || null);
        hoverCellPublicIds.push(overlay.publicId || null, base.publicId || null);
      } catch (e) {
        throw new Error(`호버방셀 ${i + 1} 업로드 실패: ${e.message}`);
      }
    }
  }

  const fields = {
    boardId: toFirestoreValue(payload.boardId),
    title: toFirestoreValue(payload.title),
    content: toFirestoreValue(payload.content),
    author: toFirestoreValue(payload.author),
    views: toFirestoreValue(0),
    createdAt: { timestampValue: parseDateToISO(payload.date) },
    isPrivate: toFirestoreValue(!!(targetBoard && targetBoard.isPrivate)),
  };
  if (imageUrls.length > 0) {
    fields.imageUrls = toFirestoreValue(imageUrls);
    fields.imageThumbUrls = toFirestoreValue(imageThumbUrls);
    fields.imageDeleteUrls = toFirestoreValue(imageDeleteUrls);
    fields.imagePublicIds = toFirestoreValue(imagePublicIds);
    fields.imageUrl = toFirestoreValue(imageUrls[0]);
  }
  if (hoverCells.length > 0) {
    fields.hoverCellsJson = toFirestoreValue(JSON.stringify(hoverCells));
    fields.hoverCellDeleteUrls = toFirestoreValue(hoverCellDeleteUrls);
    fields.hoverCellPublicIds = toFirestoreValue(hoverCellPublicIds);
  }

  const url = `https://firestore.googleapis.com/v1/projects/${s.projectId}/databases/(default)/documents/posts`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error("업로드 실패: " + (data.error?.message || "알 수 없는 오류"));
  }
  return data;
}

// ---------- 이미지 다운로드 ----------
async function downloadImages(images, folderName) {
  const safe = (folderName || "게시글").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  await Promise.all(images.map((src, i) => {
    let ext = "jpg";
    const m = src.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
    if (m) ext = m[1].toLowerCase();
    return chrome.downloads.download({
      url: src,
      filename: `채록소/${safe}/img_${String(i + 1).padStart(2, "0")}.${ext}`,
      saveAs: false,
    }).catch(() => {});
  }));
}

// ---------- 메시지 라우팅 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "TEST_LOGIN") {
        await ensureLogin();
        sendResponse({ ok: true });
      } else if (msg.type === "GET_BOARDS") {
        const boards = await fetchBoards(!!msg.force);
        sendResponse({ ok: true, boards });
      } else if (msg.type === "UPLOAD_POST") {
        await uploadPost(msg.payload);
        sendResponse({ ok: true });
      } else if (msg.type === "DOWNLOAD_IMAGES") {
        await downloadImages(msg.images, msg.folderName);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "알 수 없는 요청" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message, duplicate: !!e.duplicate });
    }
  })();
  return true; // 비동기 응답
});
