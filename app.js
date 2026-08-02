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

let currentUser = null;
let isAdmin = false;
let canViewPrivate = false; // 회원이 비공개 게시판 열람 권한을 받았는지
let currentBoardId = null;
let currentBoard = null;
let boardRows = []; // Firestore "boards" 컬렉션의 각 행 (그룹/게시판/구분선)
let editingPostId = null; // null이면 새 글쓰기, 값이 있으면 그 글을 수정하는 중
let selectedImageUrls = []; // 글쓰기 폼에서 업로드된(또는 기존) 이미지 URL 목록

const el = (id) => document.getElementById(id);

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
  el("whoami").textContent = isAdmin ? "관리자로 로그인됨" : (user ? `회원으로 로그인됨 (${user.email})` : "");
  el("writeBtn").classList.toggle("hidden", !(isAdmin && currentBoard));
  el("manageBoardsBtn").classList.toggle("hidden", !isAdmin);

  await loadBoardConfig();
  if (currentBoardId === "__all__") loadAllPosts();
  else if (currentBoardId) loadPosts(currentBoardId);
});

el("loginBtn").addEventListener("click", () => el("loginModal").classList.remove("hidden"));
el("loginCancelBtn").addEventListener("click", () => el("loginModal").classList.add("hidden"));
el("logoutBtn").addEventListener("click", () => signOut(auth));

el("loginSubmitBtn").addEventListener("click", async () => {
  const email = el("loginEmail").value.trim();
  const pw = el("loginPassword").value;
  el("loginError").classList.add("hidden");
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pw);

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
    el("loginError").textContent = "로그인 실패: 이메일/비밀번호를 확인해주세요.";
    el("loginError").classList.remove("hidden");
  }
});

el("signupBtn").addEventListener("click", () => el("signupModal").classList.remove("hidden"));
el("signupCancelBtn").addEventListener("click", () => el("signupModal").classList.add("hidden"));

el("signupSubmitBtn").addEventListener("click", async () => {
  const email = el("signupEmail").value.trim();
  const pw = el("signupPassword").value;
  el("signupError").classList.add("hidden");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    // 회원 문서를 승인 대기 상태로 생성하고, 바로 로그아웃시켜서
    // 관리자가 승인하기 전까지는 로그인해도 다시 튕겨나가게 해요.
    await setDoc(doc(db, "members", cred.user.uid), {
      email: cred.user.email,
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
    el("signupError").textContent = "가입 실패: " + (e.code === "auth/email-already-in-use" ? "이미 가입된 이메일이에요." : e.code === "auth/weak-password" ? "비밀번호는 6자 이상이어야 해요." : "입력값을 확인해주세요.");
    el("signupError").classList.remove("hidden");
  }
});

// ---------- 관리자 메뉴 ----------
el("adminMenuBtn").addEventListener("click", () => {
  el("adminMenuModal").classList.remove("hidden");
  refreshPendingBadge();
  el("migrateStatus").textContent = "";
  el("migrateLog").innerHTML = "";
});
el("adminMenuCloseBtn").addEventListener("click", () => el("adminMenuModal").classList.add("hidden"));

// ---------- 회원 관리 (승인/차단/삭제) ----------
el("openMemberManageBtn").addEventListener("click", () => {
  el("adminMenuModal").classList.add("hidden");
  el("memberManageModal").classList.remove("hidden");
  loadMemberList();
});
el("memberManageCloseBtn").addEventListener("click", () => el("memberManageModal").classList.add("hidden"));

el("migrateImagesBtn").addEventListener("click", migrateAllImages);

async function migrateAllImages() {
  const statusEl = el("migrateStatus");
  const logEl = el("migrateLog");
  const btn = el("migrateImagesBtn");
  logEl.innerHTML = "";
  btn.disabled = true;
  statusEl.textContent = "게시글을 불러오는 중...";

  const snap = await getDocs(collection(db, "posts"));
  const posts = snap.docs;
  let postsChanged = 0, imagesMigrated = 0, imagesFailed = 0;

  for (let i = 0; i < posts.length; i++) {
    const docSnap = posts[i];
    const p = docSnap.data();
    const images = getImages(p);
    if (!images.length) continue;
    statusEl.textContent = `처리 중... (${i + 1}/${posts.length}) "${p.title || ""}"`;

    const newUrls = [];
    let changed = false;
    for (const url of images) {
      if (url.includes("ibb.co")) { newUrls.push(url); continue; } // 이미 옮겨진 이미지는 건너뜀
      try {
        const resp = await fetch(url, { mode: "cors" });
        if (!resp.ok) throw new Error("이미지를 가져오지 못함");
        const blob = await resp.blob();
        const file = new File([blob], "image.jpg", { type: blob.type || "image/jpeg" });
        const newUrl = await uploadToImgBB(file);
        newUrls.push(newUrl);
        changed = true;
        imagesMigrated++;
      } catch (err) {
        newUrls.push(url); // 실패하면 원래 링크를 그대로 유지
        imagesFailed++;
        const row = document.createElement("div");
        row.className = "manage-row";
        row.innerHTML = `<span class="manage-row-label" style="color:var(--accent-rose); font-size:12px;">실패: "${escapeHtml(p.title || "")}" → ${escapeHtml(url)}</span>`;
        logEl.appendChild(row);
      }
    }
    if (changed) {
      await updateDoc(docSnap.ref, { imageUrls: newUrls });
      postsChanged++;
    }
  }

  btn.disabled = false;
  statusEl.textContent = `완료! 게시글 ${postsChanged}개 업데이트 · 이미지 ${imagesMigrated}개 성공 · ${imagesFailed}개 실패` +
    (imagesFailed ? " (실패한 이미지는 아래 목록을 참고해서 직접 다운받아 수정하기 화면에서 다시 올려주세요)" : "");
}

async function loadMemberList() {
  const listEl = el("memberList");
  listEl.innerHTML = "불러오는 중...";
  const snap = await getDocs(collection(db, "members"));
  if (snap.empty) {
    listEl.innerHTML = `<p class="empty-state">아직 가입한 회원이 없어요.</p>`;
    updatePendingBadge(0);
    return;
  }

  let members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // 승인 대기 회원을 위로, 그다음 최근 가입순
  members.sort((a, b) => {
    const aPending = a.approved === false ? 0 : 1;
    const bPending = b.approved === false ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    const at = a.joinedAt && a.joinedAt.toDate ? a.joinedAt.toDate().getTime() : 0;
    const bt = b.joinedAt && b.joinedAt.toDate ? b.joinedAt.toDate().getTime() : 0;
    return bt - at;
  });
  updatePendingBadge(members.filter(m => m.approved === false).length);

  listEl.innerHTML = "";
  members.forEach(m => {
    const approved = m.approved !== false;
    const row = document.createElement("div");
    row.className = "manage-row";
    row.innerHTML = `
      <div class="member-row-info">
        <span class="member-row-email">${escapeHtml(m.email || m.id)}</span>
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
        if (!confirm(`"${m.email || m.id}" 회원의 접근을 차단할까요?\n다시 승인하기 전까지 로그인할 수 없어요.`)) return;
        await updateDoc(doc(db, "members", m.id), { approved: false });
        loadMemberList();
      });
    }

    row.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      if (!confirm(`"${m.email || m.id}" 회원을 삭제할까요?\n삭제하면 이 계정으로 다시 로그인할 수 없어요.\n(같은 이메일로 재가입도 안 돼요 - 완전히 계정을 없애려면 Firebase 콘솔에서 지워야 해요.)`)) return;
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
    if (row.isPrivate && !(isAdmin || canViewPrivate)) return; // 비공개 게시판은 권한 없으면 숨김
    const itemDiv = document.createElement("div");
    itemDiv.className = "board-item" + (row.id === currentBoardId ? " active" : "");
    itemDiv.innerHTML = (row.isPrivate ? '<span class="lock-icon">🔒</span> ' : '') + escapeHtml(row.name);
    itemDiv.addEventListener("click", () => selectBoard(row));
    treeEl.appendChild(itemDiv);
  });
}

function selectBoard(row) {
  currentBoardId = row.id;
  currentBoard = row;
  el("currentBoardName").textContent = row.name;
  el("writeBtn").classList.toggle("hidden", !isAdmin);
  showListView();
  renderBoardTree();
  loadPosts(row.id);
}

function selectAllBoards() {
  currentBoardId = "__all__";
  currentBoard = null;
  el("currentBoardName").textContent = "📋 전체 게시판";
  el("writeBtn").classList.add("hidden"); // 전체 게시판에서는 글쓰기 불가(게시판을 골라야 함)
  showListView();
  renderBoardTree();
  loadAllPosts();
}

// ---------- 뷰 전환 ----------
function showListView() {
  el("listView").classList.remove("hidden");
  el("writeView").classList.add("hidden");
  el("detailView").classList.add("hidden");
}
function showWriteView() {
  el("listView").classList.add("hidden");
  el("writeView").classList.remove("hidden");
  el("detailView").classList.add("hidden");
  el("writeBoardLabel").textContent = currentBoard ? currentBoard.name : "";
  el("writeViewTitle").textContent = editingPostId ? "글 수정" : "글쓰기";
}
function showDetailView() {
  el("listView").classList.add("hidden");
  el("writeView").classList.add("hidden");
  el("detailView").classList.remove("hidden");
}

el("homeBtn").addEventListener("click", () => {
  currentBoardId = null;
  currentBoard = null;
  editingPostId = null;
  el("currentBoardName").textContent = "게시판을 선택하세요";
  el("writeBtn").classList.add("hidden");
  el("postList").innerHTML = "";
  el("emptyState").classList.add("hidden");
  showListView();
  renderBoardTree();
});

// ---------- 검색 ----------
el("searchBtn").addEventListener("click", performSearch);
el("searchInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") performSearch();
});

async function performSearch() {
  const keyword = el("searchInput").value.trim();
  if (!keyword) return;

  currentBoardId = "__search__";
  currentBoard = null;
  editingPostId = null;
  el("currentBoardName").textContent = `🔍 검색 결과: "${keyword}"`;
  el("writeBtn").classList.add("hidden");
  showListView();
  renderBoardTree();

  const listEl = el("postList");
  listEl.innerHTML = "";
  el("emptyState").classList.add("hidden");

  const boards = boardRows.filter(r => r.type === "board" && (!r.isPrivate || isAdmin || canViewPrivate));
  const lower = keyword.toLowerCase();
  let entries = [];
  for (const b of boards) {
    const q = query(collection(db, "posts"), where("boardId", "==", b.id));
    try {
      const snap = await getDocs(q);
      snap.forEach(docSnap => {
        const d = docSnap.data();
        const hit = (d.title || "").toLowerCase().includes(lower) || (d.content || "").toLowerCase().includes(lower);
        if (hit) entries.push({ docSnap, boardName: b.name });
      });
    } catch (err) {
      // 개별 게시판 조회 실패는 건너뛰고 계속 진행
    }
  }
  if (!entries.length) {
    el("emptyState").classList.remove("hidden");
    return;
  }
  entries = sortByDateDesc(entries, e => e.docSnap.data());
  entries.forEach(({ docSnap, boardName }) => listEl.appendChild(renderPostCard(docSnap, { boardName })));
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
  if (currentBoardId === "__all__") loadAllPosts();
  else if (currentBoardId) loadPosts(currentBoardId);
});

// ---------- 이미지 업로드 (ImgBB) ----------
async function uploadToImgBB(file) {
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message || "업로드 실패");
  return data.data.url;
}

function renderImagePreviews() {
  const listEl = el("imagePreviewList");
  listEl.innerHTML = "";
  selectedImageUrls.forEach((url, idx) => {
    const item = document.createElement("div");
    item.className = "image-preview-item";
    item.innerHTML = `<img src="${url}" alt=""><button type="button" class="image-preview-remove" title="삭제">✕</button>`;
    item.querySelector(".image-preview-remove").addEventListener("click", () => {
      selectedImageUrls.splice(idx, 1);
      renderImagePreviews();
    });
    listEl.appendChild(item);
  });
}

function resetImageUploadUI() {
  selectedImageUrls = [];
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
  for (const file of files) {
    try {
      const url = await uploadToImgBB(file);
      selectedImageUrls.push(url);
      renderImagePreviews();
    } catch (err) {
      statusEl.classList.add("error");
      statusEl.textContent = `업로드 실패: ${err.message}`;
    }
    done++;
    if (!statusEl.classList.contains("error")) {
      statusEl.textContent = `이미지 업로드 중... (${done}/${files.length})`;
    }
  }
  if (!statusEl.classList.contains("error")) {
    statusEl.classList.add("hidden");
  }
  el("postImageFiles").value = "";
});

// ---------- 글쓰기 / 수정 ----------
el("postForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin) return;
  const title = el("postTitle").value.trim();
  const content = el("postContent").value.trim();
  const imageUrls = selectedImageUrls.slice();

  if (editingPostId) {
    await updateDoc(doc(db, "posts", editingPostId), { title, content, imageUrls });
    const idToReopen = editingPostId;
    editingPostId = null;
    el("postForm").reset();
    resetImageUploadUI();
    openPost(idToReopen);
    return;
  }

  await addDoc(collection(db, "posts"), {
    boardId: currentBoardId,
    title, content, imageUrls,
    author: currentUser.email.split("@")[0],
    createdAt: serverTimestamp(),
    views: 0,
    isPrivate: !!(currentBoard && currentBoard.isPrivate),
  });
  el("postForm").reset();
  resetImageUploadUI();
  showListView();
  loadPosts(currentBoardId);
});

function renderPostCard(docSnap, opts) {
  const p = docSnap.data();
  const images = getImages(p);
  const card = document.createElement("div");
  card.className = "post-card";
  card.innerHTML = `
    <div class="post-card-body">
      <div class="post-card-meta">
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
        <img class="post-card-thumb" src="${images[0]}" alt="">
        ${images.length > 1 ? `<span class="thumb-count">${images.length}</span>` : ""}
      </div>` : ""}
  `;
  card.addEventListener("click", () => openPost(docSnap.id));
  return card;
}

function sortByDateDesc(docs, getData) {
  return docs.slice().sort((a, b) => {
    const ta = getData(a).createdAt ? getData(a).createdAt.toMillis() : 0;
    const tb = getData(b).createdAt ? getData(b).createdAt.toMillis() : 0;
    return tb - ta;
  });
}

// ---------- 목록 불러오기 (게시판 1개) ----------
async function loadPosts(boardId) {
  const listEl = el("postList");
  listEl.innerHTML = "";
  const q = query(collection(db, "posts"), where("boardId", "==", boardId));
  let snap;
  try {
    snap = await getDocs(q);
  } catch (err) {
    listEl.innerHTML = `<p class="empty-state">게시글을 불러오지 못했어요. (${err.code || err.message})</p>`;
    return;
  }
  if (snap.empty) {
    el("emptyState").classList.remove("hidden");
    return;
  }
  el("emptyState").classList.add("hidden");
  const sortedDocs = sortByDateDesc(snap.docs, d => d.data());
  sortedDocs.forEach(docSnap => listEl.appendChild(renderPostCard(docSnap)));
}

// ---------- 목록 불러오기 (전체 게시판) ----------
async function loadAllPosts() {
  const listEl = el("postList");
  listEl.innerHTML = "";
  const boards = boardRows.filter(r => r.type === "board" && (!r.isPrivate || isAdmin || canViewPrivate));
  let entries = [];
  for (const b of boards) {
    const q = query(collection(db, "posts"), where("boardId", "==", b.id));
    try {
      const snap = await getDocs(q);
      snap.forEach(docSnap => entries.push({ docSnap, boardName: b.name }));
    } catch (err) {
      // 개별 게시판 조회 실패는 건너뛰고 나머지는 계속 보여줌
    }
  }
  if (!entries.length) {
    el("emptyState").classList.remove("hidden");
    return;
  }
  el("emptyState").classList.add("hidden");
  entries = sortByDateDesc(entries, e => e.docSnap.data());
  entries.forEach(({ docSnap, boardName }) => listEl.appendChild(renderPostCard(docSnap, { boardName })));
}

// ---------- 상세보기 ----------
async function openPost(postId) {
  const ref = doc(db, "posts", postId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const p = snap.data();
  updateDoc(ref, { views: increment(1) }).catch(() => {});

  const images = getImages(p);
  el("postDetail").innerHTML = `
    <h1>${escapeHtml(p.title)}</h1>
    <div class="meta">${escapeHtml(p.author || "익명")} · ${formatDate(p.createdAt)} · 조회 ${p.views || 0}</div>
    ${images.map((u, i) => `<img src="${u}" alt="" class="detail-img" data-idx="${i}">`).join("")}
    <div class="content-text">${escapeHtml(p.content)}</div>
    ${isAdmin ? `<div class="admin-actions">
      <button id="editPostBtn" class="btn btn-ghost">수정하기</button>
      <button id="movePostBtn" class="btn btn-ghost">게시판 이동</button>
      <button id="deletePostBtn" class="btn btn-ghost">삭제하기</button>
    </div>` : ""}
  `;
  showDetailView();

  document.querySelectorAll("#postDetail .detail-img").forEach(imgEl => {
    imgEl.addEventListener("click", () => openLightbox(images, Number(imgEl.dataset.idx)));
  });

  if (isAdmin) {
    el("deletePostBtn").addEventListener("click", async () => {
      if (!confirm("이 게시글을 삭제할까요?")) return;
      await deleteDoc(ref);
      showListView();
      if (currentBoardId === "__all__") loadAllPosts(); else loadPosts(currentBoardId);
    });

    el("editPostBtn").addEventListener("click", () => {
      editingPostId = postId;
      el("postTitle").value = p.title || "";
      el("postContent").value = p.content || "";
      selectedImageUrls = images.slice();
      renderImagePreviews();
      const boardOfPost = boardRows.find(b => b.id === p.boardId);
      currentBoard = boardOfPost || currentBoard;
      showWriteView();
    });

    el("movePostBtn").addEventListener("click", () => openMoveModal(postId, p.boardId));
  }
}

// ---------- 게시글 이동 ----------
function openMoveModal(postId, currentPostBoardId) {
  const sel = el("moveBoardSelect");
  sel.innerHTML = "";
  boardRows.filter(r => r.type === "board").forEach(b => {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = (b.isPrivate ? "🔒 " : "") + b.name;
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
    });
    el("moveModal").classList.add("hidden");
    openPost(postId);
  };
}
el("moveCancelBtn").addEventListener("click", () => el("moveModal").classList.add("hidden"));

// ---------- 게시판 관리 패널 ----------
el("manageBoardsBtn").addEventListener("click", () => {
  el("manageModal").classList.remove("hidden");
  renderManageList();
});
el("manageCloseBtn").addEventListener("click", () => el("manageModal").classList.add("hidden"));

el("manageAddBoardBtn").addEventListener("click", async () => {
  const name = el("manageNameInput").value.trim();
  if (!name) return;
  const isPrivate = el("managePrivateCheck").checked;
  await addDoc(collection(db, "boards"), { type: "board", name, isPrivate, order: nextOrder() });
  el("manageNameInput").value = "";
  el("managePrivateCheck").checked = false;
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
      (row.isPrivate ? "🔒 " : "📄 ") + row.name;

    rowDiv.innerHTML = `
      <span class="manage-row-label">${escapeHtml(label)}</span>
      <span class="manage-row-actions">
        ${row.type === "board" ? `<button data-act="toggle-private">${row.isPrivate ? "공개로 전환" : "비공개로 전환"}</button>` : ""}
        <button data-act="up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button data-act="down" ${idx === boardRows.length - 1 ? "disabled" : ""}>▼</button>
        <button data-act="del" class="danger">삭제</button>
      </span>
    `;
    rowDiv.querySelector('[data-act="up"]').addEventListener("click", () => moveRow(idx, -1));
    rowDiv.querySelector('[data-act="down"]').addEventListener("click", () => moveRow(idx, 1));
    rowDiv.querySelector('[data-act="del"]').addEventListener("click", () => deleteRow(row));
    if (row.type === "board") {
      rowDiv.querySelector('[data-act="toggle-private"]').addEventListener("click", () => togglePrivate(row));
    }
    listEl.appendChild(rowDiv);
  });
}

async function togglePrivate(row) {
  const newVal = !row.isPrivate;
  const msg = newVal
    ? `"${row.name}" 게시판을 비공개로 바꿀까요? 이 게시판의 글도 모두 비공개로 바뀌어요.`
    : `"${row.name}" 게시판을 공개로 바꿀까요? 이 게시판의 글도 모두 공개로 바뀌어요.`;
  if (!confirm(msg)) return;
  await updateDoc(doc(db, "boards", row.id), { isPrivate: newVal });
  const postsSnap = await getDocs(query(collection(db, "posts"), where("boardId", "==", row.id)));
  for (const p of postsSnap.docs) {
    await updateDoc(p.ref, { isPrivate: newVal });
  }
  await loadBoardConfig();
  renderManageList();
}

async function moveRow(idx, dir) {
  const otherIdx = idx + dir;
  if (otherIdx < 0 || otherIdx >= boardRows.length) return;
  const a = boardRows[idx];
  const b = boardRows[otherIdx];
  const orderA = a.order, orderB = b.order;
  await updateDoc(doc(db, "boards", a.id), { order: orderB });
  await updateDoc(doc(db, "boards", b.id), { order: orderA });
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
    for (const p of postsSnap.docs) {
      await deleteDoc(p.ref);
    }
    if (currentBoardId === row.id) {
      currentBoardId = null;
      currentBoard = null;
      el("currentBoardName").textContent = "게시판을 선택하세요";
      el("writeBtn").classList.add("hidden");
      el("postList").innerHTML = "";
    }
  }
  await deleteDoc(doc(db, "boards", row.id));
  await loadBoardConfig();
  renderManageList();
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
  el("lightboxImg").src = lightboxImages[lightboxIndex];
  const multi = lightboxImages.length > 1;
  el("lightboxPrev").classList.toggle("hidden", !multi);
  el("lightboxNext").classList.toggle("hidden", !multi);
}
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
        createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toISOString() : null,
      };
    });
    const backup = {
      exportedAt: new Date().toISOString(),
      boards: boardRows.map(({ id, type, name, isPrivate, order }) => ({ id, type, name, isPrivate: !!isPrivate, order })),
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

// ---------- 플레이리스트 ----------
el("playlistBtn").addEventListener("click", () => {
  const panel = el("playlistPanel");
  const willOpen = panel.classList.contains("hidden");
  panel.classList.toggle("hidden");
  if (willOpen) loadPlaylist();
});
el("playlistCloseBtn").addEventListener("click", () => el("playlistPanel").classList.add("hidden"));
document.addEventListener("click", (e) => {
  const panel = el("playlistPanel");
  if (panel.classList.contains("hidden")) return;
  if (panel.contains(e.target) || e.target === el("playlistBtn")) return;
  panel.classList.add("hidden");
});

async function loadPlaylist() {
  el("playlistAddRow").classList.toggle("hidden", !isAdmin);
  const listEl = el("playlistList");
  listEl.innerHTML = "불러오는 중...";
  const snap = await getDocs(query(collection(db, "playlist"), orderBy("order", "asc"))).catch(() => null);
  if (!snap || snap.empty) {
    listEl.innerHTML = `<p class="playlist-empty">아직 추가된 노래가 없어요.</p>`;
    return;
  }
  listEl.innerHTML = "";
  snap.forEach(docSnap => {
    const p = docSnap.data();
    const item = document.createElement("div");
    item.className = "playlist-item";
    item.innerHTML = `
      <a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">🎵 ${escapeHtml(p.title || p.url)}</a>
      ${isAdmin ? `<button data-act="del" title="삭제">✕</button>` : ""}
    `;
    if (isAdmin) {
      item.querySelector('[data-act="del"]').addEventListener("click", async () => {
        if (!confirm(`"${p.title || p.url}"을(를) 목록에서 지울까요?`)) return;
        await deleteDoc(docSnap.ref);
        loadPlaylist();
      });
    }
    listEl.appendChild(item);
  });
}

el("playlistAddBtn").addEventListener("click", addPlaylistItem);
[el("playlistTitleInput"), el("playlistUrlInput")].forEach(inp => {
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") addPlaylistItem(); });
});

async function addPlaylistItem() {
  const title = el("playlistTitleInput").value.trim();
  let url = el("playlistUrlInput").value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url; // 프로토콜 빠뜨려도 알아서 붙여줌
  await addDoc(collection(db, "playlist"), { title, url, order: Date.now(), addedAt: serverTimestamp() });
  el("playlistTitleInput").value = "";
  el("playlistUrlInput").value = "";
  loadPlaylist();
}

// ---------- 유틸 ----------
function getImages(p) {
  if (Array.isArray(p.imageUrls) && p.imageUrls.length) return p.imageUrls;
  if (p.imageUrl) return [p.imageUrl];
  return [];
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
