import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, orderBy, addDoc, doc,
  deleteDoc, getDocs, getDoc, setDoc, serverTimestamp, updateDoc, increment,
  arrayUnion, arrayRemove
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
let memberTiers = []; // Firestore "memberTiers" 컬렉션 (회원 등급 목록, order 오름차순 = 낮은 등급부터)
let myTierId = null; // 지금 로그인한 회원에게 배정된 등급 id (없으면 null = 기본 등급)
let favoritePostIds = new Set(); // 로그인한 사람이 즐겨찾기한 게시글 id들(본인만 봄)
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
let selectedImageDeleteUrls = []; // 위 이미지들과 같은 순서의 ImgBB 삭제용 링크(있으면). 게시글 삭제할 때 같이 정리하는 데 씀.

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
  if (vis === "members") {
    if (isAdmin) return true;
    if (!currentUser) return false;
    return tierOrderOf(myTierId) >= tierOrderOf(row.minTierId);
  }
  return true; // public
}
function tierOrderOf(tierId) {
  if (!tierId) return 0;
  const t = memberTiers.find(x => x.id === tierId);
  return t ? (t.order || 0) : 0;
}
function tierName(tierId) {
  if (!tierId) return "기본 등급";
  const t = memberTiers.find(x => x.id === tierId);
  return t ? t.name : "기본 등급";
}
async function loadMemberTiers() {
  try {
    const snap = await getDocs(query(collection(db, "memberTiers"), orderBy("order", "asc")));
    memberTiers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    memberTiers = [];
  }
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

  if (path === "/gallery") {
    selectGallery({ skipUrl: true });
    return;
  }

  if (path === "/favorites") {
    if (currentUser) selectFavorites({ skipUrl: true });
    else replaceUrl("/");
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

// ---------- 즐겨찾기(개인 북마크) ----------
// favorites/{uid} 문서 하나에 postIds 배열로 저장해요. 본인만 읽고 쓸 수 있어요(firestore.rules 참고).
async function loadFavorites() {
  favoritePostIds = new Set();
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(db, "favorites", currentUser.uid));
    if (snap.exists()) {
      favoritePostIds = new Set(snap.data().postIds || []);
    }
  } catch (e) {
    // 못 불러와도 그냥 빈 목록으로 시작(치명적이지 않음)
  }
}

async function toggleFavorite(postId) {
  if (!currentUser) return;
  const isFav = favoritePostIds.has(postId);
  const ref = doc(db, "favorites", currentUser.uid);
  try {
    if (isFav) {
      favoritePostIds.delete(postId);
      await setDoc(ref, { postIds: arrayRemove(postId) }, { merge: true });
    } else {
      favoritePostIds.add(postId);
      await setDoc(ref, { postIds: arrayUnion(postId) }, { merge: true });
    }
  } catch (e) {
    // 실패하면 화면 표시를 되돌려요
    if (isFav) favoritePostIds.add(postId); else favoritePostIds.delete(postId);
    alert("즐겨찾기 저장에 실패했어요: " + e.message);
  }
  const btn = el("favToggleBtn");
  if (btn) {
    const nowFav = favoritePostIds.has(postId);
    btn.textContent = nowFav ? "⭐" : "☆";
    btn.classList.toggle("active", nowFav);
  }
}

function selectFavorites(opts = {}) {
  currentBoardId = "__favorites__";
  currentBoard = null;
  el("currentBoardName").textContent = "⭐ 즐겨찾기";
  el("writeBtn").classList.add("hidden");
  showListView();
  hideHomeDashboard();
  renderBoardTree();
  loadFavoritePosts();
  if (!opts.skipUrl) pushUrl("/favorites");
}

async function loadFavoritePosts() {
  const myToken = ++navToken;
  const listEl = el("postList");
  listEl.innerHTML = `<p class="empty-state">불러오는 중...</p>`;
  el("emptyState").classList.add("hidden");
  el("pagination").classList.add("hidden");

  const ids = Array.from(favoritePostIds);
  if (!ids.length) {
    if (myToken !== navToken) return;
    listEl.innerHTML = "";
    el("emptyState").classList.remove("hidden");
    el("emptyState").querySelector("p").textContent = "아직 즐겨찾기한 글이 없어요. 게시글 상세에서 ☆를 눌러보세요.";
    return;
  }

  const boardNameOf = (boardId) => (boardRows.find(b => b.id === boardId) || {}).name;
  const results = await mapWithConcurrency(ids, 6, async (id) => {
    try {
      const snap = await getDoc(doc(db, "posts", id));
      if (!snap.exists()) return null;
      return { docSnap: snap, boardName: boardNameOf(snap.data().boardId) };
    } catch (e) {
      return null; // 삭제됐거나 더 이상 볼 권한이 없는 글은 조용히 건너뜀
    }
  });
  if (myToken !== navToken) return;

  let entries = results.filter(Boolean);
  if (!entries.length) {
    listEl.innerHTML = "";
    el("emptyState").classList.remove("hidden");
    el("emptyState").querySelector("p").textContent = "즐겨찾기한 글을 더 이상 볼 수 없어요(삭제되었거나 권한이 바뀌었어요).";
    return;
  }
  el("emptyState").classList.add("hidden");
  entries = sortByDateDesc(entries, e => e.docSnap.data());
  showPostListPage(entries);
}


onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  isAdmin = false;
  canViewPrivate = false;
  myTierId = null;

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
        myTierId = data.tierId || null;
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
  el("nicknameBtn").classList.toggle("hidden", !user);
  el("adminMenuBtn").classList.toggle("hidden", !isAdmin);
  el("whoami").textContent = isAdmin ? "관리자로 로그인됨" : (user ? `회원으로 로그인됨 (${emailToId(user.email)})` : "");
  el("writeBtn").classList.toggle("hidden", !(isAdmin && currentBoard));
  el("musicWidget").classList.toggle("hidden", musicTracks.length === 0 && !isAdmin);
  await loadFavorites();

  try {
    await loadBoardConfig();
    if (!didInitialRoute) {
      didInitialRoute = true;
      await routeFromLocation();
    } else if (!el("adminView").classList.contains("hidden")) {
      refreshPendingBadge(); // 관리자 화면을 보는 중이면 뱃지만 갱신
    } else if (currentBoardId === "__all__") loadAllPosts();
    else if (currentBoardId === "__search__") performSearch({ skipUrl: true });
    else if (currentBoardId === "__favorites__") loadFavoritePosts();
    else if (currentBoardId) loadPosts(currentBoardId);
  } catch (e) {
    // 초기화 중 어디서든 문제가 생겨도 화면이 빈 채로 멈추지 않게, 최소한 게시판 트리는 다시 그려봄
    renderBoardTree();
  }
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
  tiers: loadMemberTiersAdminTab,
  topmenu: loadTopMenuAdminTab,
  music: loadMusicAdminTab,
  stats: loadStats,
  site: fillSiteSettingsForm,
  live: fillLiveSettingsForm,
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
    const oldDeleteUrls = Array.isArray(p.imageDeleteUrls) ? p.imageDeleteUrls : [];
    const results = await Promise.all(images.map(async (url, j) => {
      try {
        const resp = await fetch(url, { mode: "cors" });
        if (!resp.ok) throw new Error("이미지를 가져오지 못함");
        const blob = await resp.blob();
        const file = new File([blob], "image.jpg", { type: blob.type || "image/jpeg" });
        const { url: newUrl, thumbUrl, deleteUrl } = await uploadToImgBB(file); // 리사이즈 후 재업로드
        return { ok: true, url: newUrl, thumbUrl, deleteUrl };
      } catch (err) {
        return { ok: false, url, thumbUrl: oldThumbs[j] || url, deleteUrl: oldDeleteUrls[j] || null };
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
      updates.imageDeleteUrls = results.map(r => r.deleteUrl || null);
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
  if (!memberTiers.length) await loadMemberTiers();
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
        <select class="admin-select" data-role="tier" style="width:auto;"></select>
        ${approved ? `<button data-act="block">차단</button>` : `<button data-act="approve">승인</button>`}
        <button data-act="delete" class="danger">삭제</button>
      </span>
    `;

    const tierSel = row.querySelector('[data-role="tier"]');
    tierSel.innerHTML = `<option value="">기본 등급</option>` +
      memberTiers.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
    tierSel.value = m.tierId || "";
    tierSel.addEventListener("change", async () => {
      await updateDoc(doc(db, "members", m.id), { tierId: tierSel.value || null });
      const found = allMembers.find(x => x.id === m.id);
      if (found) found.tierId = tierSel.value || null;
    });

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

// ---------- 회원 등급 관리 ----------
function nextTierOrder() {
  if (!memberTiers.length) return 10;
  return Math.max(...memberTiers.map(t => t.order || 0)) + 10;
}

async function loadMemberTiersAdminTab() {
  await loadMemberTiers();
  renderMemberTiersAdminList();
}

function renderMemberTiersAdminList() {
  const listEl = el("memberTiersList");
  if (!listEl) return;
  if (!memberTiers.length) {
    listEl.innerHTML = `<p class="hint-text">아직 만든 등급이 없어요. 등급을 안 만들면 회원공개 게시판은 예전처럼 "로그인만 하면 누구나" 볼 수 있어요.</p>`;
    return;
  }
  listEl.innerHTML = "";
  memberTiers.forEach((tier, idx) => {
    const row = document.createElement("div");
    row.className = "manage-row";
    row.innerHTML = `
      <span class="manage-row-label">👑 ${escapeHtml(tier.name)}</span>
      <span class="manage-row-actions">
        <button data-act="up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button data-act="down" ${idx === memberTiers.length - 1 ? "disabled" : ""}>▼</button>
        <button data-act="rename">이름 변경</button>
        <button data-act="del" class="danger">삭제</button>
      </span>
    `;
    row.querySelector('[data-act="up"]').addEventListener("click", () => moveMemberTier(idx, -1));
    row.querySelector('[data-act="down"]').addEventListener("click", () => moveMemberTier(idx, 1));
    row.querySelector('[data-act="rename"]').addEventListener("click", async () => {
      const next = prompt("등급 이름을 입력해주세요", tier.name);
      if (next === null) return;
      const trimmed = next.trim();
      if (!trimmed) return;
      await updateDoc(doc(db, "memberTiers", tier.id), { name: trimmed });
      await loadMemberTiersAdminTab();
    });
    row.querySelector('[data-act="del"]').addEventListener("click", async () => {
      if (!confirm(`"${tier.name}" 등급을 삭제할까요?\n이 등급을 쓰던 회원/게시판은 자동으로 기본 등급 취급이 돼요.`)) return;
      await deleteDoc(doc(db, "memberTiers", tier.id));
      await loadMemberTiersAdminTab();
    });
    listEl.appendChild(row);
  });
}

async function moveMemberTier(idx, dir) {
  const otherIdx = idx + dir;
  if (otherIdx < 0 || otherIdx >= memberTiers.length) return;
  const a = memberTiers[idx], b = memberTiers[otherIdx];
  await Promise.all([
    updateDoc(doc(db, "memberTiers", a.id), { order: b.order }),
    updateDoc(doc(db, "memberTiers", b.id), { order: a.order }),
  ]);
  await loadMemberTiersAdminTab();
}

el("memberTierAddBtn")?.addEventListener("click", async () => {
  const input = el("memberTierNameInput");
  const name = input.value.trim();
  if (!name) { alert("등급 이름을 입력해주세요."); return; }
  await addDoc(collection(db, "memberTiers"), { name, order: nextTierOrder() });
  input.value = "";
  await loadMemberTiersAdminTab();
});


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
async function loadBoardConfig(isRetry = false) {
  let snap;
  try {
    const q = query(collection(db, "boards"), orderBy("order", "asc"));
    snap = await getDocs(q);
  } catch (e) {
    if (!isRetry) {
      // 서버 응답이 잠깐 느리거나 끊긴 걸 수도 있으니, 1.5초 뒤 한 번만 조용히 다시 시도해봄
      await new Promise(r => setTimeout(r, 1500));
      return loadBoardConfig(true);
    }
    // 재시도까지 실패하면, 화면을 빈 채로 방치하지 않고 안내 문구라도 보여줌
    boardRows = [];
    const treeEl = el("boardTree");
    if (treeEl) {
      treeEl.innerHTML = `<p class="empty-state">게시판을 불러오지 못했어요.<br><button id="retryLoadBoardsBtn" class="btn btn-ghost" style="margin-top:8px;">다시 시도</button></p>`;
      const retryBtn = el("retryLoadBoardsBtn");
      if (retryBtn) retryBtn.addEventListener("click", () => loadBoardConfig());
    }
    return;
  }

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
let siteConfig = { siteAvatar: "🐦", siteName: "+구구+", siteTagline: "개인 팬 아카이브 홈페이지", adminNickname: "" };

async function loadSiteConfig() {
  try {
    const snap = await getDoc(doc(db, "config", "site"));
    if (snap.exists()) {
      const d = snap.data();
      siteConfig = {
        siteAvatar: d.siteAvatar || siteConfig.siteAvatar,
        siteName: d.siteName || siteConfig.siteName,
        siteTagline: d.siteTagline || siteConfig.siteTagline,
        adminNickname: d.adminNickname || siteConfig.adminNickname,
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

// ---------- 생방송 설정 ----------
// config/live 문서: manualOn(수동 on/off), bjId(자동감지용 SOOP 아이디), autoDetect(자동감지 시도 여부),
// title/url(배너에 표시할 제목/링크), showTop/showSidebar(표시 위치)
let liveConfig = {
  manualOn: false, autoDetect: false, bjId: "", title: "", url: "",
  showTop: true, showSidebar: true,
};
let liveCheckTimer = null;

async function loadLiveConfig() {
  try {
    const snap = await getDoc(doc(db, "config", "live"));
    if (snap.exists()) {
      const d = snap.data();
      liveConfig = {
        manualOn: !!d.manualOn,
        autoDetect: !!d.autoDetect,
        bjId: d.bjId || "",
        title: d.title || "",
        url: d.url || "",
        showTop: d.showTop !== false,
        showSidebar: d.showSidebar !== false,
      };
    }
  } catch (e) {
    // 무시 - 라이브 배너는 안 보이는 상태로 유지
  }
  resolveLiveStatus();

  // 자동 감지가 켜져있으면 5분마다 다시 확인해요 (사이트를 오래 열어놔도 라이브 상태가 갱신되게)
  if (liveCheckTimer) clearInterval(liveCheckTimer);
  if (liveConfig.autoDetect && liveConfig.bjId) {
    liveCheckTimer = setInterval(resolveLiveStatus, 5 * 60 * 1000);
  }
}

// 자동 감지가 켜져있으면 SOOP에서 방송 중인지 확인을 시도하고, 안 되면 수동 설정값을 그대로 써요.
// (SOOP의 비공식 API라 브라우저에서 막혀있을 수도 있어요 - 그런 경우 조용히 실패하고 수동값으로 대체돼요)
async function resolveLiveStatus() {
  let isLive = liveConfig.manualOn;
  let title = liveConfig.title;

  if (liveConfig.autoDetect && liveConfig.bjId) {
    const auto = await checkAutoLiveStatus(liveConfig.bjId);
    if (auto !== null) {
      isLive = auto.isLive;
      if (auto.isLive && auto.title) title = auto.title;
    }
    // auto가 null이면(자동 감지 실패) 수동값(liveConfig.manualOn)을 그대로 유지
  }

  renderLiveDisplay(isLive, title);
}

async function checkAutoLiveStatus(bjId) {
  try {
    const res = await fetch(`https://bjapi.afreecatv.com/api/${encodeURIComponent(bjId)}/station`);
    if (!res.ok) return null;
    const data = await res.json();
    // SOOP 응답 구조가 바뀔 수 있어서 여러 가능한 위치를 다 확인해봐요.
    const broad = data?.broad || data?.station?.broad || data?.BROAD || null;
    const broadNo = broad?.broad_no || broad?.broadNo || data?.broad_no;
    return { isLive: !!broadNo, title: broad?.broad_title || broad?.title || "" };
  } catch (e) {
    return null; // CORS로 막혔거나 실패 - 자동 감지 포기
  }
}

function renderLiveDisplay(isLive, title) {
  const topEl = el("liveTopBanner");
  const sideEl = el("liveSidebarBadge");
  const showTop = isLive && liveConfig.showTop;
  const showSidebar = isLive && liveConfig.showSidebar;

  topEl.classList.toggle("hidden", !showTop);
  sideEl.classList.toggle("hidden", !showSidebar);
  if (showTop || showSidebar) {
    const text = title ? `지금 라이브 중 · ${title}` : "지금 라이브 중";
    el("liveTopBannerText").textContent = text;
    el("liveSidebarBadgeText").textContent = text;
    topEl.href = liveConfig.url || "#";
    sideEl.href = liveConfig.url || "#";
  }
}

function fillLiveSettingsForm() {
  el("liveManualToggle").checked = liveConfig.manualOn;
  el("liveAutoDetectToggle").checked = liveConfig.autoDetect;
  el("liveBjIdInput").value = liveConfig.bjId;
  el("liveTitleInput").value = liveConfig.title;
  el("liveUrlInput").value = liveConfig.url;
  el("liveShowTopCheck").checked = liveConfig.showTop;
  el("liveShowSidebarCheck").checked = liveConfig.showSidebar;
  el("liveSettingsStatus").textContent = "";
}

el("liveSettingsSaveBtn").addEventListener("click", async () => {
  const btn = el("liveSettingsSaveBtn");
  const statusEl = el("liveSettingsStatus");
  btn.disabled = true;
  const newConfig = {
    manualOn: el("liveManualToggle").checked,
    autoDetect: el("liveAutoDetectToggle").checked,
    bjId: el("liveBjIdInput").value.trim(),
    title: el("liveTitleInput").value.trim(),
    url: el("liveUrlInput").value.trim(),
    showTop: el("liveShowTopCheck").checked,
    showSidebar: el("liveShowSidebarCheck").checked,
  };
  try {
    await setDoc(doc(db, "config", "live"), newConfig, { merge: true });
    liveConfig = newConfig;
    statusEl.textContent = "저장했어요 ✓";
    setTimeout(() => { statusEl.textContent = ""; }, 2500);
    loadLiveConfig(); // 저장한 값으로 배너도 바로 갱신 + 자동감지 타이머 재설정
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

  const galleryItem = document.createElement("div");
  galleryItem.className = "board-item all-board-item" + (currentBoardId === "__gallery__" ? " active" : "");
  galleryItem.innerHTML = "📷 사진 갤러리";
  galleryItem.addEventListener("click", () => selectGallery());
  treeEl.appendChild(galleryItem);

  if (currentUser) {
    const favItem = document.createElement("div");
    favItem.className = "board-item all-board-item" + (currentBoardId === "__favorites__" ? " active" : "");
    favItem.innerHTML = "⭐ 즐겨찾기";
    favItem.addEventListener("click", () => selectFavorites());
    treeEl.appendChild(favItem);
  }

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

function selectGallery(opts = {}) {
  currentBoardId = "__gallery__";
  currentBoard = null;
  el("writeBtn").classList.add("hidden");
  showGalleryView();
  hideHomeDashboard();
  renderBoardTree();
  loadGalleryImages();
  if (!opts.skipUrl) pushUrl("/gallery");
}

// ---------- 뷰 전환 ----------
function showListView() {
  el("listView").classList.remove("hidden");
  el("writeView").classList.add("hidden");
  el("detailView").classList.add("hidden");
  el("galleryView").classList.add("hidden");
  el("adminView").classList.add("hidden");
  const emptyP = el("emptyState").querySelector("p");
  if (emptyP) emptyP.textContent = "아직 게시글이 없어요.";
}
function showWriteView() {
  el("listView").classList.add("hidden");
  el("writeView").classList.remove("hidden");
  el("detailView").classList.add("hidden");
  el("galleryView").classList.add("hidden");
  el("adminView").classList.add("hidden");
  el("writeBoardLabel").textContent = currentBoard ? currentBoard.name : "";
  el("writeViewTitle").textContent = editingPostId ? "글 수정" : "글쓰기";
}
function showDetailView() {
  el("listView").classList.add("hidden");
  el("writeView").classList.add("hidden");
  el("detailView").classList.remove("hidden");
  el("galleryView").classList.add("hidden");
  el("adminView").classList.add("hidden");
}
function showGalleryView() {
  el("listView").classList.add("hidden");
  el("writeView").classList.add("hidden");
  el("detailView").classList.add("hidden");
  el("galleryView").classList.remove("hidden");
  el("adminView").classList.add("hidden");
}
function showAdminView() {
  el("listView").classList.add("hidden");
  el("writeView").classList.add("hidden");
  el("detailView").classList.add("hidden");
  el("galleryView").classList.add("hidden");
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
        await deletePostAndImages(id);
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

// ---------- 글쓰기 임시저장 ----------
// 타이핑하는 동안 브라우저(localStorage)에 조금씩 저장해뒀다가, 실수로 창을 닫아도
// 다시 글쓰기를 열면 복원해줘요. 새 글/수정 글마다 키를 따로 둬요.
let draftSaveTimer = null;
function draftKey() {
  return editingPostId ? `gugu_draft_edit_${editingPostId}` : "gugu_draft_new";
}
function saveDraftNow() {
  const title = el("postTitle").value;
  const content = el("postContent").value;
  try {
    if (!title.trim() && !content.trim()) {
      localStorage.removeItem(draftKey());
      return;
    }
    localStorage.setItem(draftKey(), JSON.stringify({ title, content, savedAt: Date.now() }));
  } catch (e) {}
}
function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraftNow, 800);
}
function clearDraft() {
  try { localStorage.removeItem(draftKey()); } catch (e) {}
}
function restoreDraftIfAny({ silent = false } = {}) {
  try {
    const raw = localStorage.getItem(draftKey());
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d.title && !d.content) return;
    if (!silent && !confirm("임시저장된 내용이 있어요. 불러올까요?")) {
      clearDraft();
      return;
    }
    if (d.title) el("postTitle").value = d.title;
    if (d.content) el("postContent").value = d.content;
  } catch (e) {}
}
el("postTitle").addEventListener("input", scheduleDraftSave);
el("postContent").addEventListener("input", scheduleDraftSave);

el("writeBtn").addEventListener("click", () => {
  editingPostId = null;
  el("postForm").reset();
  resetImageUploadUI();
  showWriteView();
  restoreDraftIfAny({ silent: true }); // 새 글은 조용히 복원(가장 흔한 케이스라 확인창 없이)
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
// delete_url은 나중에 게시글을 지울 때 ImgBB에서도 같이 지우는 용도로 저장해둬요.
// 반환값: { url: 원본(리사이즈된) 이미지, thumbUrl: 목록용 작은 썸네일, deleteUrl: 삭제용 링크 }
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
  const deleteUrl = data.data.delete_url || null;
  return { url, thumbUrl, deleteUrl };
}

function renderImagePreviews() {
  const listEl = el("imagePreviewList");
  listEl.innerHTML = "";
  selectedImageUrls.forEach((url, idx) => {
    const item = document.createElement("div");
    item.className = "image-preview-item";
    item.innerHTML = `${imgWrap(selectedImageThumbUrls[idx] || url, { imgAttrs: 'loading="lazy"' })}<button type="button" class="image-preview-remove" title="삭제">✕</button>`;
    item.querySelector(".image-preview-remove").addEventListener("click", () => {
      tryDeleteImgbbImages([selectedImageDeleteUrls[idx]]); // 미리보기에서 뺀 사진은 이미 올라간 거라 같이 정리
      selectedImageUrls.splice(idx, 1);
      selectedImageThumbUrls.splice(idx, 1);
      selectedImageDeleteUrls.splice(idx, 1);
      renderImagePreviews();
    });
    listEl.appendChild(item);
  });
}

function resetImageUploadUI() {
  selectedImageUrls = [];
  selectedImageThumbUrls = [];
  selectedImageDeleteUrls = [];
  el("postImageFiles").value = "";
  el("imageUploadStatus").classList.add("hidden");
  renderImagePreviews();
}

el("postImageFiles").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  await uploadFilesToPreview(files);
  el("postImageFiles").value = "";
});

// 이미지 파일들을 ImgBB에 올리고 미리보기 목록에 추가해요.
// 파일 선택(change)이랑 스크린샷 붙여넣기(paste) 둘 다 여기로 모아서 처리해요.
async function uploadFilesToPreview(files) {
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
        return { ok: true, url: res.url, thumbUrl: res.thumbUrl, deleteUrl: res.deleteUrl };
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
    selectedImageDeleteUrls.push(r.deleteUrl || null);
  });
  renderImagePreviews();

  if (!hadError) statusEl.classList.add("hidden");
}

// ---------- 스크린샷/사진 붙여넣기(Ctrl+V) ----------
// 글쓰기 칸에 커서를 두고 캡처한 화면을 그대로 붙여넣으면, 파일 선택 없이 바로 업로드돼요.
el("postContent").addEventListener("paste", async (e) => {
  const items = Array.from(e.clipboardData?.items || []);
  const imageFiles = items
    .filter(item => item.kind === "file" && item.type.startsWith("image/"))
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (!imageFiles.length) return; // 이미지가 아니면(일반 텍스트 붙여넣기 등) 원래 동작 그대로 둠
  e.preventDefault(); // 이미지 데이터가 텍스트로 깨져서 붙는 걸 방지
  await uploadFilesToPreview(imageFiles);
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
    const imageDeleteUrls = selectedImageDeleteUrls.slice();

    if (editingPostId) {
      await updateDoc(doc(db, "posts", editingPostId), { title, content, imageUrls, imageThumbUrls, imageDeleteUrls });
      invalidateBoardCache(editingPostBoardId);
      clearDraft();
      const idToReopen = editingPostId;
      editingPostId = null;
      el("postForm").reset();
      resetImageUploadUI();
      openPost(idToReopen);
      return;
    }

    await addDoc(collection(db, "posts"), {
      boardId: currentBoardId,
      title, content, imageUrls, imageThumbUrls, imageDeleteUrls,
      author: currentUser.email.split("@")[0],
      createdAt: serverTimestamp(),
      views: 0,
      isPrivate: !!(currentBoard && currentBoard.isPrivate),
      visibility: getVisibility(currentBoard),
    });
    invalidateBoardCache(currentBoardId);
    clearDraft();
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
      <div class="post-card-preview">${escapeHtml(stripImageMarkers(p.content))}</div>
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

// ---------- 사진 갤러리 (모든 게시글의 사진만 모아서 그리드로 보기) ----------
async function loadGalleryImages() {
  const myToken = ++navToken;
  const gridEl = el("galleryGrid");
  gridEl.innerHTML = `<p class="empty-state">불러오는 중...</p>`;
  el("galleryEmpty").classList.add("hidden");

  const boards = boardRows.filter(r => r.type === "board" && canViewBoard(r));
  const perBoard = await Promise.all(boards.map(async (b) => {
    try {
      const docs = await fetchBoardPosts(b.id);
      return docs.map(docSnap => ({ docSnap }));
    } catch (err) {
      return [];
    }
  }));
  if (myToken !== navToken) return;
  let entries = perBoard.flat();
  entries = sortForBoardList(entries, e => e.docSnap.data());

  const items = [];
  entries.forEach(({ docSnap }) => {
    const p = docSnap.data();
    const images = getImages(p);
    const thumbs = getThumbs(p);
    images.forEach((url, i) => {
      items.push({ url, thumb: thumbs[i] || url, title: p.title, postId: docSnap.id });
    });
  });

  gridEl.innerHTML = "";
  if (!items.length) {
    el("galleryEmpty").classList.remove("hidden");
    return;
  }
  el("galleryEmpty").classList.add("hidden");

  const allUrls = items.map(it => it.url);
  const captions = items.map(it => ({ title: it.title, postId: it.postId }));
  items.forEach((item, i) => {
    const tile = document.createElement("div");
    tile.className = "gallery-tile";
    tile.innerHTML = imgWrap(item.thumb, { wrapClass: "gallery-tile-wrap", imgClass: "gallery-tile-img", imgAttrs: `loading="lazy" decoding="async"` });
    tile.addEventListener("click", () => openLightbox(allUrls, i, captions));
    gridEl.appendChild(tile);
  });
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
    <div class="meta">${escapeHtml(p.author || "익명")} · ${formatDate(p.createdAt)} · 조회 ${p.views || 0}
      ${currentUser ? `<button id="favToggleBtn" class="fav-toggle-btn${favoritePostIds.has(postId) ? " active" : ""}" title="즐겨찾기">${favoritePostIds.has(postId) ? "⭐" : "☆"}</button>` : ""}
    </div>
    <div class="content-text">${renderContentWithImages(p, images)}</div>
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
    <div id="commentsSection" class="comments-section"></div>
  `;
  showDetailView();
  if (!opts.skipUrl) pushUrl(`/board/${postId}`);
  loadComments(postId);

  document.querySelectorAll("#postDetail .detail-img").forEach(imgEl => {
    imgEl.addEventListener("click", () => openLightbox(images, Number(imgEl.dataset.idx)));
  });

  const prevBtn = document.querySelector("#postDetail .post-nav-btn.prev");
  if (prevBtn) prevBtn.addEventListener("click", () => openPost(prevBtn.dataset.id));
  const nextBtn = document.querySelector("#postDetail .post-nav-btn.next");
  if (nextBtn) nextBtn.addEventListener("click", () => openPost(nextBtn.dataset.id));

  if (currentUser) {
    el("favToggleBtn").addEventListener("click", () => toggleFavorite(postId));
  }

  if (isAdmin) {
    el("pinPostBtn").addEventListener("click", async () => {
      await updateDoc(ref, { isPinned: !p.isPinned });
      invalidateBoardCache(p.boardId);
      openPost(postId, { skipUrl: true });
    });

    el("deletePostBtn").addEventListener("click", async () => {
      if (!confirm("이 게시글을 삭제할까요?")) return;
      tryDeleteImgbbImages(p.imageDeleteUrls);
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
      // 예전 글은 imageDeleteUrls가 없을 수 있어서, 사진 개수에 맞춰 null로 채워둬요.
      selectedImageDeleteUrls = images.map((u, i) => (Array.isArray(p.imageDeleteUrls) ? p.imageDeleteUrls[i] : null) || null);
      renderImagePreviews();
      const boardOfPost = boardRows.find(b => b.id === p.boardId);
      currentBoard = boardOfPost || currentBoard;
      showWriteView();
      restoreDraftIfAny(); // 수정 중이던 임시저장본이 있으면 물어보고 복원(원본을 덮어쓰는 거라 확인창 표시)
    });

    el("movePostBtn").addEventListener("click", () => openMoveModal(postId, p.boardId));
  }
  return true;
}

// ---------- 댓글 ----------
async function getMyNickname() {
  if (!currentUser) return "";
  if (isAdmin) return siteConfig.adminNickname || emailToId(currentUser.email);
  try {
    const snap = await getDoc(doc(db, "members", currentUser.uid));
    if (snap.exists() && snap.data().nickname) return snap.data().nickname;
  } catch (e) {}
  return emailToId(currentUser.email);
}

async function loadComments(postId) {
  const section = el("commentsSection");
  const myName = currentUser ? await getMyNickname() : "";
  section.innerHTML = `
    <h3 class="comments-title">💬 댓글</h3>
    <div id="commentsList" class="comments-list"><p class="hint-text">불러오는 중...</p></div>
    ${currentUser
      ? `<form id="commentForm" class="comment-form">
          <textarea id="commentInput" placeholder="${escapeHtml(myName)}(으)로 댓글 남기기" rows="2" maxlength="1000" required></textarea>
          <button type="submit" class="btn btn-ghost btn-sm">등록</button>
        </form>`
      : `<p class="hint-text">댓글을 쓰려면 로그인해주세요.</p>`}
  `;

  try {
    const q = query(collection(db, "comments"), where("postId", "==", postId));
    const snap = await getDocs(q);
    const sortedDocs = snap.docs.slice().sort((a, b) => {
      const ta = a.data().createdAt ? a.data().createdAt.toMillis() : 0;
      const tb = b.data().createdAt ? b.data().createdAt.toMillis() : 0;
      return ta - tb; // 오래된 댓글이 위로
    });
    renderCommentsList(sortedDocs, postId);
  } catch (e) {
    el("commentsList").innerHTML = `<p class="hint-text">댓글을 불러오지 못했어요.</p>`;
  }

  if (currentUser) {
    el("commentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = el("commentInput");
      const content = input.value.trim();
      if (!content) return;
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const nickname = await getMyNickname();
        await addDoc(collection(db, "comments"), {
          postId, authorUid: currentUser.uid, authorName: nickname, content, createdAt: serverTimestamp(),
        });
        input.value = "";
        loadComments(postId);
      } catch (err) {
        alert("댓글 등록 실패: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }
}

function renderCommentsList(docs, postId) {
  const listEl = el("commentsList");
  if (!docs.length) { listEl.innerHTML = `<p class="hint-text">아직 댓글이 없어요.</p>`; return; }
  listEl.innerHTML = docs.map(d => {
    const c = d.data();
    const canDelete = isAdmin || (currentUser && currentUser.uid === c.authorUid);
    return `
      <div class="comment-row">
        <div class="comment-head">
          <span class="comment-author">${escapeHtml(c.authorName || "익명")}</span>
          <span class="comment-date">${formatDate(c.createdAt)}</span>
          ${canDelete ? `<button class="comment-delete-btn" data-id="${d.id}">삭제</button>` : ""}
        </div>
        <div class="comment-body">${escapeHtml(c.content).replace(/\n/g, "<br>")}</div>
      </div>
    `;
  }).join("");
  listEl.querySelectorAll(".comment-delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("댓글을 삭제할까요?")) return;
      await deleteDoc(doc(db, "comments", btn.dataset.id));
      loadComments(postId);
    });
  });
}

// ---------- 닉네임 ----------
el("nicknameBtn").addEventListener("click", async () => {
  if (!currentUser) return;
  const current = await getMyNickname();
  const next = prompt("사용할 닉네임을 입력해주세요 (댓글 등에 표시돼요)", current);
  if (next === null) return; // 취소
  const trimmed = next.trim();
  if (!trimmed) { alert("닉네임을 입력해주세요."); return; }
  if (trimmed.length > 20) { alert("닉네임은 20자 이내로 입력해주세요."); return; }
  try {
    if (isAdmin) {
      // 관리자는 members 문서가 아예 없어서(회원가입으로 만든 계정이 아니라서) 거기 저장할 수 없어요.
      // 대신 관리자 정보가 있는 config/site 문서에 저장해요.
      await updateDoc(doc(db, "config", "site"), { adminNickname: trimmed });
      siteConfig.adminNickname = trimmed;
    } else {
      // setDoc(merge)라서 members 문서가 있으면 그 부분만 수정, 혹시 없으면 새로 만듦
      await setDoc(doc(db, "members", currentUser.uid), { nickname: trimmed }, { merge: true });
    }
    alert("닉네임을 저장했어요!");
  } catch (err) {
    alert("저장 실패: " + err.message);
  }
});

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

let dragSrcIdx = null;

// 관리 목록 여러 곳(게시판/상단메뉴/음악)에서 공통으로 쓰는 드래그 정렬 헬퍼.
// rowEl에 draggable을 붙이고, 다른 행 위에 놓였을 때 onDrop(원래idx, 놓인idx)를 호출해요.
function attachDragReorder(rowEl, idx, listEl, onDrop) {
  rowEl.draggable = true;
  rowEl.addEventListener("dragstart", (e) => {
    dragSrcIdx = idx;
    rowEl.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(idx)); } catch (err) {}
  });
  rowEl.addEventListener("dragend", () => {
    dragSrcIdx = null;
    listEl.querySelectorAll(".manage-row").forEach(r => r.classList.remove("dragging", "drag-over"));
  });
  rowEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    rowEl.classList.add("drag-over");
  });
  rowEl.addEventListener("dragleave", () => rowEl.classList.remove("drag-over"));
  rowEl.addEventListener("drop", (e) => {
    e.preventDefault();
    rowEl.classList.remove("drag-over");
    if (dragSrcIdx === null || dragSrcIdx === idx) return;
    onDrop(dragSrcIdx, idx);
  });
}

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
      <span class="drag-handle" title="끌어서 순서 바꾸기">⠿</span>
      <span class="manage-row-label">${escapeHtml(label)}</span>
      <span class="manage-row-actions">
        ${row.type === "board" ? `<select class="admin-select" data-act="visibility-select">
            <option value="public">🌐 전체공개</option>
            <option value="members">👥 회원공개</option>
            <option value="private">🔒 비공개</option>
          </select>` : ""}
        ${row.type === "board" && getVisibility(row) === "members" ? `<select class="admin-select" data-act="tier-select" title="이 등급 이상만 볼 수 있어요"></select>` : ""}
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
    const tierSel = rowDiv.querySelector('[data-act="tier-select"]');
    if (tierSel) {
      tierSel.innerHTML = `<option value="">제한없음(기본 등급)</option>` +
        memberTiers.map(t => `<option value="${t.id}">${escapeHtml(t.name)} 이상</option>`).join("");
      tierSel.value = row.minTierId || "";
      tierSel.addEventListener("change", async () => {
        await updateDoc(doc(db, "boards", row.id), { minTierId: tierSel.value || null });
        const found = boardRows.find(r => r.id === row.id);
        if (found) found.minTierId = tierSel.value || null;
        invalidateBoardCache(row.id);
      });
    }

    attachDragReorder(rowDiv, idx, listEl, (fromIdx, toIdx) => {
      const reordered = boardRows.slice();
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      reorderAllRows(reordered);
    });

    listEl.appendChild(rowDiv);
  });
}

// 드래그로 순서를 바꾸면, 새로 배치된 순서 그대로 전부 새 order 값을 매겨서 저장해요
// (▲▼는 두 개끼리만 값을 맞바꾸지만, 드래그는 여러 칸을 한 번에 옮기는 거라 전체를 다시 매겨야 해요).
async function reorderAllRows(newRows) {
  await Promise.all(newRows.map((row, i) => updateDoc(doc(db, "boards", row.id), { order: (i + 1) * 10 })));
  await loadBoardConfig();
  renderManageList();
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
function topMenuLinkHtml(item, extraClass) {
  const hasUrl = !!(item.url && item.url.trim());
  const cls = "top-menu-link" + (extraClass ? " " + extraClass : "");
  return hasUrl
    ? `<a class="${cls}" href="${escapeHtml(normalizeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.name)}</a>`
    : `<button type="button" class="${cls}" data-id="${item.id}">${escapeHtml(item.name)}</button>`;
}

function renderTopMenuBar() {
  const bar = el("topMenuBar");
  if (!topMenuItems.length) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }
  bar.classList.remove("hidden");
  const topLevel = topMenuItems.filter(t => !t.parentId);
  bar.innerHTML = topLevel.map(item => {
    const children = topMenuItems.filter(c => c.parentId === item.id);
    if (!children.length) return topMenuLinkHtml(item);
    return `
      <div class="top-menu-group">
        <button type="button" class="top-menu-link top-menu-group-btn">${escapeHtml(item.name)} <span class="top-menu-caret">▾</span></button>
        <div class="top-menu-dropdown">
          ${children.map(c => topMenuLinkHtml(c, "top-menu-dropdown-link")).join("")}
        </div>
      </div>
    `;
  }).join("");

  bar.querySelectorAll("button.top-menu-link[data-id]").forEach(btn => {
    btn.addEventListener("click", () => openTopMenuDetail(btn.dataset.id));
  });
  // 그룹 버튼: 데스크탑은 CSS hover로 열리고, 터치기기는 눌러서 열고 닫을 수 있게 함
  bar.querySelectorAll(".top-menu-group-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const group = btn.closest(".top-menu-group");
      const wasOpen = group.classList.contains("open");
      bar.querySelectorAll(".top-menu-group.open").forEach(g => g.classList.remove("open"));
      if (!wasOpen) group.classList.add("open");
    });
  });
  document.addEventListener("click", () => {
    bar.querySelectorAll(".top-menu-group.open").forEach(g => g.classList.remove("open"));
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
  // 상위 메뉴 선택창: 최상위(부모 없는) 항목만 골라줄 수 있어요(2단계까지만 지원)
  const parentSel = el("topMenuParentSelect");
  const prevValue = parentSel.value;
  parentSel.innerHTML = `<option value="">최상위 메뉴</option>` +
    topMenuItems.filter(t => !t.parentId && t.id !== editingTopMenuId).map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  parentSel.value = prevValue;

  const listEl = el("topMenuList");
  listEl.innerHTML = "";
  topMenuItems.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "manage-row";
    const hasUrl = !!(item.url && item.url.trim());
    const parent = item.parentId ? topMenuItems.find(t => t.id === item.parentId) : null;
    const label = (parent ? `　└ ` : "") + (hasUrl ? "🔗 " : "📝 ") + item.name;
    row.innerHTML = `
      <span class="drag-handle" title="끌어서 순서 바꾸기">⠿</span>
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

    attachDragReorder(row, idx, listEl, (fromIdx, toIdx) => {
      const reordered = topMenuItems.slice();
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      reorderAllTopMenus(reordered);
    });

    listEl.appendChild(row);
  });
}

async function reorderAllTopMenus(newItems) {
  await Promise.all(newItems.map((item, i) => updateDoc(doc(db, "topMenus", item.id), { order: (i + 1) * 10 })));
  await loadTopMenu();
  renderTopMenuAdminList();
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
  const children = topMenuItems.filter(c => c.parentId === item.id);
  const extra = children.length ? `\n(하위 메뉴 ${children.length}개는 최상위 메뉴로 올라가요.)` : "";
  if (!confirm(`"${item.name}" 메뉴를 삭제할까요?${extra}`)) return;
  await Promise.all(children.map(c => updateDoc(doc(db, "topMenus", c.id), { parentId: null })));
  await deleteDoc(doc(db, "topMenus", item.id));
  if (editingTopMenuId === item.id) cancelEditTopMenu();
  await loadTopMenu();
  renderTopMenuAdminList();
}

function startEditTopMenu(item) {
  editingTopMenuId = item.id;
  el("topMenuNameInput").value = item.name || "";
  el("topMenuParentSelect").value = item.parentId || "";
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
  el("topMenuParentSelect").value = "";
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
  const parentId = el("topMenuParentSelect").value || null;
  const url = el("topMenuUrlInput").value.trim();
  const content = el("topMenuContentInput").value.trim();
  const imageUrls = topMenuImageUrls.slice();
  const imageThumbUrls = topMenuImageThumbUrls.slice();
  const btn = el("topMenuSaveBtn");
  if (btn.disabled) return;
  if (parentId && editingTopMenuId && parentId === editingTopMenuId) { alert("메뉴는 자기 자신을 상위 메뉴로 가질 수 없어요."); return; }
  btn.disabled = true;
  try {
    if (editingTopMenuId) {
      await updateDoc(doc(db, "topMenus", editingTopMenuId), { name, parentId, url, content, imageUrls, imageThumbUrls });
    } else {
      await addDoc(collection(db, "topMenus"), { name, parentId, url, content, imageUrls, imageThumbUrls, order: nextTopMenuOrder() });
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
      <span class="drag-handle" title="끌어서 순서 바꾸기">⠿</span>
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

    attachDragReorder(row, idx, listEl, (fromIdx, toIdx) => {
      const reordered = musicTracks.slice();
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved);
      reorderAllMusicTracks(reordered);
    });

    listEl.appendChild(row);
  });
}

async function reorderAllMusicTracks(newTracks) {
  await Promise.all(newTracks.map((t, i) => updateDoc(doc(db, "musicTracks", t.id), { order: (i + 1) * 10 })));
  await loadMusicTracks();
  renderMusicAdminList();
  renderMusicPlaylist();
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
  await Promise.all([...adminSelectedPostIds].map(id => deletePostAndImages(id)));
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
let lightboxCaptions = null; // 갤러리에서 열었을 때만: [{title, postId}, ...] (일반 게시글 상세에서는 null)

function openLightbox(images, idx, captions = null) {
  lightboxImages = images;
  lightboxIndex = idx;
  lightboxCaptions = captions;
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

  const capEl = el("lightboxCaption");
  const cap = lightboxCaptions && lightboxCaptions[lightboxIndex];
  if (cap) {
    capEl.textContent = "📄 " + cap.title;
    capEl.classList.remove("hidden");
  } else {
    capEl.classList.add("hidden");
  }
}
el("lightboxCaption").addEventListener("click", () => {
  const cap = lightboxCaptions && lightboxCaptions[lightboxIndex];
  if (!cap) return;
  closeLightbox();
  openPost(cap.postId);
});
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
// ---------- 이미지 포함 진짜 백업 (zip) ----------
el("backupZipBtn").addEventListener("click", async () => {
  const btn = el("backupZipBtn");
  const statusEl = el("backupZipStatus");
  btn.disabled = true;
  try {
    statusEl.textContent = "게시글을 불러오는 중...";
    const postsSnap = await getDocs(collection(db, "posts"));
    const zip = new JSZip();
    const imgFolder = zip.folder("images");

    const posts = [];
    let done = 0;
    const total = postsSnap.docs.length;
    statusEl.textContent = `이미지 받는 중... (0/${total})`;

    await mapWithConcurrency(postsSnap.docs, 4, async (docSnap) => {
      const data = docSnap.data();
      const images = getImages(data);
      const imageFiles = [];
      for (let i = 0; i < images.length; i++) {
        try {
          const resp = await fetch(images[i]);
          if (!resp.ok) throw new Error("다운로드 실패");
          const blob = await resp.blob();
          const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
          const relPath = `${docSnap.id}/${i}.${ext}`;
          imgFolder.file(relPath, blob);
          imageFiles.push(`images/${relPath}`);
        } catch (e) {
          imageFiles.push(null); // 이 사진은 못 받았어요(원래 링크는 imageUrls에 남아있음)
        }
      }
      posts.push({
        id: docSnap.id,
        boardId: data.boardId,
        title: data.title || "",
        content: data.content || "",
        author: data.author || "",
        imageUrls: images, // 혹시 몰라 원래 링크도 같이 남겨둠(복원 시 파일이 없으면 이거라도 씀)
        imageFiles, // zip 안에서의 실제 파일 경로(복원용)
        views: data.views || 0,
        isPinned: !!data.isPinned,
        visibility: getVisibility(data),
        createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toISOString() : null,
      });
      done++;
      statusEl.textContent = `이미지 받는 중... (${done}/${total})`;
    });

    const manifest = {
      exportedAt: new Date().toISOString(),
      boards: boardRows.map((row) => ({ id: row.id, type: row.type, name: row.name, isPrivate: !!row.isPrivate, visibility: getVisibility(row), order: row.order })),
      posts,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));

    statusEl.textContent = "압축 파일 만드는 중...";
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gugu-backup-full-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.textContent = `완료! 게시글 ${total}개, 이미지 파일까지 포함해서 압축했어요.`;
  } catch (e) {
    statusEl.textContent = "백업 실패: " + e.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- 백업으로 복원 ----------
el("restoreZipInput").addEventListener("change", () => {
  const f = el("restoreZipInput").files[0];
  el("restoreZipFileName").textContent = f ? f.name : "";
  el("restoreZipBtn").disabled = !f;
});

el("restoreZipBtn").addEventListener("click", async () => {
  const file = el("restoreZipInput").files[0];
  if (!file) return;
  if (!confirm(
    "백업 zip 파일로 복원할까요?\n\n" +
    "- 이미 있는 게시판/게시글은 그대로 두고, 없는 것만 새로 만들어요(덮어쓰기 없음)\n" +
    "- 사진은 전부 새로 ImgBB에 다시 올라가서 시간이 걸릴 수 있어요\n" +
    "- 게시글이 많으면 몇 분 걸릴 수 있어요, 끝날 때까지 창을 닫지 말아주세요"
  )) return;

  const btn = el("restoreZipBtn");
  const statusEl = el("restoreZipStatus");
  const logEl = el("restoreZipLog");
  logEl.innerHTML = "";
  btn.disabled = true;

  try {
    statusEl.textContent = "zip 파일 읽는 중...";
    const zip = await JSZip.loadAsync(file);
    const manifestEntry = zip.file("manifest.json");
    if (!manifestEntry) throw new Error("manifest.json이 없는 파일이에요. 이 사이트에서 만든 백업 zip이 맞는지 확인해주세요.");
    const manifest = JSON.parse(await manifestEntry.async("string"));

    // 1) 게시판 복원 (없는 것만)
    statusEl.textContent = "게시판 확인 중...";
    const existingBoardIds = new Set(boardRows.map(r => r.id));
    let boardsCreated = 0;
    for (const b of (manifest.boards || [])) {
      if (existingBoardIds.has(b.id)) continue;
      await setDoc(doc(db, "boards", b.id), {
        type: b.type,
        name: b.name,
        isPrivate: !!b.isPrivate,
        visibility: b.visibility || (b.isPrivate ? "private" : "public"),
        order: b.order || 0,
      });
      boardsCreated++;
    }
    if (boardsCreated) await loadBoardConfig();

    // 2) 게시글 복원 (없는 것만, 사진은 전부 새로 ImgBB에 업로드)
    const posts = manifest.posts || [];
    const total = posts.length;
    let postsCreated = 0, postsSkipped = 0, imagesRestored = 0, imagesFailed = 0, done = 0;

    await mapWithConcurrency(posts, 3, async (p) => {
      done++;
      statusEl.textContent = `게시글 복원 중... (${done}/${total})`;

      const already = await getDoc(doc(db, "posts", p.id)).catch(() => null);
      if (already && already.exists()) { postsSkipped++; return; }

      const imageFiles = Array.isArray(p.imageFiles) ? p.imageFiles : [];
      const newUrls = [], newThumbs = [], newDeleteUrls = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const path = imageFiles[i];
        if (!path) {
          // zip 안에 파일이 없던 사진: 원래 링크라도 있으면 그거라도 살려둠(안 죽었을 수도 있으니)
          if (p.imageUrls && p.imageUrls[i]) { newUrls.push(p.imageUrls[i]); newThumbs.push(p.imageUrls[i]); newDeleteUrls.push(null); }
          continue;
        }
        try {
          const entry = zip.file(path);
          if (!entry) throw new Error("zip 안에 파일이 없어요");
          const blob = await entry.async("blob");
          const upFile = new File([blob], "image.jpg", { type: blob.type || "image/jpeg" });
          const { url, thumbUrl, deleteUrl } = await uploadToImgBB(upFile);
          newUrls.push(url); newThumbs.push(thumbUrl); newDeleteUrls.push(deleteUrl || null);
          imagesRestored++;
        } catch (e) {
          imagesFailed++;
          const row = document.createElement("div");
          row.className = "manage-row";
          row.innerHTML = `<span class="manage-row-label" style="color:var(--accent-rose); font-size:12px;">이미지 복원 실패: "${escapeHtml(p.title || "")}" (${i + 1}번째 사진)</span>`;
          logEl.appendChild(row);
        }
      }

      await setDoc(doc(db, "posts", p.id), {
        boardId: p.boardId,
        title: p.title || "",
        content: p.content || "",
        author: p.author || "",
        imageUrls: newUrls,
        imageThumbUrls: newThumbs,
        imageDeleteUrls: newDeleteUrls,
        views: p.views || 0,
        isPinned: !!p.isPinned,
        visibility: p.visibility || "public",
        isPrivate: p.visibility === "private",
        createdAt: p.createdAt ? new Date(p.createdAt) : serverTimestamp(),
        imagesResized: true,
      });
      postsCreated++;
    });

    invalidateBoardCache();
    statusEl.textContent = `복원 완료! 게시글 ${postsCreated}개 새로 만듦 · ${postsSkipped}개는 이미 있어서 건너뜀 · 이미지 ${imagesRestored}개 복원 · ${imagesFailed}개 실패`;
  } catch (e) {
    statusEl.textContent = "복원 실패: " + e.message;
  } finally {
    btn.disabled = false;
  }
});


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

// ---------- 오프라인 버전 백업 가져오기 ----------
// 오프라인 버전은 사진을 base64(dataURL) 형태로 글 안에 그대로 들고 있어서,
// 그걸 하나씩 ImgBB에 새로 업로드하고 나온 링크로 바꿔서 온라인 Firestore에 저장해요.
function dataUrlToFile(dataUrl, filename) {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

el("offlineImportInput").addEventListener("change", () => {
  const f = el("offlineImportInput").files[0];
  el("offlineImportFileName").textContent = f ? f.name : "";
  el("offlineImportBtn").disabled = !f;
});

el("offlineImportBtn").addEventListener("click", async () => {
  const file = el("offlineImportInput").files[0];
  if (!file) return;
  if (!confirm(
    "오프라인 백업 파일을 이 온라인 사이트로 가져올까요?\n\n" +
    "- 이름이 같은 게시판이 이미 있으면 그 게시판으로 합치고, 없으면 새로 만들어요\n" +
    "- 게시글은 항상 새로 추가돼요 (중복 확인 안 함 - 같은 파일을 두 번 가져오면 글이 두 번 생겨요)\n" +
    "- 사진이 많으면 시간이 좀 걸릴 수 있어요, 끝날 때까지 창을 닫지 말아주세요"
  )) return;

  const btn = el("offlineImportBtn");
  const statusEl = el("offlineImportStatus");
  const logEl = el("offlineImportLog");
  logEl.innerHTML = "";
  btn.disabled = true;

  try {
    statusEl.textContent = "파일 읽는 중...";
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data.posts)) throw new Error("올바른 오프라인 백업 파일이 아니에요.");

    // 1) 게시판: 이름이 같은 게시판이 있으면 그걸 쓰고, 없으면 새로 만들어요.
    statusEl.textContent = "게시판 확인 중...";
    const boardIdMap = new Map();
    for (const b of (data.boards || [])) {
      if (b.type !== "board") continue; // 그룹 제목/구분선은 옮기지 않고, 실제 게시판만 옮겨요
      const existing = boardRows.find(r => r.type === "board" && r.name === b.name);
      if (existing) {
        boardIdMap.set(b.id, existing.id);
      } else {
        const newDoc = await addDoc(collection(db, "boards"), {
          type: "board", name: b.name, isPrivate: false, visibility: "public", order: nextOrder(),
        });
        boardIdMap.set(b.id, newDoc.id);
      }
    }
    await loadBoardConfig();
    renderBoardTree();

    // 2) 게시글: 사진을 하나씩 ImgBB에 새로 올리고, Firestore에 새 글로 추가해요.
    const posts = data.posts;
    const total = posts.length;
    let postsCreated = 0, imagesUploaded = 0, imagesFailed = 0, done = 0;

    await mapWithConcurrency(posts, 3, async (p) => {
      done++;
      statusEl.textContent = `게시글 가져오는 중... (${done}/${total})`;

      const boardId = boardIdMap.get(p.boardId);
      if (!boardId) return; // 옮길 게시판을 못 찾은 글은 건너뜀 (그룹/구분선에 붙어있던 경우 등)

      const images = Array.isArray(p.images) ? p.images : [];
      const newUrls = [], newThumbs = [], newDeleteUrls = [];
      for (let i = 0; i < images.length; i++) {
        try {
          const f2 = dataUrlToFile(images[i], `image-${i}.jpg`);
          const { url, thumbUrl, deleteUrl } = await uploadToImgBB(f2);
          newUrls.push(url); newThumbs.push(thumbUrl); newDeleteUrls.push(deleteUrl || null);
          imagesUploaded++;
        } catch (e) {
          imagesFailed++;
          const row = document.createElement("div");
          row.className = "manage-row";
          row.innerHTML = `<span class="manage-row-label" style="color:var(--accent-rose); font-size:12px;">이미지 업로드 실패: "${escapeHtml(p.title || "")}" (${i + 1}번째 사진)</span>`;
          logEl.appendChild(row);
        }
      }

      await addDoc(collection(db, "posts"), {
        boardId,
        title: p.title || "",
        content: p.content || "",
        author: "",
        imageUrls: newUrls,
        imageThumbUrls: newThumbs,
        imageDeleteUrls: newDeleteUrls,
        views: p.views || 0,
        isPinned: !!p.isPinned,
        visibility: "public",
        isPrivate: false,
        createdAt: p.createdAt ? new Date(p.createdAt) : serverTimestamp(),
        imagesResized: true,
      });
      postsCreated++;
    });

    invalidateBoardCache();
    statusEl.textContent = `가져오기 완료! 게시글 ${postsCreated}개 추가 · 사진 ${imagesUploaded}개 업로드 · ${imagesFailed}개 실패`;
    el("offlineImportInput").value = "";
    el("offlineImportFileName").textContent = "";
    el("offlineImportBtn").disabled = true;
  } catch (e) {
    statusEl.textContent = "가져오기 실패: " + e.message;
  } finally {
    btn.disabled = false;
  }
});

// ---------- 오프라인 버전으로 내보내기 ----------
// 온라인 게시글의 사진(ImgBB 링크)을 전부 다시 다운받아 base64로 바꿔서,
// 오프라인 버전이 그대로 읽을 수 있는 백업 파일 형태로 만들어요.
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

el("exportForOfflineBtn").addEventListener("click", async () => {
  const btn = el("exportForOfflineBtn");
  const statusEl = el("exportForOfflineStatus");
  btn.disabled = true;
  try {
    // 게시판은 실제 게시판만 옮겨요(그룹 제목/구분선 제외). 온라인 문서 id를 그대로 오프라인 쪽 id로 써요.
    const boards = boardRows.filter(r => r.type === "board").map(r => ({ id: r.id, type: "board", name: r.name, order: r.order || 0 }));

    // 사진이 많으면 base64를 전부 합친 문자열이 브라우저가 다룰 수 있는 최대 문자열 길이를
    // 넘어버릴 수 있어요("Invalid string length"). 그래서 JSON.stringify로 한 번에 큰 문자열을
    // 만들지 않고, 게시글별로 작게 나눠서 Blob 조각으로 이어붙여요(브라우저가 내부적으로 처리).
    const blobParts = ['{"exportedAt":' + Date.now() + ',"boards":' + JSON.stringify(boards) + ',"config":[],"posts":['];
    let postCount = 0;
    let done = 0;
    const total = (await getDocs(collection(db, "posts"))).docs;
    statusEl.textContent = `사진 받는 중... (0/${total.length})`;

    await mapWithConcurrency(total, 3, async (docSnap) => {
      const data = docSnap.data();
      const urls = getImages(data);
      const images = [];
      for (const u of urls) {
        try {
          const resp = await fetch(u);
          if (!resp.ok) throw new Error("다운로드 실패");
          const blob = await resp.blob();
          // 오프라인 백업은 사진이 다 base64로 파일 안에 통째로 들어가기 때문에,
          // 원본 화질 그대로 넣으면 파일이 너무 커져서 나중에 오프라인 브라우저가
          // 그 파일을 열다가(JSON.parse) 메모리 부족으로 탭이 죽을 수 있어요.
          // 그래서 여기서 한 번 더 작게 압축해서 넣어요(화면에서 보기엔 충분한 화질).
          const resizedBlob = await resizeImageFile(blob, 1000, 0.72);
          images.push(await blobToDataUrl(resizedBlob));
        } catch (e) {
          // 못 받은 사진은 그냥 빼요(오프라인 파일에 안 들어감)
        }
      }
      const postJson = JSON.stringify({
        id: docSnap.id,
        boardId: data.boardId,
        title: data.title || "",
        content: data.content || "",
        images,
        createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().getTime() : Date.now(),
        views: data.views || 0,
        isPinned: !!data.isPinned,
      });
      blobParts.push((postCount > 0 ? "," : "") + postJson); // 이 push는 await 없이 동기로 일어나서 순서가 꼬이지 않아요
      postCount++;
      done++;
      statusEl.textContent = `사진 받는 중... (${done}/${total.length})`;
    });
    blobParts.push("]}");

    const blob = new Blob(blobParts, { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gugu-offline-import-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.textContent = `완료! 게시글 ${total.length}개로 파일을 만들었어요. 오프라인 버전에서 이 파일로 복원해주세요.`;
  } catch (e) {
    statusEl.textContent = "내보내기 실패: " + e.message;
  } finally {
    btn.disabled = false;
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

// 게시글을 지울 때 ImgBB에 남은 이미지도 같이 지우려고 시도해요.
// ImgBB는 정식 삭제 API가 없어서 업로드 시 받은 delete_url에 접속하는 방식으로만 지울 수 있고,
// 브라우저 CORS 때문에 성공했는지 확인은 못 해요(요청만 보내고 결과는 신경 안 씀).
// 그래서 실패해도 절대 게시글 삭제 자체를 막지 않아요 — 어디까지나 "되면 좋고" 정리예요.
function tryDeleteImgbbImages(deleteUrls) {
  if (!Array.isArray(deleteUrls)) return;
  deleteUrls.forEach(url => {
    if (!url) return;
    fetch(url, { mode: "no-cors" }).catch(() => {});
  });
}

// 게시글 삭제 여러 곳(알림함, 게시글 관리 일괄삭제 등)에서 공통으로 써요.
// 문서를 미리 한 번 읽어서 imageDeleteUrls를 챙긴 다음 지워요.
async function deletePostAndImages(postId) {
  try {
    const snap = await getDoc(doc(db, "posts", postId));
    if (snap.exists()) tryDeleteImgbbImages(snap.data().imageDeleteUrls);
  } catch (e) {}
  await deleteDoc(doc(db, "posts", postId));
}

// 본문 안에 [사진1] 같은 표시가 있으면(채록소 확장프로그램이 자동으로 넣어줌) 그 자리에
// 실제 사진을 끼워 넣어요. 표시가 없거나 번호가 사진 개수를 벗어나면(예: 사진을 나중에 지움)
// 그 사진들은 맨 아래에 몰아서 붙여요.
function renderContentWithImages(p, images) {
  const parts = String(p.content || "").split(/(\[사진\d+\])/g);
  const usedIdx = new Set();
  let html = "";
  parts.forEach(part => {
    const m = part.match(/^\[사진(\d+)\]$/);
    if (m) {
      const idx = Number(m[1]) - 1;
      if (idx >= 0 && idx < images.length && !usedIdx.has(idx)) {
        usedIdx.add(idx);
        html += imgWrap(images[idx], { wrapClass: "detail-wrap", imgClass: "detail-img", imgAttrs: `data-idx="${idx}" loading="lazy" decoding="async"` });
        return;
      }
      // 번호가 유효하지 않으면(사진이 지워졌거나 등) 표시를 그냥 글자로 보여줘요.
    }
    html += escapeHtml(part);
  });

  images.forEach((u, i) => {
    if (usedIdx.has(i)) return;
    html += imgWrap(u, { wrapClass: "detail-wrap", imgClass: "detail-img", imgAttrs: `data-idx="${i}" loading="lazy" decoding="async"` });
  });

  return html;
}

// 목록 미리보기용: [사진N] 표시는 글자로 보여줄 필요 없으니 지워요.
function stripImageMarkers(text) {
  return String(text || "").replace(/\[사진\d+\]/g, " ").replace(/\s{2,}/g, " ").trim();
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
loadMemberTiers().then(() => { if (boardRows.length) renderBoardTree(); });
initMusicPlayer();
loadLiveConfig();

// ---------- PWA: 서비스워커 등록 ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
