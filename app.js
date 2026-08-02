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
      // 회원 문서 확인 (없으면 생성)
      const memberRef = doc(db, "members", user.uid);
      const memberSnap = await getDoc(memberRef).catch(() => null);
      if (memberSnap && memberSnap.exists()) {
        canViewPrivate = !!memberSnap.data().canViewPrivate;
      } else {
        await setDoc(memberRef, { email: user.email, joinedAt: serverTimestamp(), canViewPrivate: false }).catch(() => {});
      }
    }
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
    await signInWithEmailAndPassword(auth, email, pw);
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
    await createUserWithEmailAndPassword(auth, email, pw);
    el("signupModal").classList.add("hidden");
    el("signupEmail").value = "";
    el("signupPassword").value = "";
  } catch (e) {
    el("signupError").textContent = "가입 실패: " + (e.code === "auth/email-already-in-use" ? "이미 가입된 이메일이에요." : e.code === "auth/weak-password" ? "비밀번호는 6자 이상이어야 해요." : "입력값을 확인해주세요.");
    el("signupError").classList.remove("hidden");
  }
});

// ---------- 관리자 메뉴 (회원 권한 관리) ----------
el("adminMenuBtn").addEventListener("click", () => {
  el("adminMenuModal").classList.remove("hidden");
  loadMemberList();
});
el("adminMenuCloseBtn").addEventListener("click", () => el("adminMenuModal").classList.add("hidden"));

async function loadMemberList() {
  const listEl = el("memberList");
  listEl.innerHTML = "불러오는 중...";
  const snap = await getDocs(collection(db, "members"));
  if (snap.empty) {
    listEl.innerHTML = `<p class="empty-state">아직 가입한 회원이 없어요.</p>`;
    return;
  }
  listEl.innerHTML = "";
  snap.forEach(docSnap => {
    const m = docSnap.data();
    const row = document.createElement("div");
    row.className = "manage-row";
    row.innerHTML = `
      <span class="manage-row-label">${escapeHtml(m.email || docSnap.id)}</span>
      <label class="checkbox-label">
        <input type="checkbox" ${m.canViewPrivate ? "checked" : ""}> 비공개 게시판 열람 허용
      </label>
    `;
    row.querySelector('input[type="checkbox"]').addEventListener("change", async (e) => {
      await updateDoc(doc(db, "members", docSnap.id), { canViewPrivate: e.target.checked });
    });
    listEl.appendChild(row);
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

el("writeBtn").addEventListener("click", () => {
  editingPostId = null;
  el("postForm").reset();
  showWriteView();
});
el("cancelWriteBtn").addEventListener("click", () => { editingPostId = null; showListView(); });
el("backBtn").addEventListener("click", () => {
  showListView();
  if (currentBoardId === "__all__") loadAllPosts();
  else if (currentBoardId) loadPosts(currentBoardId);
});

// ---------- 글쓰기 / 수정 ----------
el("postForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!isAdmin) return;
  const title = el("postTitle").value.trim();
  const content = el("postContent").value.trim();
  const imageUrls = el("postImages").value.split("\n").map(s => s.trim()).filter(Boolean);

  if (editingPostId) {
    await updateDoc(doc(db, "posts", editingPostId), { title, content, imageUrls });
    const idToReopen = editingPostId;
    editingPostId = null;
    el("postForm").reset();
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
    ${images.map(u => `<img src="${u}" alt="">`).join("")}
    <div class="content-text">${escapeHtml(p.content)}</div>
    ${isAdmin ? `<div class="admin-actions">
      <button id="editPostBtn" class="btn btn-ghost">수정하기</button>
      <button id="movePostBtn" class="btn btn-ghost">게시판 이동</button>
      <button id="deletePostBtn" class="btn btn-ghost">삭제하기</button>
    </div>` : ""}
  `;
  showDetailView();

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
      el("postImages").value = images.join("\n");
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
