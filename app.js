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

// ---------- 게시판 구성 (여기 배열만 수정하면 게시판 추가/삭제 가능) ----------
const BOARD_GROUPS = [
  { group: "티아 전용 공간", items: [
    { id: "letia", name: "🌸 레티아" },
    { id: "ulbo", name: "울보 내새끼 띠아 🧡" },
  ]},
  { group: "버추얼방셀", items: [
    { id: "virtual", name: "버추얼 방셀" },
  ]},
  { group: "방셀", items: [
    { id: "daena", name: "다에나" },
    { id: "aesun", name: "애순이" },
    { id: "bangsel", name: "방셀" },
  ]},
  { group: "개인공간", items: [
    { id: "jujeori", name: "주저리" },
    { id: "private", name: "비공개", isPrivate: true },
    { id: "trash", name: "쓰레기통" },
  ]},
];

let currentUser = null;
let currentBoardId = null;
let currentBoard = null;

const el = (id) => document.getElementById(id);

// ---------- 인증 상태 ----------
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  el("loginBtn").classList.toggle("hidden", !!user);
  el("logoutBtn").classList.toggle("hidden", !user);
  el("whoami").textContent = user ? `관리자로 로그인됨` : "";
  el("writeBtn").classList.toggle("hidden", !(user && currentBoard));
  renderBoardTree();
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

// ---------- 게시판 트리 렌더 ----------
function renderBoardTree() {
  const treeEl = el("boardTree");
  treeEl.innerHTML = "";
  BOARD_GROUPS.forEach(g => {
    const groupDiv = document.createElement("div");
    groupDiv.className = "board-group";
    const title = document.createElement("div");
    title.className = "board-group-title";
    title.textContent = g.group;
    groupDiv.appendChild(title);

    g.items.forEach(item => {
      if (item.isPrivate && !currentUser) return; // 비공개 게시판은 로그인 전엔 목록에서 숨김
      const itemDiv = document.createElement("div");
      itemDiv.className = "board-item" + (item.id === currentBoardId ? " active" : "");
      itemDiv.innerHTML = (item.isPrivate ? '<span class="lock-icon">🔒</span> ' : '') + item.name;
      itemDiv.addEventListener("click", () => selectBoard(item));
      groupDiv.appendChild(itemDiv);
    });
    treeEl.appendChild(groupDiv);
  });
}

function selectBoard(item) {
  currentBoardId = item.id;
  currentBoard = item;
  el("currentBoardName").textContent = item.name.replace("🔒 ", "");
  el("writeBtn").classList.toggle("hidden", !currentUser);
  showListView();
  renderBoardTree();
  loadPosts(item.id);
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
  const imageUrl = el("postImage").value.trim();
  await addDoc(collection(db, "posts"), {
    boardId: currentBoardId,
    title, content, imageUrl: imageUrl || null,
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
  const q = query(collection(db, "posts"), where("boardId", "==", boardId), orderBy("createdAt", "desc"));
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
  snap.forEach(docSnap => {
    const p = docSnap.data();
    const card = document.createElement("div");
    card.className = "post-card";
    card.innerHTML = `
      <div class="post-card-body">
        <div class="post-card-meta">
          <span>${p.author || "익명"}</span>
          <span>·</span>
          <span>${formatDate(p.createdAt)}</span>
        </div>
        <div class="post-card-title">${escapeHtml(p.title)}</div>
        <div class="post-card-preview">${escapeHtml(p.content)}</div>
        <div class="post-card-stats"><span>👁 ${p.views || 0}</span></div>
      </div>
      ${p.imageUrl ? `<img class="post-card-thumb" src="${p.imageUrl}" alt="">` : ""}
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

  el("postDetail").innerHTML = `
    <h1>${escapeHtml(p.title)}</h1>
    <div class="meta">${p.author || "익명"} · ${formatDate(p.createdAt)} · 조회 ${p.views || 0}</div>
    ${p.imageUrl ? `<img src="${p.imageUrl}" alt="">` : ""}
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

// ---------- 유틸 ----------
function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}

renderBoardTree();
