import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, orderBy, addDoc, doc,
  deleteDoc, getDocs, getDoc, setDoc, serverTimestamp, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ImgBB 이미지 업로드용 API 키 (https://api.imgbb.com/ 에서 무료 발급)
const IMGBB_API_KEY = "9e855746835f598edb43a283d0219413";

// 음악 파일 업로드용 Cloudinary 설정 (https://cloudinary.com 무료 가입 후 발급)
// 1) cloudinary.com 가입 → 대시보드에서 "Cloud name" 확인
// 2) Settings → Upload → Upload presets → "Add upload preset" → Signing Mode를 Unsigned로 설정 → 이름 확인
// 아래 두 값을 본인 계정 값으로 바꿔주세요.
const CLOUDINARY_CLOUD_NAME = "uzmdyc7a";
const CLOUDINARY_UPLOAD_PRESET = "dudwls";

// 게시판 구조는 이제 코드가 아니라 Firestore("boards" 컬렉션)에 저장됩니다.
// 사이드바 아래 "게시판 관리" 버튼(관리자 로그인 후 보임)으로 추가/삭제하세요.
const DEFAULT_SEED = [
  { type: "group", name: "티아 전용 공간" },
  { type: "board", name: "🌸 레티아", isPrivate: false },
  { type: "board", name: "울보 내새끼 띠아 🧡", isPrivate: false },
  { type: "divider", name: "" },
  { type: "group", name: "버추얼방셀" },
  { type: "board", name: "버추얼 방셀", isPrivate: false },
  { type: "divider", name: "" },
  { type: "group", name: "방셀" },
  { type: "board", name: "다에나", isPrivate: false },
  { type: "board", name: "애순이", isPrivate: false },
  { type: "board", name: "방셀", isPrivate: false },
  { type: "divider", name: "" },
  { type: "group", name: "개인공간" },
  { type: "board", name: "주저리", isPrivate: false },
  { type: "board", name: "비공개", isPrivate: true },
  { type: "board", name: "쓰레기통", isPrivate: false },
];

// ---------- 아이디 로그인용 유틸 ----------
// Firebase Authentication은 이메일 기반이라, 아이디를 내부적으로 가짜 이메일로 변환해서 사용해요.
// 화면에는 이메일이 절대 노출되지 않고 아이디만 보여요.
const ID_EMAIL_DOMAIN = "gugufan.local";
const ID_PATTERN = /^[a-zA-Z0-9_]{3,20}$/; // 영문, 숫자, 밑줄만 / 3~20자

function idToEmail(id) {
  return `${id.trim().toLowerCase()}@${ID_EMAIL_DOMAIN}`;
}
function emailToId(email) {
  return (email || "").split("@")[0];
}

let currentUser = null;
let isAdmin = false;
let canViewPrivate = false; // 회원이 비공개 게시판 열람 권한을 받았는지
let currentBoardId = null;
let currentBoard = null;
let boardRows = []; // Firestore "boards" 컬렉션의 각 행 (그룹/게시판/구분선)
let editingPostId = null; // null이면 새 글쓰기, 값이 있으면 그 글을 수정하는 중
let editingPostBoardId = null; // 수정 중인 글이 원래 속한 게시판(캐시 무효화용)

// ---------- 음악 플레이어 상태 ----------
let musicTracks = []; // Firestore "musicTracks" 컬렉션 (모두에게 공개, 관리자만 추가/삭제)
let editingMusicId = null; // null이면 새 곡 추가, 값이 있으면 그 곡을 수정하는 중
let pendingMusicUpload = null; // { url, title(파일명에서 추출) } - 업로드는 됐지만 아직 저장 전인 파일
let currentTrackIndex = -1; // 현재 재생 중(혹은 마지막 재생)인 트랙의 musicTracks 내 인덱스
let isMusicPlaying = false;
let repeatMode = "off"; // "off" | "all" | "one"
let shuffleMode = false;
let didInitialRoute = false; // 첫 로딩 때 한 번만 주소창(경로)을 보고 화면을 복원함
let selectedImageUrls = []; // 글쓰기 폼에서 업로드된(또는 기존) 이미지 URL 목록
let selectedImageThumbUrls = []; // 위 이미지들과 같은 순서의 목록용 작은 썸네일 URL

let topMenuItems = []; // Firestore "topMenus" 컬렉션 (order 오름차순)
let topMenuImageUrls = []; // 상단메뉴 편집 폼에서 업로드된(또는 기존) 이미지 URL 목록
let topMenuImageThumbUrls = []; // 위 이미지들과 같은 순서의 작은 썸네일 URL
let editingTopMenuId = null; // null이면 새 메뉴 추가, 값이 있으면 그 메뉴를 수정하는 중

const POSTS_PER_PAGE = 15; // 한 번에 보여줄 게시글 수 (더보기/무한스크롤 배치 크기)
let currentListEntries = []; // 현재 목록 화면에 표시 중인 게시글들 (최신순 정렬됨)
let currentVisibleCount = 0; // 지금까지 화면에 표시된 개수

const el = (id) => document.getElementById(id);

// ---------- 게시판/게시글 공개 범위 ----------
// "public"(전체 공개) / "members"(로그인한 회원에게만 공개) / "private"(권한 받은 회원+관리자만)
// 예전 데이터는 visibility 필드가 없고 isPrivate(true/false)만 있어서, 없으면 isPrivate로부터 자동 변환해요.
function getVisibility(row) {
  if (!row) return "public";
  if (row.visibility) return row.visibility;
  return row.isPrivate ? "private" : "public";
}
function canViewBoard(row) {
  const vis = getVisibility(row);
  if (vis === "private") return isAdmin || canViewPrivate;
  if (vis === "members") return isAdmin || !!currentUser; // 로그인만 하면(승인된 회원) 열람 가능
  return true; // public
}
function visibilityIcon(row) {
  const vis = getVisibility(row);
  return vis === "private" ? "🔒 " : vis === "members" ? "👥 " : "";
}
function visibilityLabel(vis) {
  return vis === "private" ? "🔒 비공개 (권한 받은 회원만)"
    : vis === "members" ? "👥 회원공개 (로그인하면 누구나)"
    : "🌐 전체공개";
}

// ---------- 게시판별 게시글 캐시 ----------
// 게시판 A → B → 다시 A로 이동할 때마다 매번 새로 불러오지 않도록,
// 한 번 불러온 게시판의 글 목록을 메모리에 잠깐 기억해둬요.
// 글쓰기/수정/삭제/이동/공개상태 변경처럼 실제로 데이터가 바뀔 때만 해당 게시판 캐시를 지워요.
const postsCache = new Map(); // boardId -> QueryDocumentSnapshot[]

async function fetchBoardPosts(boardId) {
  if (postsCache.has(boardId)) return postsCache.get(boardId);
  const q = query(collection(db, "posts"), where("boardId", "==", boardId));
  const snap = await getDocs(q);
  postsCache.set(boardId, snap.docs);
  return snap.docs;
}

function invalidateBoardCache(boardId) {
  if (boardId) postsCache.delete(boardId);
  else postsCache.clear(); // 인자 없이 호출하면 전체 캐시를 비움(대량 작업 후)
}

// 게시판을 빠르게 이동/검색할 때, 먼저 보낸 요청이 늦게 응답이 와서
// 나중 화면을 덮어쓰지 않도록 "가장 최근 요청"만 반영되게 하는 장치
let navToken = 0;

// 배열을 한 번에 limit개씩 동시에 처리 (전부 한꺼번에 하면 브라우저/ImgBB에 부담이 커서 개수를 제한함)
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------- URL 라우팅 ----------
// SOOP처럼 주소가 /board, /board/<postId> 형태로 남게 해서, 새로고침하거나 링크를 그대로
// 공유해도 같은 화면이 열리게 해요. (실제로 동작하려면 호스팅에서 이 경로들을 전부
// index.html로 보내주는 SPA rewrite 설정이 필요해요 — 같이 드리는 설정 파일 참고)
//
// 사이트가 도메인 맨 루트(Firebase/Vercel)가 아니라 GitHub Pages처럼 저장소 이름이 붙은
// 하위 경로(예: /jn1944/)에 있을 수도 있어서, app.js가 실제로 로드된 위치를 기준으로
// 그 하위 경로를 자동으로 찾아내요. 이러면 배포 위치가 바뀌어도 코드 수정이 필요 없어요.
const BASE_PATH = new URL(".", import.meta.url).pathname.replace(/\/$/, ""); // "" 또는 "/jn1944"

function buildUrl(path, params) {
  const url = new URL(location.origin + BASE_PATH + path);
  if (params) Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });
  return url.pathname + url.search;
}
function pushUrl(path, params) {
  const next = buildUrl(path, params);
  if (next !== location.pathname + location.search) history.pushState(null, "", next);
}
function replaceUrl(path, params) {
  history.replaceState(null, "", buildUrl(path, params));
}

async function routeFromLocation() {
  let rawPath = location.pathname;
  if (BASE_PATH && rawPath.startsWith(BASE_PATH)) rawPath = rawPath.slice(BASE_PATH.length);
  const path = rawPath.replace(/\/index\.html$/, "/").replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(location.search);

  if (path === "/admin") {
    if (isAdmin) {
      showAdminView();
      refreshPendingBadge();
      activateAdminTab("members");
    } else {
      replaceUrl("/");
    }
    return;
  }

  if (path === "/board") {
    const boardId = params.get("b");
    const keyword = params.get("q");
    if (boardId) {
      const row = boardRows.find(b => b.id === boardId && b.type === "board");
      if (row && canViewBoard(row)) {
        selectBoard(row, { skipUrl: true });
        return;
      }
    }
    if (keyword) {
      el("searchInput").value = keyword;
      performSearch({ skipUrl: true });
      return;
    }
    selectAllBoards({ skipUrl: true });
    return;
  }

  const postMatch = path.match(/^\/board\/([^/]+)$/);
  if (postMatch) {
    const found = await openPost(postMatch[1], { skipUrl: true });
    if (found === false) replaceUrl("/"); // 글이 없거나 권한이 없으면 홈으로
    return;
  }

  // "/" 또는 모르는 경로는 홈으로
  currentBoardId = null;
  currentBoard = null;
  el("writeBtn").classList.add("hidden");
  showListView();
  showHomeDashboard();
  renderBoardTree();
}
window.addEventListener("popstate", () => { routeFromLocation(); });

// ---------- 인증 상태 ----------
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  isAdmin = false;
  canViewPrivate = false;

  if (user) {
    // 관리자 확인 (사이트에 딱 한 명, config/site 문서에 저장됨)
    const configRef = doc(db, "config", "site");
    const configSnap = await getDoc(configRef).catch(() => null);
    if (configSnap && configSnap.exists()) {
      isAdmin = configSnap.data().adminUid === user.uid;
    } else {
      // 아직 관리자가 없으면(=배포 직후) 지금 로그인한 사람이 관리자가 됨
      try {
        await setDoc(configRef, { adminUid: user.uid });
        isAdmin = true;
      } catch (e) {
        isAdmin = false;
      }
    }

    if (!isAdmin) {
      // 회원 문서 확인: 문서가 없거나 승인 대기/차단 상태면 접근을 막아요.
      // (회원 문서는 회원가입 시에만 만들어져요 - approved 필드는 기본 true로 취급해 기존 회원은 그대로 이용 가능)
      const memberRef = doc(db, "members", user.uid);
      const memberSnap = await getDoc(memberRef).catch(() => null);
      if (memberSnap && memberSnap.exists()) {
        const data = memberSnap.data();
        if (data.approved === false) {
          await signOut(auth); // onAuthStateChanged가 user=null로 다시 호출되며 화면이 정리됨
          return;
        }
        canViewPrivate = !!data.canViewPrivate;
      } else {
        await signOut(auth);
        return;
      }
    } else {
      refreshPendingBadge();
    }
  } else {
    updatePendingBadge(0);
  }

  el("loginBtn").classList.toggle("hidden", !!user);
  el("signupBtn").classList.toggle("hidden", !!user);
  el("logoutBtn").classList.toggle("hidden", !user);
  el("adminMenuBtn").classList.toggle("hidden", !isAdmin);
  el("whoami").textContent = isAdmin ? "관리자로 로그인됨" : (user ? `회원으로 로그인됨 (${emailToId(user.email)})` : "");
  el("writeBtn").classList.toggle("hidden", !(isAdmin && currentBoard));
  el("musicWidget").classList.toggle("hidden", musicTracks.length === 0 && !isAdmin);

  await loadBoardConfig();
  if (!didInitialRoute) {
    didInitialRoute = true;
    await routeFromLocation();
  } else if (!el("adminView").classList.contains("hidden")) {
    refreshPendingBadge(); // 관리자 화면을 보는 중이면 뱃지만 갱신
  } else if (currentBoardId === "__all__") loadAllPosts();
  else if (currentBoardId === "__search__") performSearch({ skipUrl: true });
  else if (currentBoardId) loadPosts(currentBoardId);
});

el("loginBtn").addEventListener("click", () => el("loginModal").classList.remove("hidden"));
el("loginCancelBtn").addEventListener("click", () => el("loginModal").classList.add("hidden"));
el("logoutBtn").addEventListener("click", () => signOut(auth));

el("loginSubmitBtn").addEventListener("click", async () => {
  const id = el("loginEmail").value.trim();
  const pw = el("loginPassword").value;
  el("loginError").classList.add("hidden");
  if (!id || !pw) {
    el("loginError").textContent = "아이디와 비밀번호를 입력해주세요.";
    el("loginError").classList.remove("hidden");
    return;
  }
  try {
    const cred = await signInWithEmailAndPassword(auth, idToEmail(id), pw);

    // 관리자는 승인 체크 없이 통과, 회원은 승인된 계정인지 확인
    const configSnap = await getDoc(doc(db, "config", "site")).catch(() => null);
    const loggedInIsAdmin = !!(configSnap && configSnap.exists() && configSnap.data().adminUid === cred.user.uid);
    if (!loggedInIsAdmin) {
      const memberSnap = await getDoc(doc(db, "members", cred.user.uid)).catch(() => null);
      const approved = !!(memberSnap && memberSnap.exists() && memberSnap.data().approved !== false);
      if (!approved) {
        await signOut(auth);
        el("loginError").textContent = "가입 승인 대기 중이거나 접근이 제한된 계정이에요. 관리자에게 문의해주세요.";
        el("loginError").classList.remove("hidden");
        return;
      }
    }

    el("loginModal").classList.add("hidden");
    el("loginEmail").value = "";
    el("loginPassword").value = "";
  } catch (e) {
    el("loginError").textContent = "로그인 실패: 아이디/비밀번호를 확인해주세요.";
    el("loginError").classList.remove("hidden");
  }
});

el("signupBtn").addEventListener("click", () => el("signupModal").classList.remove("hidden"));
el("signupCancelBtn").addEventListener("click", () => el("signupModal").classList.add("hidden"));

[el("loginEmail"), el("loginPassword")].forEach(inp => {
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") el("loginSubmitBtn").click(); });
});
[el("signupEmail"), el("signupPassword")].forEach(inp => {
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") el("signupSubmitBtn").click(); });
});

el("signupSubmitBtn").addEventListener("click", async () => {
  const id = el("signupEmail").value.trim();
  const pw = el("signupPassword").value;
  el("signupError").classList.add("hidden");

  if (!ID_PATTERN.test(id)) {
    el("signupError").textContent = "아이디는 영문/숫자/밑줄(_)만 사용해 3~20자로 입력해주세요.";
    el("signupError").classList.remove("hidden");
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, idToEmail(id), pw);
    // 회원 문서를 승인 대기 상태로 생성하고, 바로 로그아웃시켜서
    // 관리자가 승인하기 전까지는 로그인해도 다시 튕겨나가게 해요.
    await setDoc(doc(db, "members", cred.user.uid), {
      username: id,
      joinedAt: serverTimestamp(),
      canViewPrivate: false,
      approved: false,
    });
    await signOut(auth);
    el("signupModal").classList.add("hidden");
    el("signupEmail").value = "";
    el("signupPassword").value = "";
    alert("가입 신청이 완료됐어요!\n관리자가 승인하면 로그인할 수 있어요.");
  } catch (e) {
    el("signupError").textContent = "가입 실패: " + (e.code === "auth/email-already-in-use" ? "이미 사용 중인 아이디예요." : e.code === "auth/weak-password" ? "비밀번호는 6자 이상이어야 해요." : "입력값을 확인해주세요.");
    el("signupError").classList.remove("hidden");
  }
});

// ---------- 관리자 메뉴 (전체 화면) ----------
el("adminMenuBtn").addEventListener("click", () => {
  showAdminView();
  refreshPendingBadge();
  el("migrateStatus").textContent = "";
  el("migrateLog").innerHTML = "";
  activateAdminTab("members");
  pushUrl("/admin");
});
el("adminBackBtn").addEventListener("click", () => {
  showListView();
  if (currentBoardId === "__all__") { loadAllPosts(); pushUrl("/board"); }
  else if (currentBoardId === "__search__") { performSearch({ skipUrl: true }); pushUrl("/board", { q: el("searchInput").value.trim() }); }
  else if (currentBoardId) { loadPosts(currentBoardId); pushUrl("/board", { b: currentBoardId }); }
  else { showHomeDashboard(); pushUrl("/"); }
});

// 탭 이름 → 그 탭이 열릴 때 새로 불러와야 할 데이터
const ADMIN_TAB_LOADERS = {
  members: loadMemberList,
  posts: loadPostAdminList,
  boards: renderManageList,
  topmenu: loadTopMenuAdminTab,
  music: loadMusicAdminTab,
  stats: loadStats,
  site: fillSiteSettingsForm,
};

function activateAdminTab(tabName) {
  document.querySelectorAll(".admin-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tabName));
  document.querySelectorAll(".admin-panel").forEach(p => p.classList.add("hidden"));
  const panel = el("adminTab" + tabName.charAt(0).toUpperCase() + tabName.slice(1));
  if (panel) panel.classList.remove("hidden");
  const loader = ADMIN_TAB_LOADERS[tabName];
  if (loader) loader();
}

document.querySelectorAll(".admin-tab").forEach(tab => {
  tab.addEventListener("click", () => activateAdminTab(tab.dataset.tab));
});

// ---------- 회원 관리 (승인/차단/삭제) ----------

let allMembers = []; // Firestore에서 불러온 전체 회원 (필터/검색은 이 배열로 클라이언트에서 처리)
let memberFilter = "all"; // all | pending | approved
let memberSearchTerm = "";

el("memberSearchInput").addEventListener("input", (e) => {
  memberSearchTerm = e.target.value.trim().toLowerCase();
  renderMemberList();
});

document.querySelectorAll(".member-filter-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".member-filter-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    memberFilter = tab.dataset.filter;
    renderMemberList();
  });
});

el("approveAllBtn").addEventListener("click", async () => {
  const pending = allMembers.filter(m => m.approved === false);
  if (!pending.length) return;
  if (!confirm(`승인대기 중인 회원 ${pending.length}명을 한번에 승인할까요?`)) return;
  const btn = el("approveAllBtn");
  btn.disabled = true;
  try {
    await Promise.all(pending.map(m => updateDoc(doc(db, "members", m.id), { approved: true })));
    await loadMemberList();
  } finally {
    btn.disabled = false;
  }
});

el("migrateImagesBtn").addEventListener("click", migrateAllImages);

async function migrateAllImages() {
  const statusEl = el("migrateStatus");
  const logEl = el("migrateLog");
  const btn = el("migrateImagesBtn");
  logEl.innerHTML = "";
  btn.disabled = true;
  statusEl.textContent = "게시글을 불러오는 중...";

  const snap = await getDocs(collection(db, "posts"));
  const toProcess = snap.docs.filter(docSnap => {
    const p = docSnap.data();
    return getImages(p).length && !p.imagesResized; // 이미 처리 끝난 글은 대상에서 제외
  });

  let postsChanged = 0, imagesMigrated = 0, imagesFailed = 0, done = 0;
  const total = toProcess.length;
  statusEl.textContent = total ? `처리 중... (0/${total})` : "재업로드할 게시글이 없어요.";

  async function processOnePost(docSnap) {
    const p = docSnap.data();
    const images = getImages(p);
    const oldThumbs = getThumbs(p);

    // 한 게시글 안의 사진들은 동시에 가져와서 올림 (순서는 그대로 유지됨)
    const results = await Promise.all(images.map(async (url, j) => {
      try {
        const resp = await fetch(url, { mode: "cors" });
        if (!resp.ok) throw new Error("이미지를 가져오지 못함");
        const blob = await resp.blob();
        const file = new File([blob], "image.jpg", { type: blob.type || "image/jpeg" });
        const { url: newUrl, thumbUrl } = await uploadToImgBB(file); // 리사이즈 후 재업로드
        return { ok: true, url: newUrl, thumbUrl };
      } catch (err) {
        return { ok: false, url, thumbUrl: oldThumbs[j] || url };
      }
    }));

    results.forEach((r, j) => {
      if (r.ok) {
        imagesMigrated++;
      } else {
        imagesFailed++;
        const row = document.createElement("div");
        row.className = "manage-row";
        row.innerHTML = `<span class="manage-row-label" style="color:var(--accent-rose); font-size:12px;">실패: "${escapeHtml(p.title || "")}" → ${escapeHtml(images[j])}</span>`;
        logEl.appendChild(row);
      }
    });

    const changed = results.some(r => r.ok);
    const postFailed = results.some(r => !r.ok);
    const updates = {};
    if (changed) {
      updates.imageUrls = results.map(r => r.url);
      updates.imageThumbUrls = results.map(r => r.thumbUrl);
    }
    if (!postFailed) updates.imagesResized = true; // 실패한 이미지가 있으면 표시 안 해서 다음 실행 때 다시 시도됨
    if (Object.keys(updates).length) {
      await updateDoc(docSnap.ref, updates);
      if (changed) postsChanged++;
    }

    done++;
    statusEl.textContent = `처리 중... (${done}/${total})`;
  }

  // 게시글 3개씩 동시에 처리 (전부 한꺼번에 하면 브라우저/ImgBB에 부담이 커서 개수 제한)
  await mapWithConcurrency(toProcess, 3, processOnePost);

  btn.disabled = false;
  invalidateBoardCache(); // 여러 게시판의 이미지가 한꺼번에 바뀌었으니 전체 캐시를 비움
  statusEl.textContent = `완료! 게시글 ${postsChanged}개 업데이트 · 이미지 ${imagesMigrated}개 성공 · ${imagesFailed}개 실패` +
    (imagesFailed ? " (실패한 이미지는 아래 목록을 참고해서 직접 다운받아 수정하기 화면에서 다시 올려주세요)" : "");
}

// ---------- 이미지 미리 받아두기 (이 브라우저의 서비스워커 캐시를 미리 채움) ----------
// 이 브라우저에서 fetch()로 한 번 요청만 해줘도, sw.js의 fetch 이벤트가 그걸 가로채서
// 알아서 캐시(gugu-images)에 저장해줘요. 그래서 여기선 그냥 모든 이미지 URL에
// 순서대로(동시 개수 제한해서) 요청만 날려주면 "미리 받기"가 완성돼요.
// ⚠ 서비스워커 캐시는 브라우저마다 따로 저장되기 때문에, 이 버튼은 지금 누른
// 이 브라우저에만 효과가 있고 다른 사람 화면에는 영향을 주지 않아요.
el("prewarmImagesBtn").addEventListener("click", prewarmImageCache);

async function prewarmImageCache() {
  const statusEl = el("prewarmStatus");
  const btn = el("prewarmImagesBtn");
  btn.disabled = true;
  statusEl.textContent = "게시글을 불러오는 중...";

  const snap = await getDocs(collection(db, "posts"));
  const urlSet = new Set();
  snap.docs.forEach(docSnap => {
    const p = docSnap.data();
    getImages(p).forEach(u => u && urlSet.add(u));
    getThumbs(p).forEach(u => u && urlSet.add(u));
  });
  const urls = Array.from(urlSet);

  if (!urls.length) {
    statusEl.textContent = "미리 받을 이미지가 없어요.";
    btn.disabled = false;
    return;
  }

  let done = 0, failed = 0;
  statusEl.textContent = `받는 중... (0/${urls.length})`;

  await mapWithConcurrency(urls, 6, async (url) => {
    try {
      const res = await fetch(url);
      if (!res.ok) failed++;
    } catch (e) {
      failed++;
    }
    done++;
    statusEl.textContent = `받는 중... (${done}/${urls.length})`;
  });

  btn.disabled = false;
  statusEl.textContent = `완료! 이 브라우저에 이미지 ${urls.length - failed}개를 저장해뒀어요.` +
    (failed ? ` (${failed}개는 실패 — 원본 링크가 깨졌거나 지금 접속이 안 되는 이미지예요)` : "");
}

async function loadMemberList() {
  const listEl = el("memberList");
  listEl.innerHTML = "불러오는 중...";
  const snap = await getDocs(collection(db, "members"));
  allMembers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  updatePendingBadge(allMembers.filter(m => m.approved === false).length);
  renderMemberList();
}

function renderMemberList() {
  const listEl = el("memberList");

  if (!allMembers.length) {
    listEl.innerHTML = `<p class="empty-state">아직 가입한 회원이 없어요.</p>`;
    el("memberSummaryText").textContent = "";
    el("approveAllBtn").classList.add("hidden");
    return;
  }

  const pendingCount = allMembers.filter(m => m.approved === false).length;
  el("memberSummaryText").textContent = `전체 ${allMembers.length}명 · 승인대기 ${pendingCount}명`;
  el("approveAllBtn").classList.toggle("hidden", pendingCount === 0);

  let members = allMembers.filter(m => {
    if (memberFilter === "pending" && m.approved !== false) return false;
    if (memberFilter === "approved" && m.approved === false) return false;
    if (memberSearchTerm) {
      const name = (m.username || m.email || m.id || "").toLowerCase();
      if (!name.includes(memberSearchTerm)) return false;
    }
    return true;
  });

  // 승인 대기 회원을 위로, 그다음 최근 가입순
  members.sort((a, b) => {
    const aPending = a.approved === false ? 0 : 1;
    const bPending = b.approved === false ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    const at = a.joinedAt && a.joinedAt.toDate ? a.joinedAt.toDate().getTime() : 0;
    const bt = b.joinedAt && b.joinedAt.toDate ? b.joinedAt.toDate().getTime() : 0;
    return bt - at;
  });

  if (!members.length) {
    listEl.innerHTML = `<p class="empty-state">조건에 맞는 회원이 없어요.</p>`;
    return;
  }

  listEl.innerHTML = "";
  members.forEach(m => {
    const approved = m.approved !== false;
    const row = document.createElement("div");
    row.className = "manage-row";
    row.innerHTML = `
      <div class="member-row-info">
        <span class="member-row-email">${escapeHtml(m.username || m.email || m.id)}</span>
        <span class="member-row-meta">
          <span class="status-pill ${approved ? "approved" : "pending"}">${approved ? "승인됨" : "승인대기"}</span>
          <span>가입일 ${formatDate(m.joinedAt) || "-"}</span>
        </span>
      </div>
      <span class="manage-row-actions member-row-actions">
        <label class="checkbox-label">
          <input type="checkbox" data-role="private" ${m.canViewPrivate ? "checked" : ""}> 비공개 열람
        </label>
        ${approved ? `<button data-act="block">차단</button>` : `<button data-act="approve">승인</button>`}
        <button data-act="delete" class="danger">삭제</button>
      </span>
    `;

    row.querySelector('[data-role="private"]').addEventListener("change", async (e) => {
      await updateDoc(doc(db, "members", m.id), { canViewPrivate: e.target.checked });
      const found = allMembers.find(x => x.id === m.id);
      if (found) found.canViewPrivate = e.target.checked;
    });

    const approveBtn = row.querySelector('[data-act="approve"]');
    if (approveBtn) {
      approveBtn.addEventListener("click", async () => {
        await updateDoc(doc(db, "members", m.id), { approved: true });
        loadMemberList();
      });
    }

    const blockBtn = row.querySelector('[data-act="block"]');
    if (blockBtn) {
      blockBtn.addEventListener("click", async () => {
        if (!confirm(`"${m.username || m.email || m.id}" 회원의 접근을 차단할까요?\n다시 승인하기 전까지 로그인할 수 없어요.`)) return;
        await updateDoc(doc(db, "members", m.id), { approved: false });
        loadMemberList();
      });
    }

    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      if (!confirm(`"${m.username || m.email || m.id}" 회원을 삭제할까요?\n삭제하면 이 계정으로 다시 로그인할 수 없어요.\n(같은 아이디로 재가입도 안 돼요 - 완전히 계정을 없애려면 Firebase 콘솔에서 지워야 해요.)`)) return;
      await deleteDoc(doc(db, "members", m.id));
      loadMemberList();
    });

    listEl.appendChild(row);
  });
}

// 관리자 메뉴 버튼 / 회원 관리 버튼에 승인 대기 인원 수 뱃지를 표시
async function refreshPendingBadge() {
  if (!isAdmin) { updatePendingBadge(0); return; }
  try {
    const snap = await getDocs(query(collection(db, "members"), where("approved", "==", false)));
    updatePendingBadge(snap.size);
  } catch (e) {
    // 무시 (뱃지는 편의 기능이라 실패해도 치명적이지 않음)
  }
}
function updatePendingBadge(count) {
  [el("adminMenuPendingBadge"), el("pendingBadge")].forEach(b => {
    if (!b) return;
    if (count > 0) {
      b.textContent = count;
      b.classList.remove("hidden");
    } else {
      b.classList.add("hidden");
    }
  });
}

// ---------- 게시판 구성 불러오기 ----------
async function loadBoardConfig() {
  const q = query(collection(db, "boards"), orderBy("order", "asc"));
  const snap = await getDocs(q);

  if (snap.empty) {
    if (isAdmin) {
      await seedDefaultBoards();
      return loadBoardConfig();
    } else {
      boardRows = [];
      renderBoardTree();
      return;
    }
  }

  boardRows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderBoardTree();
}

async function seedDefaultBoards() {
  let order = Date.now();
  for (const row of DEFAULT_SEED) {
    await addDoc(collection(db, "boards"), { ...row, order });
    order += 10;
  }
}

function nextOrder() {
  if (boardRows.length === 0) return Date.now();
  return Math.max(...boardRows.map(r => r.order || 0)) + 10;
}

// ---------- 사이트 설정 (프로필 카드 문구) ----------
// config/site 문서는 관리자 확인용 adminUid도 같이 들어있는 문서라, merge:true로 필드만 덧붙여요.
let siteConfig = { siteAvatar: "🐦", siteName: "+구구+", siteTagline: "개인 팬 아카이브 홈페이지" };

async function loadSiteConfig() {
  try {
    const snap = await getDoc(doc(db, "config", "site"));
    if (snap.exists()) {
      const d = snap.data();
      siteConfig = {
        siteAvatar: d.siteAvatar || siteConfig.siteAvatar,
        siteName: d.siteName || siteConfig.siteName,
        siteTagline: d.siteTagline || siteConfig.siteTagline,
      };
    }
  } catch (e) {
    // 무시 - 기본 문구로 표시
  }
  applySiteConfig();
}

function applySiteConfig() {
  el("profileAvatar").textContent = siteConfig.siteAvatar;
  el("profileTitle").textContent = siteConfig.siteName;
  el("profileSub").textContent = siteConfig.siteTagline;
  el("homeBtn").textContent = siteConfig.siteName;
}

function fillSiteSettingsForm() {
  el("siteAvatarInput").value = siteConfig.siteAvatar;
  el("siteNameInput").value = siteConfig.siteName;
  el("siteTaglineInput").value = siteConfig.siteTagline;
  el("siteSettingsStatus").textContent = "";
}

el("siteSettingsSaveBtn").addEventListener("click", async () => {
  const avatar = el("siteAvatarInput").value.trim() || "🐦";
  const name = el("siteNameInput").value.trim() || "+구구+";
  const tagline = el("siteTaglineInput").value.trim();
  const btn = el("siteSettingsSaveBtn");
  const statusEl = el("siteSettingsStatus");
  btn.disabled = true;
  try {
    await setDoc(doc(db, "config", "site"), { siteAvatar: avatar, siteName: name, siteTagline: tagline }, { merge: true });
    siteConfig = { siteAvatar: avatar, siteName: name, siteTagline: tagline };
    applySiteConfig();
    statusEl.textContent = "저장했어요 ✓";
    setTimeout(() => { statusEl.textContent = ""; }, 2500);
  } catch (err) {
    statusEl.textContent = "저장 실패: " + (err.code || err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- 게시판 트리 렌더 ----------
function renderBoardTree() {
  const treeEl = el("boardTree");
  treeEl.innerHTML = "";

  const allItem = document.createElement("div");
  allItem.className = "board-item all-board-item" + (currentBoardId === "__all__" ? " active" : "");
  allItem.innerHTML = "📋 전체 게시판";
  allItem.addEventListener("click", selectAllBoards);
  treeEl.appendChild(allItem);

  boardRows.forEach(row => {
    if (row.type === "divider") {
      const hr = document.createElement("div");
      hr.style.borderTop = "1px solid var(--line)";
      hr.style.margin = "6px 4px";
      treeEl.appendChild(hr);
      return;
    }
    if (row.type === "group") {
      const title = document.createElement("div");
      title.className = "board-group-title";
      title.textContent = row.name;
      treeEl.appendChild(title);
      return;
    }
    // type === "board"
    if (!canViewBoard(row)) return; // 권한 없으면 숨김
    const itemDiv = document.createElement("div");
    itemDiv.className = "board-item" + (row.id === currentBoardId ? " active" : "");
    itemDiv.innerHTML = (getVisibility(row) === "private" ? '<span class="lock-icon">🔒</span> ' : visibilityIcon(row)) + escapeHtml(row.name);
    itemDiv.addEventListener("click", () => selectBoard(row));
    treeEl.appendChild(itemDiv);
  });
}

function selectBoard(row, opts = {}) {
  currentBoardId = row.id;
  currentBoard = row;
  el("currentBoardName").textContent = row.name;
  el("writeBtn").classList.toggle("hidden", !isAdmin);
  showListView();
  hideHomeDashboard();
  renderBoardTree();
  loadPosts(row.id);
  if (!opts.skipUrl) pushUrl("/board", { b: row.id });
}

function selectAllBoards(opts = {}) {
  currentBoardId = "__all__";
  currentBoard = null;
  el("currentBoardName").textContent = "📋 전체 게시판";
  el("writeBtn").classList.add("hidden"); // 전체 게시판에서는 글쓰기 불가(게시판을 골라야 함)
  showListView();
  hideHomeDashboard();
  renderBoardTree();
  loadAllPosts();
  if (!opts.skipUrl) pushUrl("/board");
}

// ---------- 뷰 전환 ----------
function showListView() {
  el("listView").classList.remove("hidden");
  el("writeView").classList.add("hidden");
  el("detailView").classList.add("hidden");
  el("adminView").classList.add("hidden");
}
function showWriteView() {
  el("listView").classList.add("hidden");
  el("writeView").classList.remove("hidden");
  el("detailView").classList.add("hidden");
  el("adminView").classList.add("hidden");
  el("writeBoardLabel").textContent = currentBoard ? currentBoard.name : "";
  el("writeViewTitle").textContent = editingPostId ? "글 수정" : "글쓰기";
}
function showDetailView() {
  el("listView").classList.add("hidden");
  el("writeView").classList.add("hidden");
  el("detailView").classList.remove("hidden");
  el("adminView").classList.add("hidden");
}
function showAdminView() {
  el("listView").classList.add("hidden");
  el("writeView").classList.add("hidden");
  el("detailView").classList.add("hidden");
  el("adminView").classList.remove("hidden");
}

function showHomeDashboard() {
  el("homeDashboard").classList.remove("hidden");
  el("listContentHeader").classList.add("hidden");
  renderBoardShortcuts();
  loadRecentPosts();
}
function hideHomeDashboard() {
  el("homeDashboard").classList.add("hidden");
  el("listContentHeader").classList.remove("hidden");
}

el("homeBtn").addEventListener("click", () => {
  currentBoardId = null;
  currentBoard = null;
  editingPostId = null;
  el("writeBtn").classList.add("hidden");
  el("postList").innerHTML = "";
  el("emptyState").classList.add("hidden");
  el("pagination").classList.add("hidden");
  showListView();
  showHomeDashboard();
  renderBoardTree();
  pushUrl("/");
});

// ---------- 메인화면: 게시판 바로가기 ----------
function renderBoardShortcuts() {
  const wrap = el("boardShortcuts");
  wrap.innerHTML = "";
  const boards = boardRows.filter(r => r.type === "board" && canViewBoard(r));
  if (!boards.length) {
    wrap.innerHTML = `<p class="empty-state" style="grid-column:1/-1;">아직 게시판이 없어요.</p>`;
    return;
  }
  // 각 게시판 바로 위에 있던 그룹 제목을 같이 보여줘서 어디 소속인지 알 수 있게 함
  let lastGroup = "";
  boardRows.forEach(row => {
    if (row.type === "group") { lastGroup = row.name; return; }
    if (row.type !== "board") return;
    if (!canViewBoard(row)) return;
    const card = document.createElement("div");
    card.className = "board-shortcut-card";
    card.innerHTML = `
      ${lastGroup ? `<div class="shortcut-group">${escapeHtml(lastGroup)}</div>` : ""}
      <div class="shortcut-name">${visibilityIcon(row)}${escapeHtml(row.name)}</div>
    `;
    card.addEventListener("click", () => selectBoard(row));
    wrap.appendChild(card);
  });
}

// ---------- 메인화면: 최근 게시글 ----------
async function loadRecentPosts() {
  const myToken = ++navToken;
  const listEl = el("recentPosts");
  listEl.innerHTML = `<p class="empty-state">불러오는 중...</p>`;
  el("recentPostsEmpty").classList.add("hidden");

  const boards = boardRows.filter(r => r.type === "board" && canViewBoard(r));
  const perBoard = await Promise.all(boards.map(async (b) => {
    try {
      const docs = await fetchBoardPosts(b.id);
      return docs.map(docSnap => ({ docSnap, boardName: b.name }));
    } catch (err) {
      return [];
    }
  }));
  if (myToken !== navToken) return;
  let entries = perBoard.flat();
  if (!entries.length) {
    listEl.innerHTML = "";
    el("recentPostsEmpty").classList.remove("hidden");
    return;
  }
  entries = sortByDateDesc(entries, e => e.docSnap.data()).slice(0, 6);
  listEl.innerHTML = "";
  entries.forEach(({ docSnap, boardName }) => listEl.appendChild(renderPostCard(docSnap, { boardName })));
}

// ---------- 공지함 드롭다운 (상단바) ----------
// 고정(📌)해둔 글들만 모아서 보여줘요. 비공개 게시판 글은 권한 있는 사람에게만 보여요(다른 목록과 동일한 필터 사용).
async function loadNoticeDropdown() {
  const wrap = el("noticeDropdown");
  wrap.innerHTML = `<p class="empty-state" style="padding:20px 10px;">불러오는 중...</p>`;
  const boards = boardRows.filter(r => r.type === "board" && canViewBoard(r));
  const perBoard = await Promise.all(boards.map(async (b) => {
    try {
      const docs = await fetchBoardPosts(b.id);
      return docs.filter(d => d.data().isPinned).map(docSnap => ({ docSnap, boardName: b.name }));
    } catch (e) {
      return [];
    }
  }));
  let entries = perBoard.flat();
  entries = sortByDateDesc(entries, e => e.docSnap.data());
  renderNoticeDropdown(entries);
}

function renderNoticeDropdown(entries) {
  const wrap = el("noticeDropdown");
  if (!entries.length) {
    wrap.innerHTML = `<p class="empty-state" style="padding:20px 10px;">아직 등록된 공지가 없어요.</p>`;
    return;
  }
  wrap.innerHTML = entries.map(({ docSnap, boardName }) => {
    const p = docSnap.data();
    return `<div class="notice-item" data-id="${docSnap.id}">
      <div class="notice-item-title">📌 ${escapeHtml(p.title)}</div>
      <div class="notice-item-meta">
        <span class="board-tag">${escapeHtml(boardName)}</span><span>${formatDate(p.createdAt)}</span>
        ${isAdmin ? `<span class="notice-item-actions">
          <button data-act="unpin" title="고정 해제">해제</button>
          <button data-act="delete" class="danger" title="삭제">삭제</button>
        </span>` : ""}
      </div>
    </div>`;
  }).join("");
  wrap.querySelectorAll(".notice-item").forEach(itemEl => {
    const id = itemEl.dataset.id;
    itemEl.addEventListener("click", () => {
      closeNoticeDropdown();
      openPost(id);
    });
    const unpinBtn = itemEl.querySelector('[data-act="unpin"]');
    if (unpinBtn) {
      unpinBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await updateDoc(doc(db, "posts", id), { isPinned: false });
        invalidateBoardCache();
        loadNoticeDropdown();
      });
    }
    const deleteBtn = itemEl.querySelector('[data-act="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const p = itemEl.querySelector(".notice-item-title").textContent.replace("📌 ", "");
        if (!confirm(`"${p}" 글을 삭제할까요? 되돌릴 수 없어요.`)) return;
        await deleteDoc(doc(db, "posts", id));
        invalidateBoardCache();
        loadNoticeDropdown();
        if (currentBoardId === "__all__") loadAllPosts();
        else if (currentBoardId) loadPosts(currentBoardId);
      });
    }
  });
}

function closeNoticeDropdown() {
  el("noticeDropdown").classList.remove("open");
  el("noticeDropdown").classList.add("hidden");
  document.removeEventListener("click", onDocClickCloseNotice);
}
function onDocClickCloseNotice(e) {
  if (!e.target.closest(".notice-menu-wrap")) closeNoticeDropdown();
}
el("noticeMenuBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const wrap = el("noticeDropdown");
  if (wrap.classList.contains("open")) { closeNoticeDropdown(); return; }
  wrap.classList.remove("hidden");
  wrap.classList.add("open");
  loadNoticeDropdown();
  document.addEventListener("click", onDocClickCloseNotice);
});

// ---------- 검색 ----------
el("searchBtn").addEventListener("click", performSearch);
el("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") performSearch();
});

async function performSearch(opts = {}) {
  const keyword = el("searchInput").value.trim();
  if (!keyword) return;
  const myToken = ++navToken;

  currentBoardId = "__search__";
  currentBoard = null;
  editingPostId = null;
  el("currentBoardName").textContent = `🔍 검색 결과: "${keyword}"`;
  el("writeBtn").classList.add("hidden");
  showListView();
  hideHomeDashboard();
  renderBoardTree();
  if (!opts.skipUrl) pushUrl("/board", { q: keyword });

  const listEl = el("postList");
  listEl.innerHTML = `<p class="empty-state">검색하는 중...</p>`;
  el("pagination").classList.add("hidden");
  el("emptyState").classList.add("hidden");

  const boards = boardRows.filter(r => r.type === "board" && canViewBoard(r));
  const lower = keyword.toLowerCase();
  const perBoard = await Promise.all(boards.map(async (b) => {
    try {
      const docs = await fetchBoardPosts(b.id);
      return docs
        .filter(docSnap => {
          const d = docSnap.data();
          return (d.title || "").toLowerCase().includes(lower) || (d.content || "").toLowerCase().includes(lower);
        })
        .map(docSnap => ({ docSnap, boardName: b.name }));
    } catch (err) {
      return []; // 개별 게시판 조회 실패는 건너뛰고 계속 진행
    }
  }));
  let entries = perBoard.flat();
  if (myToken !== navToken) return; // 그 사이에 다른 화면으로 이동했으면 이 결과는 버림
  if (!entries.length) {
    listEl.innerHTML = "";
    el("emptyState").classList.remove("hidden");
    return;
  }
  entries = sortByDateDesc(entries, e => e.docSnap.data());
  showPostListPage(entries);
}

el("writeBtn").addEventListener("click", () => {
  editingPostId = null;
  el("postForm").reset();
  resetImageUploadUI();
  showWriteView();
});
el("cancelWriteBtn").addEventListener("click", () => { editingPostId = null; resetImageUploadUI(); showListView(); });
el("backBtn").addEventListener("click", () => {
  showListView();
  if (currentBoardId === "__all__") { loadAllPosts(); pushUrl("/board"); }
  else if (currentBoardId === "__search__") { performSearch({ skipUrl: true }); pushUrl("/board", { q: el("searchInput").value.trim() }); }
  else if (currentBoardId) { loadPosts(currentBoardId); pushUrl("/board", { b: currentBoardId }); }
  else { showHomeDashboard(); pushUrl("/"); }
});

// ---------- 이미지 업로드 (ImgBB) ----------
// 올리기 전에 브라우저에서 미리 크기를 줄여서(최대 1600px, JPEG 압축) 업로드/로딩을 빠르게 해요.
// 움짤(GIF)은 리사이즈하면 애니메이션이 깨지므로 원본 그대로 올려요.
async function resizeImageFile(file, maxDim = 1600, quality = 0.85) {
  if (file.type === "image/gif") return file;
  if (!window.createImageBitmap) return file; // 지원 안 하는 구형 브라우저는 원본 그대로

  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    if (width <= maxDim && height <= maxDim) {
      bitmap.close();
      return file; // 이미 충분히 작으면 그대로
    }
    const scale = Math.min(maxDim / width, maxDim / height);
    const newW = Math.round(width * scale);
    const newH = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = newW;
    canvas.height = newH;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, newW, newH);
    bitmap.close();

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    const newName = (file.name || "image").replace(/\.\w+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch (e) {
    return file; // 리사이즈 도중 뭔가 실패하면 원본 그대로 업로드(안전망)
  }
}

// ImgBB는 업로드하면 원본 외에 작은 썸네일(약 160px)도 같이 만들어줘요.
// 목록 화면처럼 작게 보여줄 땐 이 썸네일을 쓰면 훨씬 가볍고 빨라요.
// 반환값: { url: 원본(리사이즈된) 이미지, thumbUrl: 목록용 작은 썸네일 }
async function uploadToImgBB(file) {
  const resized = await resizeImageFile(file);
  const formData = new FormData();
  formData.append("image", resized);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message || "업로드 실패");
  const url = data.data.url;
  const thumbUrl = data.data.thumb?.url || data.data.medium?.url || url;
  return { url, thumbUrl };
}

function renderImagePreviews() {
  const listEl = el("imagePreviewList");
  listEl.innerHTML = "";
  selectedImageUrls.forEach((url, idx) => {
    const item = document.createElement("div");
    item.className = "image-preview-item";
    item.innerHTML = `${imgWrap(selectedImageThumbUrls[idx] || url, { imgAttrs: 'loading="lazy"' })}<button type="button" class="image-preview-remove" title="삭제">✕</button>`;
    item.querySelector(".image-preview-remove").addEventListener("click", () => {
      selectedImageUrls.splice(idx, 1);
      selectedImageThumbUrls.splice(idx, 1);
      renderImagePreviews();
    });
    listEl.appendChild(item);
  });
}

function resetImageUploadUI() {
  selectedImageUrls = [];
  selectedImageThumbUrls = [];
  el("postImageFiles").value = "";
  el("imageUploadStatus").classList.add("hidden");
  renderImagePreviews();
}

el("postImageFiles").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const statusEl = el("imageUploadStatus");
  statusEl.classList.remove("hidden", "error");
  statusEl.textContent = `이미지 업로드 중... (0/${files.length})`;
  let done = 0;
  let hadError = false;

  // 한 장씩 순서대로 기다리지 않고 전부 동시에 업로드해요. 순서는 Promise.all이 보장해줘서
  // 먼저 끝난 게 있어도 선택한 순서 그대로 미리보기에 붙어요.
  const results = await Promise.all(files.map(file =>
    uploadToImgBB(file)
      .then((res) => {
        done++;
        if (!hadError) statusEl.textContent = `이미지 업로드 중... (${done}/${files.length})`;
        return { ok: true, url: res.url, thumbUrl: res.thumbUrl };
      })
      .catch((err) => {
        done++;
        hadError = true;
        statusEl.classList.add("error");
        statusEl.textContent = `업로드 실패: ${err.message}`;
        return { ok: false };
      })
  ));

  results.forEach((r) => {
    if (!r.ok) return;
    selectedImageUrls.push(r.url);
    selectedImageThumbUrls.push(r.thumbUrl);
  });
  renderImagePreviews();

  if (!hadError) statusEl.classList.add("hidden");
  el("postImageFiles").value = "";
});

// ---------- 글쓰기 / 수정 ----------
el("postForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin) return;
  const submitBtn = el("postForm").querySelector('button[type="submit"]');
  if (submitBtn.disabled) return; // 이미 처리 중이면 중복 클릭 무시
  submitBtn.disabled = true;
  try {
    const title = el("postTitle").value.trim();
    const content = el("postContent").value.trim();
    const imageUrls = selectedImageUrls.slice();
    const imageThumbUrls = selectedImageThumbUrls.slice();

    if (editingPostId) {
      await updateDoc(doc(db, "posts", editingPostId), { title, content, imageUrls, imageThumbUrls });
      invalidateBoardCache(editingPostBoardId);
      const idToReopen = editingPostId;
      editingPostId = null;
      el("postForm").reset();
      resetImageUploadUI();
      openPost(idToReopen);
      return;
    }

    await addDoc(collection(db, "posts"), {
      boardId: currentBoardId,
      title, content, imageUrls, imageThumbUrls,
      author: currentUser.email.split("@")[0],
      createdAt: serverTimestamp(),
      views: 0,
      isPrivate: !!(currentBoard && currentBoard.isPrivate),
      visibility: getVisibility(currentBoard),
    });
    invalidateBoardCache(currentBoardId);
    el("postForm").reset();
    resetImageUploadUI();
    showListView();
    loadPosts(currentBoardId);
  } finally {
    submitBtn.disabled = false;
  }
});

function renderPostCard(docSnap, opts) {
  const p = docSnap.data();
  const images = getImages(p);
  const thumbs = getThumbs(p);
  const card = document.createElement("div");
  card.className = "post-card" + (p.isPinned ? " pinned" : "");
  card.innerHTML = `
    <div class="post-card-body">
      <div class="post-card-meta">
        ${p.isPinned ? `<span class="pin-badge">📌 고정</span>` : ""}
        ${opts && opts.boardName ? `<span class="board-tag">${escapeHtml(opts.boardName)}</span>` : ""}
        <span>${escapeHtml(p.author || "익명")}</span>
        <span>·</span>
        <span>${formatDate(p.createdAt)}</span>
      </div>
      <div class="post-card-title">${escapeHtml(p.title)}</div>
      <div class="post-card-preview">${escapeHtml(p.content)}</div>
      <div class="post-card-stats"><span>👁 ${p.views || 0}</span></div>
    </div>
    ${images.length ? `<div class="post-card-thumb-wrap">
        ${imgWrap(thumbs[0], { wrapClass: "thumb-wrap", imgClass: "post-card-thumb", imgAttrs: 'loading="lazy" decoding="async"' })}
        ${images.length > 1 ? `<span class="thumb-count">${images.length}</span>` : ""}
      </div>` : ""}
  `;
  card.addEventListener("click", () => openPost(docSnap.id));
  return card;
}

function sortByDateDesc(docs, getData) {
  return docs.slice().sort((a, b) => {
    // 방금 작성돼서 서버 타임스탬프가 아직 확정 안 된 글(null)은 최신 글로 간주해요.
    // (그렇지 않으면 새 글이 정렬 맨 뒤로 밀려서 페이지 끝에 숨어버려요)
    const ta = getData(a).createdAt ? getData(a).createdAt.toMillis() : Date.now();
    const tb = getData(b).createdAt ? getData(b).createdAt.toMillis() : Date.now();
    return tb - ta;
  });
}

// 게시판/전체 목록에서 쓰는 정렬: 고정글을 맨 위로 올리고, 그 안에서는 최신순.
function sortForBoardList(docs, getData) {
  return docs.slice().sort((a, b) => {
    const pa = getData(a).isPinned ? 1 : 0;
    const pb = getData(b).isPinned ? 1 : 0;
    if (pa !== pb) return pb - pa;
    const ta = getData(a).createdAt ? getData(a).createdAt.toMillis() : Date.now();
    const tb = getData(b).createdAt ? getData(b).createdAt.toMillis() : Date.now();
    return tb - ta;
  });
}

// ---------- 더보기 / 무한스크롤 ----------
// entries: [{docSnap, boardName?}, ...] 최신순으로 정렬된 전체 목록
// 처음 목록을 열 때 호출: 목록을 비우고 첫 배치를 보여줘요.
function showPostListPage(entries) {
  currentListEntries = entries;
  currentVisibleCount = 0;
  el("postList").innerHTML = "";
  appendNextBatch();
}

// 다음 배치를 이어붙여서 보여줘요(기존에 보이던 카드는 그대로 두고 뒤에 추가만 함 → 스크롤 위치 안 튐).
function appendNextBatch() {
  const listEl = el("postList");
  const start = currentVisibleCount;
  const end = Math.min(start + POSTS_PER_PAGE, currentListEntries.length);
  currentListEntries.slice(start, end).forEach(({ docSnap, boardName }) => {
    listEl.appendChild(renderPostCard(docSnap, { boardName }));
  });
  currentVisibleCount = end;
  renderLoadMoreControl();
}

let loadMoreObserver = null;
function renderLoadMoreControl() {
  const pagEl = el("pagination");
  const remaining = currentListEntries.length - currentVisibleCount;

  if (remaining <= 0) {
    pagEl.classList.add("hidden");
    pagEl.innerHTML = "";
    if (loadMoreObserver) loadMoreObserver.disconnect();
    return;
  }

  pagEl.classList.remove("hidden");
  pagEl.innerHTML = `<button id="loadMoreBtn" class="btn btn-ghost load-more-btn">더보기 (${remaining}개 더보기)</button>`;
  const btn = el("loadMoreBtn");
  btn.addEventListener("click", appendNextBatch);

  // 버튼이 화면(뷰포트)에 걸쳐 보이면 자동으로 다음 배치를 불러와요(무한스크롤).
  if (loadMoreObserver) loadMoreObserver.disconnect();
  loadMoreObserver = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) appendNextBatch();
  }, { rootMargin: "400px" });
  loadMoreObserver.observe(btn);
}

// ---------- 목록 불러오기 (게시판 1개) ----------
async function loadPosts(boardId) {
  const myToken = ++navToken;
  const listEl = el("postList");
  const wasCached = postsCache.has(boardId);
  if (!wasCached) listEl.innerHTML = `<p class="empty-state">불러오는 중...</p>`;
  el("emptyState").classList.add("hidden");
  el("pagination").classList.add("hidden");
  let docs;
  try {
    docs = await fetchBoardPosts(boardId);
  } catch (err) {
    if (myToken !== navToken) return;
    listEl.innerHTML = `<p class="empty-state">게시글을 불러오지 못했어요. (${err.code || err.message})</p>`;
    return;
  }
  if (myToken !== navToken) return; // 그 사이에 다른 게시판으로 이동했으면 이 결과는 버림
  if (!docs.length) {
    listEl.innerHTML = "";
    el("emptyState").classList.remove("hidden");
    return;
  }
  el("emptyState").classList.add("hidden");
  const sortedDocs = sortForBoardList(docs, d => d.data());
  showPostListPage(sortedDocs.map(docSnap => ({ docSnap })));
}

// ---------- 목록 불러오기 (전체 게시판) ----------
async function loadAllPosts() {
  const myToken = ++navToken;
  const listEl = el("postList");
  listEl.innerHTML = `<p class="empty-state">불러오는 중...</p>`;
  el("emptyState").classList.add("hidden");
  el("pagination").classList.add("hidden");
  const boards = boardRows.filter(r => r.type === "board" && canViewBoard(r));
  const perBoard = await Promise.all(boards.map(async (b) => {
    try {
      const docs = await fetchBoardPosts(b.id);
      return docs.map(docSnap => ({ docSnap, boardName: b.name }));
    } catch (err) {
      return []; // 개별 게시판 조회 실패는 건너뛰고 나머지는 계속 보여줌
    }
  }));
  if (myToken !== navToken) return; // 그 사이에 다른 화면으로 이동했으면 이 결과는 버림
  let entries = perBoard.flat();
  if (!entries.length) {
    listEl.innerHTML = "";
    el("emptyState").classList.remove("hidden");
    return;
  }
  el("emptyState").classList.add("hidden");
  entries = sortForBoardList(entries, e => e.docSnap.data());
  showPostListPage(entries);
}

// ---------- 상세보기 ----------
async function openPost(postId, opts = {}) {
  const ref = doc(db, "posts", postId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;
  const p = snap.data();
  updateDoc(ref, { views: increment(1) }).catch(() => {});

  // 지금 보고 있던 목록(currentListEntries) 기준으로 이전글/다음글을 찾아요.
  // 목록은 최신순이라, 이전글=한 칸 위(더 최신), 다음글=한 칸 아래(더 오래된) 글이에요.
  const idx = currentListEntries.findIndex(en => en.docSnap.id === postId);
  const prevEntry = idx > 0 ? currentListEntries[idx - 1] : null;
  const nextEntry = idx !== -1 && idx < currentListEntries.length - 1 ? currentListEntries[idx + 1] : null;

  const images = getImages(p);
  el("postDetail").innerHTML = `
    <h1>${escapeHtml(p.title)}</h1>
    <div class="meta">${escapeHtml(p.author || "익명")} · ${formatDate(p.createdAt)} · 조회 ${p.views || 0}</div>
    ${images.map((u, i) => imgWrap(u, { wrapClass: "detail-wrap", imgClass: "detail-img", imgAttrs: `data-idx="${i}" loading="${i === 0 ? "eager" : "lazy"}" decoding="async"` })).join("")}
    <div class="content-text">${escapeHtml(p.content)}</div>
    ${isAdmin ? `<div class="admin-actions">
      <button id="pinPostBtn" class="btn btn-ghost">${p.isPinned ? "📌 고정 해제" : "📌 고정하기"}</button>
      <button id="editPostBtn" class="btn btn-ghost">수정하기</button>
      <button id="movePostBtn" class="btn btn-ghost">게시판 이동</button>
      <button id="deletePostBtn" class="btn btn-ghost">삭제하기</button>
    </div>` : ""}
    ${(prevEntry || nextEntry) ? `<div class="post-detail-nav">
      ${prevEntry
        ? `<button class="post-nav-btn prev" data-id="${prevEntry.docSnap.id}"><span class="post-nav-label">◀ 이전 글</span><span class="post-nav-title">${escapeHtml(prevEntry.docSnap.data().title)}</span></button>`
        : `<span class="post-nav-empty"></span>`}
      ${nextEntry
        ? `<button class="post-nav-btn next" data-id="${nextEntry.docSnap.id}"><span class="post-nav-label">다음 글 ▶</span><span class="post-nav-title">${escapeHtml(nextEntry.docSnap.data().title)}</span></button>`
        : `<span class="post-nav-empty"></span>`}
    </div>` : ""}
  `;
  showDetailView();
  if (!opts.skipUrl) pushUrl(`/board/${postId}`);

  document.querySelectorAll("#postDetail .detail-img").forEach(imgEl => {
    imgEl.addEventListener("click", () => openLightbox(images, Number(imgEl.dataset.idx)));
  });

  const prevBtn = document.querySelector("#postDetail .post-nav-btn.prev");
  if (prevBtn) prevBtn.addEventListener("click", () => openPost(prevBtn.dataset.id));
  const nextBtn = document.querySelector("#postDetail .post-nav-btn.next");
  if (nextBtn) nextBtn.addEventListener("click", () => openPost(nextBtn.dataset.id));

  if (isAdmin) {
    el("pinPostBtn").addEventListener("click", async () => {
      await updateDoc(ref, { isPinned: !p.isPinned });
      invalidateBoardCache(p.boardId);
      openPost(postId, { skipUrl: true });
    });

    el("deletePostBtn").addEventListener("click", async () => {
      if (!confirm("이 게시글을 삭제할까요?")) return;
      await deleteDoc(ref);
      invalidateBoardCache(p.boardId);
      showListView();
      if (currentBoardId === "__all__") { loadAllPosts(); pushUrl("/board"); }
      else { loadPosts(currentBoardId); pushUrl("/board", { b: currentBoardId }); }
    });

    el("editPostBtn").addEventListener("click", () => {
      editingPostId = postId;
      editingPostBoardId = p.boardId;
      el("postTitle").value = p.title || "";
      el("postContent").value = p.content || "";
      selectedImageUrls = images.slice();
      selectedImageThumbUrls = getThumbs(p).slice();
      renderImagePreviews();
      const boardOfPost = boardRows.find(b => b.id === p.boardId);
      currentBoard = boardOfPost || currentBoard;
      showWriteView();
    });

    el("movePostBtn").addEventListener("click", () => openMoveModal(postId, p.boardId));
  }
  return true;
}

// ---------- 게시글 이동 ----------
function openMoveModal(postId, currentPostBoardId) {
  const sel = el("moveBoardSelect");
  sel.innerHTML = "";
  boardRows.filter(r => r.type === "board").forEach(b => {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = visibilityIcon(b) + b.name;
    if (b.id === currentPostBoardId) opt.selected = true;
    sel.appendChild(opt);
  });
  el("moveModal").classList.remove("hidden");
  el("moveConfirmBtn").onclick = async () => {
    const targetId = sel.value;
    const targetBoard = boardRows.find(b => b.id === targetId);
    await updateDoc(doc(db, "posts", postId), {
      boardId: targetId,
      isPrivate: !!(targetBoard && targetBoard.isPrivate),
      visibility: getVisibility(targetBoard),
    });
    invalidateBoardCache(currentPostBoardId);
    invalidateBoardCache(targetId);
    el("moveModal").classList.add("hidden");
    openPost(postId);
  };
}
el("moveCancelBtn").addEventListener("click", () => el("moveModal").classList.add("hidden"));

// ---------- 게시판 관리 패널 ----------
// (이제 관리자 메뉴의 "📄 게시판 관리" 탭 안에서 관리해요. 탭 클릭 시 renderManageList()가 호출됩니다.)

el("manageAddBoardBtn").addEventListener("click", async () => {
  const name = el("manageNameInput").value.trim();
  if (!name) return;
  const visibility = el("manageVisibilitySelect").value;
  await addDoc(collection(db, "boards"), { type: "board", name, visibility, order: nextOrder() });
  el("manageNameInput").value = "";
  el("manageVisibilitySelect").value = "public";
  await loadBoardConfig();
  renderManageList();
});

el("manageAddGroupBtn").addEventListener("click", async () => {
  const name = el("manageNameInput").value.trim();
  if (!name) return;
  await addDoc(collection(db, "boards"), { type: "group", name, order: nextOrder() });
  el("manageNameInput").value = "";
  await loadBoardConfig();
  renderManageList();
});

el("manageAddDividerBtn").addEventListener("click", async () => {
  await addDoc(collection(db, "boards"), { type: "divider", name: "", order: nextOrder() });
  await loadBoardConfig();
  renderManageList();
});

function renderManageList() {
  const listEl = el("manageList");
  listEl.innerHTML = "";
  boardRows.forEach((row, idx) => {
    const rowDiv = document.createElement("div");
    rowDiv.className = `manage-row type-${row.type}`;
    const label =
      row.type === "divider" ? "── 구분선 ──" :
      row.type === "group" ? row.name :
      visibilityIcon(row) + row.name;

    rowDiv.innerHTML = `
      <span class="manage-row-label">${escapeHtml(label)}</span>
      <span class="manage-row-actions">
        ${row.type === "board" ? `<select class="admin-select" data-act="visibility-select">
            <option value="public">🌐 전체공개</option>
            <option value="members">👥 회원공개</option>
            <option value="private">🔒 비공개</option>
          </select>` : ""}
        <button data-act="up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button data-act="down" ${idx === boardRows.length - 1 ? "disabled" : ""}>▼</button>
        <button data-act="del" class="danger">삭제</button>
      </span>
    `;
    rowDiv.querySelector('[data-act="up"]').addEventListener("click", () => moveRow(idx, -1));
    rowDiv.querySelector('[data-act="down"]').addEventListener("click", () => moveRow(idx, 1));
    rowDiv.querySelector('[data-act="del"]').addEventListener("click", () => deleteRow(row));
    if (row.type === "board") {
      const sel = rowDiv.querySelector('[data-act="visibility-select"]');
      sel.value = getVisibility(row);
      sel.addEventListener("change", () => changeBoardVisibility(row, sel.value, sel));
    }
    listEl.appendChild(rowDiv);
  });
}

async function changeBoardVisibility(row, newVal, selEl) {
  const oldVal = getVisibility(row);
  if (newVal === oldVal) return;
  if (!confirm(`"${row.name}" 게시판을 [${visibilityLabel(newVal)}]으로 바꿀까요? 이 게시판의 글도 모두 같은 공개범위로 바뀌어요.`)) {
    if (selEl) selEl.value = oldVal; // 취소하면 원래 선택으로 되돌림
    return;
  }
  await updateDoc(doc(db, "boards", row.id), { visibility: newVal, isPrivate: newVal === "private" });
  const postsSnap = await getDocs(query(collection(db, "posts"), where("boardId", "==", row.id)));
  await Promise.all(postsSnap.docs.map(p => updateDoc(p.ref, { visibility: newVal, isPrivate: newVal === "private" })));
  invalidateBoardCache(row.id);
  await loadBoardConfig();
  renderManageList();
}

async function moveRow(idx, dir) {
  const otherIdx = idx + dir;
  if (otherIdx < 0 || otherIdx >= boardRows.length) return;
  const a = boardRows[idx];
  const b = boardRows[otherIdx];
  const orderA = a.order, orderB = b.order;
  await Promise.all([
    updateDoc(doc(db, "boards", a.id), { order: orderB }),
    updateDoc(doc(db, "boards", b.id), { order: orderA }),
  ]);
  await loadBoardConfig();
  renderManageList();
}

async function deleteRow(row) {
  const msg = row.type === "board"
    ? `"${row.name}" 게시판을 삭제할까요? 이 게시판의 글도 함께 삭제돼요.`
    : "이 항목을 삭제할까요?";
  if (!confirm(msg)) return;

  if (row.type === "board") {
    const postsSnap = await getDocs(query(collection(db, "posts"), where("boardId", "==", row.id)));
    await Promise.all(postsSnap.docs.map(p => deleteDoc(p.ref)));
    invalidateBoardCache(row.id);
    if (currentBoardId === row.id) {
      currentBoardId = null;
      currentBoard = null;
      el("writeBtn").classList.add("hidden");
      el("postList").innerHTML = "";
      showHomeDashboard();
    }
  }
  await deleteDoc(doc(db, "boards", row.id));
  await loadBoardConfig();
  renderManageList();
}

// ---------- 상단 메뉴 (헤더 아래 바로가기 바) ----------
// 링크를 입력하면 그 주소로 이동하고, 비워두면 짧은 글(제목+내용+이미지)이 팝업으로 열려요.
function normalizeUrl(u) {
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function nextTopMenuOrder() {
  if (!topMenuItems.length) return Date.now();
  return Math.max(...topMenuItems.map(r => r.order || 0)) + 10;
}

async function loadTopMenu() {
  try {
    const q = query(collection(db, "topMenus"), orderBy("order", "asc"));
    const snap = await getDocs(q);
    topMenuItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    topMenuItems = []; // 아직 컬렉션이 없거나 읽기 실패 시 그냥 안 보여줌
  }
  renderTopMenuBar();
}

async function loadTopMenuAdminTab() {
  await loadTopMenu();
  renderTopMenuAdminList();
}

// 헤더 아래 바로가기 바 (모든 방문자에게 보임)
function renderTopMenuBar() {
  const bar = el("topMenuBar");
  if (!topMenuItems.length) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  bar.classList.remove("hidden");
  bar.innerHTML = topMenuItems.map(item => {
    const hasUrl = !!(item.url && item.url.trim());
    return hasUrl
      ? `<a class="top-menu-link" href="${escapeHtml(normalizeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a>`
      : `<button type="button" class="top-menu-link" data-id="${item.id}">${escapeHtml(item.name)}</button>`;
  }).join("");
  bar.querySelectorAll("button.top-menu-link").forEach(btn => {
    btn.addEventListener("click", () => openTopMenuDetail(btn.dataset.id));
  });
}

// 링크가 없는 메뉴를 눌렀을 때 여는 팝업
function openTopMenuDetail(id) {
  const item = topMenuItems.find(t => t.id === id);
  if (!item) return;
  const images = getImages(item);
  el("topMenuDetailTitle").textContent = item.name;
  el("topMenuDetailImages").innerHTML = images.map((u, i) => imgWrap(u, {
    wrapClass: "detail-wrap", imgClass: "detail-img",
    imgAttrs: `data-idx="${i}" loading="${i === 0 ? "eager" : "lazy"}" decoding="async"`,
  })).join("");
  el("topMenuDetailContent").textContent = item.content || "";
  el("topMenuDetailModal").classList.remove("hidden");
  el("topMenuDetailModal").querySelectorAll(".detail-img").forEach(imgEl => {
    imgEl.addEventListener("click", () => openLightbox(images, Number(imgEl.dataset.idx)));
  });
}
function closeTopMenuDetail() {
  el("topMenuDetailModal").classList.add("hidden");
}
el("topMenuDetailCloseBtn").addEventListener("click", closeTopMenuDetail);
el("topMenuDetailModal").addEventListener("click", (e) => {
  if (e.target.id === "topMenuDetailModal") closeTopMenuDetail();
});

// 관리자 메뉴 - 상단 메뉴 탭의 목록
function renderTopMenuAdminList() {
  const listEl = el("topMenuList");
  listEl.innerHTML = "";
  topMenuItems.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "manage-row";
    const hasUrl = !!(item.url && item.url.trim());
    const label = (hasUrl ? "🔗 " : "📝 ") + item.name;
    row.innerHTML = `
      <span class="manage-row-label">${escapeHtml(label)}</span>
      <span class="manage-row-actions">
        <button data-act="up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button data-act="down" ${idx === topMenuItems.length - 1 ? "disabled" : ""}>▼</button>
        <button data-act="edit">수정</button>
        <button data-act="del" class="danger">삭제</button>
      </span>
    `;
    row.querySelector('[data-act="up"]').addEventListener("click", () => moveTopMenu(idx, -1));
    row.querySelector('[data-act="down"]').addEventListener("click", () => moveTopMenu(idx, 1));
    row.querySelector('[data-act="edit"]').addEventListener("click", () => startEditTopMenu(item));
    row.querySelector('[data-act="del"]').addEventListener("click", () => deleteTopMenu(item));
    listEl.appendChild(row);
  });
}

async function moveTopMenu(idx, dir) {
  const otherIdx = idx + dir;
  if (otherIdx < 0 || otherIdx >= topMenuItems.length) return;
  const a = topMenuItems[idx], b = topMenuItems[otherIdx];
  await Promise.all([
    updateDoc(doc(db, "topMenus", a.id), { order: b.order }),
    updateDoc(doc(db, "topMenus", b.id), { order: a.order }),
  ]);
  await loadTopMenu();
  renderTopMenuAdminList();
}

async function deleteTopMenu(item) {
  if (!confirm(`"${item.name}" 메뉴를 삭제할까요?`)) return;
  await deleteDoc(doc(db, "topMenus", item.id));
  if (editingTopMenuId === item.id) cancelEditTopMenu();
  await loadTopMenu();
  renderTopMenuAdminList();
}

function startEditTopMenu(item) {
  editingTopMenuId = item.id;
  el("topMenuNameInput").value = item.name || "";
  el("topMenuUrlInput").value = item.url || "";
  el("topMenuContentInput").value = item.content || "";
  topMenuImageUrls = getImages(item).slice();
  topMenuImageThumbUrls = getThumbs(item).slice();
  renderTopMenuImagePreviews();
  el("topMenuSaveBtn").textContent = "💾 수정 저장";
  el("topMenuCancelEditBtn").classList.remove("hidden");
  el("topMenuNameInput").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelEditTopMenu() {
  editingTopMenuId = null;
  el("topMenuNameInput").value = "";
  el("topMenuUrlInput").value = "";
  el("topMenuContentInput").value = "";
  topMenuImageUrls = [];
  topMenuImageThumbUrls = [];
  renderTopMenuImagePreviews();
  el("topMenuSaveBtn").textContent = "➕ 메뉴 추가";
  el("topMenuCancelEditBtn").classList.add("hidden");
}
el("topMenuCancelEditBtn").addEventListener("click", cancelEditTopMenu);

function renderTopMenuImagePreviews() {
  const listEl = el("topMenuImagePreviewList");
  listEl.innerHTML = "";
  topMenuImageUrls.forEach((url, idx) => {
    const item = document.createElement("div");
    item.className = "image-preview-item";
    item.innerHTML = `${imgWrap(topMenuImageThumbUrls[idx] || url, { imgAttrs: 'loading="lazy"' })}<button type="button" class="image-preview-remove" title="삭제">✕</button>`;
    item.querySelector(".image-preview-remove").addEventListener("click", () => {
      topMenuImageUrls.splice(idx, 1);
      topMenuImageThumbUrls.splice(idx, 1);
      renderTopMenuImagePreviews();
    });
    listEl.appendChild(item);
  });
}

el("topMenuImageFiles").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const statusEl = el("topMenuImageStatus");
  statusEl.classList.remove("hidden", "error");
  statusEl.textContent = `이미지 업로드 중... (0/${files.length})`;
  let done = 0;
  let hadError = false;

  const results = await Promise.all(files.map(file =>
    uploadToImgBB(file)
      .then((res) => {
        done++;
        if (!hadError) statusEl.textContent = `이미지 업로드 중... (${done}/${files.length})`;
        return { ok: true, url: res.url, thumbUrl: res.thumbUrl };
      })
      .catch((err) => {
        done++;
        hadError = true;
        statusEl.classList.add("error");
        statusEl.textContent = `업로드 실패: ${err.message}`;
        return { ok: false };
      })
  ));

  results.forEach((r) => {
    if (!r.ok) return;
    topMenuImageUrls.push(r.url);
    topMenuImageThumbUrls.push(r.thumbUrl);
  });
  renderTopMenuImagePreviews();

  if (!hadError) statusEl.classList.add("hidden");
  el("topMenuImageFiles").value = "";
});

el("topMenuSaveBtn").addEventListener("click", async () => {
  if (!isAdmin) return;
  const name = el("topMenuNameInput").value.trim();
  if (!name) { alert("메뉴 이름을 입력해주세요."); return; }
  const url = el("topMenuUrlInput").value.trim();
  const content = el("topMenuContentInput").value.trim();
  const imageUrls = topMenuImageUrls.slice();
  const imageThumbUrls = topMenuImageThumbUrls.slice();
  const btn = el("topMenuSaveBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    if (editingTopMenuId) {
      await updateDoc(doc(db, "topMenus", editingTopMenuId), { name, url, content, imageUrls, imageThumbUrls });
    } else {
      await addDoc(collection(db, "topMenus"), { name, url, content, imageUrls, imageThumbUrls, order: nextTopMenuOrder() });
    }
    cancelEditTopMenu();
    await loadTopMenu();
    renderTopMenuAdminList();
  } catch (err) {
    alert("저장 실패: " + (err.code || err.message));
  } finally {
    btn.disabled = false;
  }
});

// ---------- 음악 플레이어 ----------
// 곡 목록은 모든 방문자에게 공개, 추가/수정/삭제는 관리자만(firestore.rules 참고)

function nextMusicOrder() {
  if (!musicTracks.length) return Date.now();
  return Math.max(...musicTracks.map(r => r.order || 0)) + 10;
}

// 오디오 파일을 Cloudinary에 업로드해요(관리자 전용). 이미지의 uploadToImgBB와 같은 역할.
async function uploadAudioToCloudinary(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  // Cloudinary는 오디오/영상을 "video" 리소스 타입으로 다뤄요.
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!data.secure_url) throw new Error(data.error?.message || "업로드 실패");
  return data.secure_url;
}

async function loadMusicTracks() {
  try {
    const q = query(collection(db, "musicTracks"), orderBy("order", "asc"));
    const snap = await getDocs(q);
    musicTracks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    musicTracks = []; // 컬렉션이 아직 없거나 읽기 실패 시 그냥 안 보여줌
  }
}

// 페이지 로드 시 호출 - 플레이어 위젯 자체를 보여줄지, 목록을 채울지 담당
async function initMusicPlayer() {
  await loadMusicTracks();
  el("musicWidget").classList.toggle("hidden", musicTracks.length === 0 && !isAdmin);
  renderMusicPlaylist();
}

async function loadMusicAdminTab() {
  await loadMusicTracks();
  renderMusicAdminList();
  el("musicWidget").classList.remove("hidden");
  renderMusicPlaylist();
}

// ---- 관리자: 곡 추가/수정/삭제 ----
function renderMusicAdminList() {
  const listEl = el("musicAdminList");
  listEl.innerHTML = "";
  musicTracks.forEach((track, idx) => {
    const row = document.createElement("div");
    row.className = "manage-row";
    const label = `🎵 ${escapeHtml(track.title)}` + (track.artist ? ` <span style="color:var(--text-dim);">- ${escapeHtml(track.artist)}</span>` : "");
    row.innerHTML = `
      <span class="manage-row-label">${label}</span>
      <span class="manage-row-actions">
        <button data-act="up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button data-act="down" ${idx === musicTracks.length - 1 ? "disabled" : ""}>▼</button>
        <button data-act="edit">수정</button>
        <button data-act="del" class="danger">삭제</button>
      </span>
    `;
    row.querySelector('[data-act="up"]').addEventListener("click", () => moveMusicTrack(idx, -1));
    row.querySelector('[data-act="down"]').addEventListener("click", () => moveMusicTrack(idx, 1));
    row.querySelector('[data-act="edit"]').addEventListener("click", () => startEditMusic(track));
    row.querySelector('[data-act="del"]').addEventListener("click", () => deleteMusicTrack(track));
    listEl.appendChild(row);
  });
}

async function moveMusicTrack(idx, dir) {
  const otherIdx = idx + dir;
  if (otherIdx < 0 || otherIdx >= musicTracks.length) return;
  const a = musicTracks[idx], b = musicTracks[otherIdx];
  await Promise.all([
    updateDoc(doc(db, "musicTracks", a.id), { order: b.order }),
    updateDoc(doc(db, "musicTracks", b.id), { order: a.order }),
  ]);
  await loadMusicTracks();
  renderMusicAdminList();
  renderMusicPlaylist();
}

async function deleteMusicTrack(track) {
  if (!confirm(`"${track.title}" 곡을 삭제할까요?`)) return;
  const deletedIdx = musicTracks.findIndex(t => t.id === track.id);
  if (deletedIdx === currentTrackIndex) stopMusic();
  await deleteDoc(doc(db, "musicTracks", track.id));
  if (editingMusicId === track.id) cancelEditMusic();
  await loadMusicTracks();
  renderMusicAdminList();
  renderMusicPlaylist();
}

function startEditMusic(track) {
  editingMusicId = track.id;
  pendingMusicUpload = null;
  el("musicTitleInput").value = track.title || "";
  el("musicArtistInput").value = track.artist || "";
  el("musicFileName").textContent = "(파일은 그대로 두려면 새로 선택하지 않아도 돼요)";
  el("musicSaveBtn").textContent = "💾 수정 저장";
  el("musicCancelEditBtn").classList.remove("hidden");
  el("musicTitleInput").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelEditMusic() {
  editingMusicId = null;
  pendingMusicUpload = null;
  el("musicTitleInput").value = "";
  el("musicArtistInput").value = "";
  el("musicFileName").textContent = "";
  el("musicFileInput").value = "";
  el("musicSaveBtn").textContent = "➕ 곡 추가";
  el("musicCancelEditBtn").classList.add("hidden");
}
el("musicCancelEditBtn").addEventListener("click", cancelEditMusic);

el("musicFileInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const statusEl = el("musicUploadStatus");
  statusEl.classList.remove("hidden", "error");
  statusEl.textContent = "음악 파일 업로드 중...";
  el("musicFileName").textContent = "";
  try {
    const url = await uploadAudioToCloudinary(file);
    pendingMusicUpload = { url };
    statusEl.classList.add("hidden");
    el("musicFileName").textContent = `✅ 업로드 완료: ${file.name}`;
    // 제목을 아직 안 적었으면 파일명에서 확장자를 빼서 기본값으로 채워줘요.
    if (!el("musicTitleInput").value.trim()) {
      el("musicTitleInput").value = file.name.replace(/\.[^.]+$/, "");
    }
  } catch (err) {
    statusEl.classList.add("error");
    statusEl.textContent = "업로드 실패: " + err.message + " (Cloudinary 설정을 확인해주세요)";
  }
});

el("musicSaveBtn").addEventListener("click", async () => {
  if (!isAdmin) return;
  const title = el("musicTitleInput").value.trim();
  if (!title) { alert("곡 제목을 입력해주세요."); return; }
  const artist = el("musicArtistInput").value.trim();
  if (!editingMusicId && !pendingMusicUpload) { alert("음악 파일을 선택해주세요."); return; }
  const btn = el("musicSaveBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    if (editingMusicId) {
      const patch = { title, artist };
      if (pendingMusicUpload) patch.url = pendingMusicUpload.url;
      await updateDoc(doc(db, "musicTracks", editingMusicId), patch);
    } else {
      await addDoc(collection(db, "musicTracks"), {
        title, artist, url: pendingMusicUpload.url, order: nextMusicOrder(), createdAt: serverTimestamp(),
      });
    }
    cancelEditMusic();
    await loadMusicTracks();
    renderMusicAdminList();
    renderMusicPlaylist();
  } catch (err) {
    alert("저장 실패: " + (err.code || err.message));
  } finally {
    btn.disabled = false;
  }
});

// ---- 방문자용 플레이어 UI ----
function renderMusicPlaylist() {
  const listEl = el("musicPlaylist");
  const emptyEl = el("musicPlaylistEmpty");
  if (!musicTracks.length) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  listEl.innerHTML = musicTracks.map((track, idx) => `
    <div class="music-track ${idx === currentTrackIndex ? "active" : ""}" data-idx="${idx}">
      <span class="music-track-icon">${idx === currentTrackIndex && isMusicPlaying ? "🔊" : (idx + 1)}</span>
      <div class="music-track-info">
        <div class="music-track-title">${escapeHtml(track.title)}</div>
        ${track.artist ? `<div class="music-track-artist">${escapeHtml(track.artist)}</div>` : ""}
      </div>
    </div>
  `).join("");
  listEl.querySelectorAll(".music-track").forEach(rowEl => {
    rowEl.addEventListener("click", () => playMusicAt(Number(rowEl.dataset.idx)));
  });
}

function formatMusicTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function playMusicAt(idx) {
  if (idx < 0 || idx >= musicTracks.length) return;
  const audio = el("musicAudio");
  currentTrackIndex = idx;
  const track = musicTracks[idx];
  audio.src = track.url;
  audio.play().catch(() => {}); // 자동재생이 막힌 브라우저는 그냥 무시(사용자가 다시 누르면 재생됨)
  el("musicNowTitle").textContent = track.title;
  el("musicNowArtist").textContent = track.artist || "";
  renderMusicPlaylist();
}

function togglePlayPause() {
  const audio = el("musicAudio");
  if (currentTrackIndex === -1) {
    if (musicTracks.length) playMusicAt(0);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

function stopMusic() {
  const audio = el("musicAudio");
  audio.pause();
  audio.removeAttribute("src");
  currentTrackIndex = -1;
  isMusicPlaying = false;
  el("musicNowTitle").textContent = "재생 중인 곡이 없어요";
  el("musicNowArtist").textContent = "";
  renderMusicPlaylist();
}

// 다음에 재생할 곡의 인덱스를 정해요. 랜덤재생이 켜져 있으면 무작위로,
// 아니면 순서대로 다음 곡을 골라요.
function pickNextIndex() {
  if (!musicTracks.length) return -1;
  if (shuffleMode && musicTracks.length > 1) {
    let next;
    do { next = Math.floor(Math.random() * musicTracks.length); } while (next === currentTrackIndex);
    return next;
  }
  return (currentTrackIndex + 1) % musicTracks.length;
}

function playNextTrack() {
  if (!musicTracks.length) return;
  const next = pickNextIndex();
  if (next === -1) return;
  playMusicAt(next);
}
function playPrevTrack() {
  if (!musicTracks.length) return;
  if (shuffleMode && musicTracks.length > 1) {
    let prev;
    do { prev = Math.floor(Math.random() * musicTracks.length); } while (prev === currentTrackIndex);
    playMusicAt(prev);
    return;
  }
  playMusicAt((currentTrackIndex - 1 + musicTracks.length) % musicTracks.length);
}

// 곡이 끝났을 때: 한 곡 반복이면 같은 곡을 다시, 전체 반복/랜덤이면 다음 곡,
// 그냥 듣기(반복 없음)면 마지막 곡에서 멈춰요.
function handleTrackEnded() {
  if (repeatMode === "one") {
    const audio = el("musicAudio");
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  const isLast = currentTrackIndex === musicTracks.length - 1;
  if (repeatMode === "off" && !shuffleMode && isLast) {
    stopMusic();
    return;
  }
  playNextTrack();
}

// ---- 반복재생 / 랜덤재생 모드 ----
function cycleRepeatMode() {
  repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
  updatePlaybackModeUI();
}
function toggleShuffleMode() {
  shuffleMode = !shuffleMode;
  updatePlaybackModeUI();
}
function updatePlaybackModeUI() {
  const repeatBtn = el("musicRepeatBtn");
  repeatBtn.classList.toggle("active", repeatMode !== "off");
  repeatBtn.textContent = repeatMode === "one" ? "🔂" : "🔁";
  repeatBtn.title = repeatMode === "off" ? "반복 안 함 (그냥 듣기)" : repeatMode === "all" ? "전체 반복" : "한 곡 반복";
  const shuffleBtn = el("musicShuffleBtn");
  shuffleBtn.classList.toggle("active", shuffleMode);
  shuffleBtn.title = shuffleMode ? "랜덤재생 끄기" : "랜덤재생 켜기";
}
el("musicRepeatBtn").addEventListener("click", cycleRepeatMode);
el("musicShuffleBtn").addEventListener("click", toggleShuffleMode);

el("musicToggleBtn").addEventListener("click", () => {
  el("musicPanel").classList.toggle("hidden");
});
el("musicPanelCloseBtn").addEventListener("click", () => {
  el("musicPanel").classList.add("hidden");
});
el("musicPlayBtn").addEventListener("click", togglePlayPause);
el("musicPrevBtn").addEventListener("click", playPrevTrack);
el("musicNextBtn").addEventListener("click", playNextTrack);

el("musicSeekBar").addEventListener("input", (e) => {
  const audio = el("musicAudio");
  if (!audio.duration) return;
  audio.currentTime = (Number(e.target.value) / 100) * audio.duration;
});
el("musicVolumeBar").addEventListener("input", (e) => {
  el("musicAudio").volume = Number(e.target.value);
});
el("musicAudio").volume = 0.7;

el("musicAudio").addEventListener("play", () => {
  isMusicPlaying = true;
  el("musicPlayBtn").textContent = "⏸";
  el("musicToggleIcon").classList.add("playing");
  renderMusicPlaylist();
});
el("musicAudio").addEventListener("pause", () => {
  isMusicPlaying = false;
  el("musicPlayBtn").textContent = "▶";
  el("musicToggleIcon").classList.remove("playing");
  renderMusicPlaylist();
});
el("musicAudio").addEventListener("ended", handleTrackEnded);
el("musicAudio").addEventListener("timeupdate", () => {
  const audio = el("musicAudio");
  el("musicCurTime").textContent = formatMusicTime(audio.currentTime);
  if (audio.duration) {
    el("musicSeekBar").value = (audio.currentTime / audio.duration) * 100;
    el("musicDurTime").textContent = formatMusicTime(audio.duration);
  }
});
el("musicAudio").addEventListener("loadedmetadata", () => {
  el("musicDurTime").textContent = formatMusicTime(el("musicAudio").duration);
});

// ---------- 게시글 일괄 관리 ----------
let adminAllPostEntries = []; // [{docSnap, boardName}, ...] - 전체 게시글 (게시판 필터/검색은 이 배열에서 클라이언트가 처리)
let adminSelectedPostIds = new Set();

async function loadPostAdminList() {
  const listEl = el("postAdminList");
  listEl.innerHTML = "불러오는 중...";
  adminSelectedPostIds.clear();
  updatePostAdminSelectedCount();

  const boards = boardRows.filter(r => r.type === "board");
  const boardFilterSel = el("postAdminBoardFilter");
  const moveSel = el("postAdminMoveSelect");
  const prevFilter = boardFilterSel.value;
  boardFilterSel.innerHTML = `<option value="">전체 게시판</option>` +
    boards.map(b => `<option value="${b.id}">${visibilityIcon(b)}${escapeHtml(b.name)}</option>`).join("");
  boardFilterSel.value = prevFilter && boards.some(b => b.id === prevFilter) ? prevFilter : "";
  moveSel.innerHTML = boards.map(b => `<option value="${b.id}">${visibilityIcon(b)}${escapeHtml(b.name)}</option>`).join("");

  const boardNameById = new Map(boards.map(b => [b.id, b.name]));
  try {
    const snap = await getDocs(collection(db, "posts"));
    adminAllPostEntries = snap.docs.map(docSnap => ({
      docSnap,
      boardName: boardNameById.get(docSnap.data().boardId) || "(삭제된 게시판)",
    }));
  } catch (err) {
    listEl.innerHTML = `<p class="empty-state">불러오지 못했어요. (${err.code || err.message})</p>`;
    return;
  }
  renderPostAdminList();
}

function renderPostAdminList() {
  const listEl = el("postAdminList");
  const keyword = el("postAdminSearchInput").value.trim().toLowerCase();
  const boardFilter = el("postAdminBoardFilter").value;

  let entries = adminAllPostEntries.filter(({ docSnap }) => {
    const d = docSnap.data();
    if (boardFilter && d.boardId !== boardFilter) return false;
    if (keyword && !(d.title || "").toLowerCase().includes(keyword)) return false;
    return true;
  });
  entries = sortForBoardList(entries, e => e.docSnap.data());

  el("postAdminSelectAll").checked = entries.length > 0 && entries.every(({ docSnap }) => adminSelectedPostIds.has(docSnap.id));

  if (!entries.length) {
    listEl.innerHTML = `<p class="empty-state">조건에 맞는 게시글이 없어요.</p>`;
    return;
  }

  listEl.innerHTML = "";
  entries.forEach(({ docSnap, boardName }) => {
    const p = docSnap.data();
    const id = docSnap.id;
    const row = document.createElement("div");
    row.className = "manage-row post-admin-row";
    row.innerHTML = `
      <label class="checkbox-label post-admin-checkbox">
        <input type="checkbox" data-id="${id}" ${adminSelectedPostIds.has(id) ? "checked" : ""}>
      </label>
      <div class="member-row-info" style="flex:1; min-width:0;">
        <span class="member-row-email">${p.isPinned ? "📌 " : ""}${escapeHtml(p.title)}</span>
        <span class="member-row-meta">
          <span class="board-tag">${escapeHtml(boardName)}</span>
          <span>${formatDate(p.createdAt)}</span>
          <span>👁 ${p.views || 0}</span>
        </span>
      </div>
      <span class="manage-row-actions">
        <button data-act="pin">${p.isPinned ? "고정 해제" : "📌 고정"}</button>
        <button data-act="open">보기</button>
      </span>
    `;
    row.querySelector("input[data-id]").addEventListener("change", (e) => {
      if (e.target.checked) adminSelectedPostIds.add(id); else adminSelectedPostIds.delete(id);
      updatePostAdminSelectedCount();
      el("postAdminSelectAll").checked = entries.every(en => adminSelectedPostIds.has(en.docSnap.id));
    });
    row.querySelector('[data-act="pin"]').addEventListener("click", async () => {
      await updateDoc(docSnap.ref, { isPinned: !p.isPinned });
      invalidateBoardCache(p.boardId);
      loadPostAdminList();
    });
    row.querySelector('[data-act="open"]').addEventListener("click", () => openPost(id));
    listEl.appendChild(row);
  });
}

function updatePostAdminSelectedCount() {
  el("postAdminSelectedCount").textContent = adminSelectedPostIds.size ? `${adminSelectedPostIds.size}개 선택됨` : "";
}

el("postAdminSearchInput").addEventListener("input", renderPostAdminList);
el("postAdminBoardFilter").addEventListener("change", renderPostAdminList);

el("postAdminSelectAll").addEventListener("change", (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('#postAdminList input[type="checkbox"][data-id]').forEach(cb => {
    cb.checked = checked;
    if (checked) adminSelectedPostIds.add(cb.dataset.id); else adminSelectedPostIds.delete(cb.dataset.id);
  });
  updatePostAdminSelectedCount();
});

async function bulkSetPinned(val) {
  if (!adminSelectedPostIds.size) return;
  await Promise.all([...adminSelectedPostIds].map(id => updateDoc(doc(db, "posts", id), { isPinned: val })));
  invalidateBoardCache();
  loadPostAdminList();
}
el("postAdminPinBtn").addEventListener("click", () => bulkSetPinned(true));
el("postAdminUnpinBtn").addEventListener("click", () => bulkSetPinned(false));

el("postAdminDeleteBtn").addEventListener("click", async () => {
  if (!adminSelectedPostIds.size) return;
  if (!confirm(`선택한 게시글 ${adminSelectedPostIds.size}개를 삭제할까요? 되돌릴 수 없어요.`)) return;
  await Promise.all([...adminSelectedPostIds].map(id => deleteDoc(doc(db, "posts", id))));
  invalidateBoardCache();
  loadPostAdminList();
});

el("postAdminMoveBtn").addEventListener("click", async () => {
  if (!adminSelectedPostIds.size) return;
  const targetId = el("postAdminMoveSelect").value;
  const targetBoard = boardRows.find(b => b.id === targetId);
  if (!targetBoard) return;
  if (!confirm(`선택한 게시글 ${adminSelectedPostIds.size}개를 "${targetBoard.name}"(으)로 이동할까요?`)) return;
  await Promise.all([...adminSelectedPostIds].map(id =>
    updateDoc(doc(db, "posts", id), { boardId: targetId, isPrivate: !!targetBoard.isPrivate, visibility: getVisibility(targetBoard) })
  ));
  invalidateBoardCache();
  loadPostAdminList();
});

// ---------- 통계 ----------
async function loadStats() {
  const gridEl = el("statsSummaryGrid");
  const boardEl = el("statsBoardBreakdown");
  const topEl = el("statsTopPosts");
  gridEl.innerHTML = `<p class="empty-state">불러오는 중...</p>`;
  boardEl.innerHTML = "";
  topEl.innerHTML = "";

  let postsSnap, membersSnap;
  try {
    [postsSnap, membersSnap] = await Promise.all([
      getDocs(collection(db, "posts")),
      getDocs(collection(db, "members")),
    ]);
  } catch (err) {
    gridEl.innerHTML = `<p class="empty-state">불러오지 못했어요. (${err.code || err.message})</p>`;
    return;
  }

  const postDatas = postsSnap.docs.map(d => d.data());
  const totalPosts = postDatas.length;
  const totalViews = postDatas.reduce((sum, p) => sum + (p.views || 0), 0);
  const totalBoards = boardRows.filter(r => r.type === "board").length;
  const approvedMembers = membersSnap.docs.filter(d => d.data().approved !== false).length;

  gridEl.innerHTML = `
    <div class="stat-card"><div class="stat-num">${totalPosts}</div><div class="stat-label">전체 게시글</div></div>
    <div class="stat-card"><div class="stat-num">${totalViews}</div><div class="stat-label">전체 조회수</div></div>
    <div class="stat-card"><div class="stat-num">${totalBoards}</div><div class="stat-label">게시판 수</div></div>
    <div class="stat-card"><div class="stat-num">${approvedMembers}</div><div class="stat-label">승인된 회원</div></div>
  `;

  const countByBoard = new Map();
  postDatas.forEach(p => countByBoard.set(p.boardId, (countByBoard.get(p.boardId) || 0) + 1));
  const breakdown = boardRows.filter(r => r.type === "board")
    .map(b => ({ name: b.name, count: countByBoard.get(b.id) || 0 }))
    .sort((a, b) => b.count - a.count);
  boardEl.innerHTML = breakdown.length
    ? breakdown.map(b => `<div class="manage-row"><span class="manage-row-label">${escapeHtml(b.name)}</span><span class="hint-text" style="margin:0;">${b.count}개</span></div>`).join("")
    : `<p class="empty-state">게시판이 없어요.</p>`;

  const top = postsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 5);
  topEl.innerHTML = top.length
    ? top.map(p => `<div class="manage-row" style="cursor:pointer;" data-id="${p.id}"><span class="manage-row-label">${escapeHtml(p.title)}</span><span class="hint-text" style="margin:0;">👁 ${p.views || 0}</span></div>`).join("")
    : `<p class="empty-state">아직 게시글이 없어요.</p>`;
  topEl.querySelectorAll("[data-id]").forEach(rowEl => {
    rowEl.addEventListener("click", () => openPost(rowEl.dataset.id));
  });
}

// ---------- 이미지 확대보기(라이트박스) ----------
let lightboxImages = [];
let lightboxIndex = 0;

function openLightbox(images, idx) {
  lightboxImages = images;
  lightboxIndex = idx;
  renderLightbox();
  el("lightbox").classList.remove("hidden");
}
function renderLightbox() {
  el("lightboxSpinner").classList.remove("hidden");
  el("lightboxImg").classList.add("hidden");
  el("lightboxImg").src = lightboxImages[lightboxIndex];
  const multi = lightboxImages.length > 1;
  el("lightboxPrev").classList.toggle("hidden", !multi);
  el("lightboxNext").classList.toggle("hidden", !multi);
}
el("lightboxImg").addEventListener("load", () => {
  el("lightboxSpinner").classList.add("hidden");
  el("lightboxImg").classList.remove("hidden");
});
el("lightboxImg").addEventListener("error", () => {
  el("lightboxSpinner").classList.add("hidden");
});
function closeLightbox() {
  el("lightbox").classList.add("hidden");
}
el("lightboxClose").addEventListener("click", closeLightbox);
el("lightbox").addEventListener("click", (e) => {
  if (e.target.id === "lightbox") closeLightbox();
});
el("lightboxPrev").addEventListener("click", () => {
  lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
  renderLightbox();
});
el("lightboxNext").addEventListener("click", () => {
  lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
  renderLightbox();
});
document.addEventListener("keydown", (e) => {
  if (el("lightbox").classList.contains("hidden")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") el("lightboxPrev").click();
  if (e.key === "ArrowRight") el("lightboxNext").click();
});

// ---------- 라이트박스 스와이프 (모바일) ----------
// 좌우로 스와이프하면 이전/다음 사진, 아래로 스와이프하면 닫기.
(() => {
  const imgEl = el("lightboxImg");
  let startX = 0, startY = 0, dragX = 0, dragY = 0, dragging = false;

  imgEl.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    dragging = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    dragX = 0;
    dragY = 0;
    imgEl.style.transition = "none";
  }, { passive: true });

  imgEl.addEventListener("touchmove", (e) => {
    if (!dragging || e.touches.length !== 1) return;
    dragX = e.touches[0].clientX - startX;
    dragY = e.touches[0].clientY - startY;
    // 가로 움직임이 더 크면 좌우 넘기기 동작으로 보고, 손가락을 따라 살짝 이동시켜 보여줘요.
    if (Math.abs(dragX) > Math.abs(dragY)) {
      imgEl.style.transform = `translateX(${dragX}px)`;
    } else {
      imgEl.style.transform = `translateY(${Math.max(0, dragY)}px)`;
    }
  }, { passive: true });

  imgEl.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    imgEl.style.transition = "transform .2s ease";
    imgEl.style.transform = "";

    const SWIPE_THRESHOLD = 60;
    if (Math.abs(dragX) > Math.abs(dragY) && Math.abs(dragX) > SWIPE_THRESHOLD) {
      if (dragX < 0) el("lightboxNext").click();
      else el("lightboxPrev").click();
    } else if (dragY > SWIPE_THRESHOLD * 1.5) {
      closeLightbox();
    }
  });
})();

// ---------- 전체 백업 ----------
el("backupBtn").addEventListener("click", async () => {
  const btn = el("backupBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "백업 만드는 중...";
  try {
    const postsSnap = await getDocs(collection(db, "posts"));
    const posts = postsSnap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        boardId: data.boardId,
        title: data.title || "",
        content: data.content || "",
        author: data.author || "",
        imageUrls: getImages(data),
        views: data.views || 0,
        isPrivate: !!data.isPrivate,
        visibility: getVisibility(data),
        createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toISOString() : null,
      };
    });
    const backup = {
      exportedAt: new Date().toISOString(),
      boards: boardRows.map((row) => ({ id: row.id, type: row.type, name: row.name, isPrivate: !!row.isPrivate, visibility: getVisibility(row), order: row.order })),
      posts,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gugu-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("백업 실패: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
});

// ---------- 유틸 ----------
// 이미지를 <span class="img-wrap">로 감싸서 로딩중 스피너 → 로드완료/에러 상태를 자동으로 표시
function imgWrap(src, opts = {}) {
  const { wrapClass = "", imgClass = "", imgAttrs = "" } = opts;
  return `<span class="img-wrap ${wrapClass}">
    <span class="img-spinner"></span>
    <span class="img-error-msg">이미지를<br>불러올 수 없어요</span>
    <img src="${src}" alt="" class="${imgClass}" ${imgAttrs}
      onload="this.closest('.img-wrap').classList.add('img-loaded')"
      onerror="this.closest('.img-wrap').classList.add('img-error')">
  </span>`;
}

function getImages(p) {
  if (Array.isArray(p.imageUrls) && p.imageUrls.length) return p.imageUrls;
  if (p.imageUrl) return [p.imageUrl];
  return [];
}

// 목록/미리보기용 작은 썸네일 목록. imageThumbUrls가 없거나 개수가 안 맞는 옛날 글은
// 원본 이미지 URL을 그대로 써요(느리긴 해도 안 깨지는 게 우선).
function getThumbs(p) {
  const images = getImages(p);
  if (Array.isArray(p.imageThumbUrls) && p.imageThumbUrls.length === images.length) return p.imageThumbUrls;
  return images;
}

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const time = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  return `${date} ${time}`;
}
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

renderBoardTree();
showHomeDashboard();
loadSiteConfig();
loadTopMenu();
initMusicPlayer();

// ---------- PWA: 서비스워커 등록 ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
