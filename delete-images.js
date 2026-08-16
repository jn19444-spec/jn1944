// 게시글을 삭제할 때 Cloudinary에 남은 실제 이미지도 같이 지우기 위한 서버 함수예요.
// Cloudinary는 API Secret이 있어야 삭제가 가능한데, 그 시크릿은 절대 브라우저(app.js)에
// 넣으면 안 돼서(누구나 훔쳐서 계정 이미지를 다 지울 수 있음) 여기 서버에서만 씁니다.
//
// 사이트 본체는 GitHub Pages에 있고 이 함수만 Vercel에 따로 올리는 구조라서,
// 다른 주소(GitHub Pages)에서 요청이 와도 막히지 않도록 CORS를 허용해줘요.
//
// 이 시크릿들은 Vercel 프로젝트의 "환경 변수(Environment Variables)"에 등록해서 쓰세요:
//   - FIREBASE_API_KEY      (firebase-config.js의 apiKey와 동일)
//   - FIREBASE_PROJECT_ID   (firebase-config.js의 projectId와 동일)
//   - CLOUDINARY_CLOUD_NAME (예: uzmdyc7a)
//   - CLOUDINARY_API_KEY    (Cloudinary 대시보드 > Settings > Access Keys)
//   - CLOUDINARY_API_SECRET (Cloudinary 대시보드 > Settings > Access Keys, 절대 공개 금지)

// 사이트 주소가 이거 하나뿐이면 여기에 고정해두는 게 제일 안전해요(다른 사이트가 이 함수를 못 쓰게 막아줌).
const ALLOWED_ORIGIN = "https://jn19444-spec.github.io";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // 브라우저가 본 요청 전에 "이거 보내도 돼?"라고 먼저 물어보는 사전 요청(preflight)이에요.
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용돼요." });
  }

  const { idToken, publicIds } = req.body || {};
  const ids = Array.isArray(publicIds) ? publicIds.filter((id) => typeof id === "string" && id) : [];

  if (!idToken) {
    return res.status(400).json({ error: "로그인 정보(idToken)가 필요해요." });
  }
  if (ids.length === 0) {
    return res.status(200).json({ deleted: {}, skipped: true });
  }

  const {
    FIREBASE_API_KEY,
    FIREBASE_PROJECT_ID,
    CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET,
  } = process.env;

  try {
    // 1) idToken이 진짜 로그인된 사용자 것인지 확인하고 uid를 얻어요.
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );
    const lookupData = await lookupRes.json();
    const uid = lookupData?.users?.[0]?.localId;
    if (!uid) {
      return res.status(401).json({ error: "로그인 정보가 유효하지 않아요." });
    }

    // 2) 사이트의 유일한 관리자(config/site.adminUid)인지 확인해요.
    //    config/site는 firestore.rules에서 누구나 읽을 수 있게 되어있어서 별도 인증 없이 조회 가능해요.
    const siteRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/config/site`
    );
    const siteData = await siteRes.json();
    const adminUid = siteData?.fields?.adminUid?.stringValue;
    if (!adminUid || adminUid !== uid) {
      return res.status(403).json({ error: "관리자만 이미지를 지울 수 있어요." });
    }

    // 3) 실제로 Cloudinary에서 지워요. (Admin API, API Key+Secret 필요)
    const auth = Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString("base64");
    const params = new URLSearchParams();
    ids.forEach((id) => params.append("public_ids[]", id));

    const delRes = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/image/upload?${params.toString()}`,
      {
        method: "DELETE",
        headers: { Authorization: `Basic ${auth}` },
      }
    );
    const delData = await delRes.json();
    return res.status(200).json({ deleted: delData?.deleted || {} });
  } catch (e) {
    return res.status(500).json({ error: e.message || "삭제 중 오류가 발생했어요." });
  }
}
