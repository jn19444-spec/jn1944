import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, query, where, orderBy, addDoc, doc,
  deleteDoc, getDocs, getDoc, serverTimestamp, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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
let currentBoardId = null;
let currentBoard = null;
let boardRows = []; // Firestore "boards" 컬렉션의 각 행 (그룹/게시판/구분선)

const el = (id) => document.getElementById(id);

// ---------- 인증 상태 ----------
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  el("loginBtn").classList.toggle("hidden", !!user);
  el("logoutBtn").classList.toggle("hidden", !user);
  el("whoami").textContent = user ? `관리자로 로그인됨` : "";
  el("writeBtn").classList.toggle("hidden", !(user && currentBoard));
  el("manageBoardsBtn").classList.toggle("hidden", !user);
  await loadBoardConfig();
  if (currentBoardId) loadPosts(currentBoardId);
});

el("loginBtn").addEventListener("click", () => el("loginModal").classList.remove("hidden"));
el("loginCancelBtn").addEventListener("click", () => el("loginModal").classList.add("hidden"));
el("logoutBtn").addEventListener("click", () => signOut(auth));

el("loginSubmitBtn").addEventListener("click", async () => {
  const email = el("loginEmail").value.trim();
  const pw = el("loginPassword").value;
  el("loginError").classList.add("hidden");
  try {
    await signInWithEmailAndPassword(auth, email, pw);
    el("loginModal").classList.add("hidden");
    el("loginEmail").value = "";
    el("loginPassword").value = "";
  } catch (e) {
    el("loginError").textContent = "로그인 실패: 이메일/비밀번호를 확인해주세요.";
    el("loginError").classList.remove("hidden");
  }
});

// ---------- 게시판 구성 불러오기 ----------
async function loadBoardConfig() {
  const q = query(collection(db, "boards"), orderBy("order", "asc"));
  const snap = await getDocs(q);

  if (snap.empty) {
    if (currentUser) {
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
    if (row.isPrivate && !currentUser) return; // 비공개 게시판은 로그인 전엔 숨김
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
  el("writeBtn").classList.toggle("hidden", !currentUser);
  showListView();
  renderBoardTree();
  loadPosts(row.id);
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
}
function showDetailView() {
  el("listView").classList.add("hidden");
  el("writeView").classList.add("hidden");
  el("detailView").classList.remove("hidden");
}

el("writeBtn").addEventListener("click", showWriteView);
el("cancelWriteBtn").addEventListener("click", showListView);
el("backBtn").addEventListener("click", () => { showListView(); loadPosts(currentBoardId); });

// ---------- 글쓰기 ----------
el("postForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const title = el("postTitle").value.trim();
  const content = el("postContent").value.trim();
  const imageUrls = el("postImages").value.split("\n").map(s => s.trim()).filter(Boolean);
  await addDoc(collection(db, "posts"), {
    boardId: currentBoardId,
    title, content, imageUrls,
    author: currentUser.email.split("@")[0],
    createdAt: serverTimestamp(),
    views: 0,
  });
  el("postForm").reset();
  showListView();
  loadPosts(currentBoardId);
});

// ---------- 목록 불러오기 ----------
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
  const sortedDocs = snap.docs.slice().sort((a, b) => {
    const ta = a.data().createdAt ? a.data().createdAt.toMillis() : 0;
    const tb = b.data().createdAt ? b.data().createdAt.toMillis() : 0;
    return tb - ta; // 최신순
  });
  sortedDocs.forEach(docSnap => {
    const p = docSnap.data();
    const images = getImages(p);
    const card = document.createElement("div");
    card.className = "post-card";
    card.innerHTML = `
      <div class="post-card-body">
        <div class="post-card-meta">
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
    listEl.appendChild(card);
  });
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
    ${images.map(u => `<img src="${u}" alt="">`).join("")}
    <div class="content-text">${escapeHtml(p.content)}</div>
    ${currentUser ? `<div class="admin-actions">
      <button id="deletePostBtn" class="btn btn-ghost">삭제하기</button>
    </div>` : ""}
  `;
  showDetailView();

  if (currentUser) {
    el("deletePostBtn").addEventListener("click", async () => {
      if (!confirm("이 게시글을 삭제할까요?")) return;
      await deleteDoc(ref);
      showListView();
      loadPosts(currentBoardId);
    });
  }
}

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
        <button data-act="up" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button data-act="down" ${idx === boardRows.length - 1 ? "disabled" : ""}>▼</button>
        <button data-act="del" class="danger">삭제</button>
      </span>
    `;
    rowDiv.querySelector('[data-act="up"]').addEventListener("click", () => moveRow(idx, -1));
    rowDiv.querySelector('[data-act="down"]').addEventListener("click", () => moveRow(idx, 1));
    rowDiv.querySelector('[data-act="del"]').addEventListener("click", () => deleteRow(row));
    listEl.appendChild(rowDiv);
  });
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

// ---------- 유틸 ----------
function getImages(p) {
  if (Array.isArray(p.imageUrls) && p.imageUrls.length) return p.imageUrls;
  if (p.imageUrl) return [p.imageUrl];
  return [];
}

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

renderBoardTree();
