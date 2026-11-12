import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const CATS = ["学内・設備", "学食・お店", "授業・勉強", "通学・生活", "欲しいもの", "その他"];
const SAMPLE = [
  { id: "s1", text: "空きコマが微妙に長いけど、大学の近くで1時間だけ使える安い休憩スペースがあったらいいなと思う。", cat: "学内・設備", at: Date.now() - 36e5 * 3, n: 7 },
  { id: "s2", text: "学食のメニュー、前日に分かるようにしてほしい。行ってから売り切れに気づくのがつらい。", cat: "学食・お店", at: Date.now() - 36e5 * 20, n: 12 },
  { id: "s3", text: "雨の日のバス停、屋根が足りなくて濡れる。並ぶ場所だけでも屋根が欲しい。", cat: "通学・生活", at: Date.now() - 36e5 * 30, n: 5 },
  { id: "s4", text: "猫とだらだらしてる時に、スマホなしで一瞬を撮れる小さいカメラが欲しい。", cat: "欲しいもの", at: Date.now() - 36e5 * 50, n: 3 }
];

const $ = (id) => document.getElementById(id);
const S = { mode: "loading", uid: null, posts: [], cat: CATS[0], anon: true, filter: "すべて", sort: "new", local: null, reported: new Set() };
let api = null;

/* ---------- helpers ---------- */
function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast._); toast._ = setTimeout(() => (t.hidden = true), 2400); }
function status(m, kind) { const s = $("status"); if (!m) { s.hidden = true; return; } s.textContent = m; s.dataset.kind = kind || ""; s.hidden = false; }
function ago(t) {
  const m = Math.floor((Date.now() - t) / 6e4);
  if (m < 1) return "今"; if (m < 60) return m + "分"; const h = Math.floor(m / 60);
  if (h < 24) return h + "時間"; const d = Math.floor(h / 24); if (d < 7) return d + "日";
  const x = new Date(t); return (x.getMonth() + 1) + "/" + x.getDate();
}
function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function avatar(el, name, seed) {
  el.className = "av"; el.textContent = "";
  if (!name) { el.classList.add("av-anon"); return; }
  el.textContent = [...name][0];
  el.style.background = "var(--av-" + (1 + (hash(seed || name) % 5)) + ")";
}

/* ---------- compose sheet ---------- */
let lastFocus = null;
function openCompose() {
  lastFocus = document.activeElement;
  $("composeView").hidden = false; document.body.style.overflow = "hidden";
  setTimeout(() => ta.focus(), 50);
}
function closeCompose() {
  if (recOn && rec) rec.abort();
  $("composeView").hidden = true; document.body.style.overflow = "";
  lastFocus?.focus?.();
}
$("openCompose").onclick = openCompose;
$("openCompose2").onclick = openCompose;
$("cancel").onclick = closeCompose;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("composeView").hidden) closeCompose(); });

function chips(el, list, cur, on) {
  el.innerHTML = "";
  for (const c of list) { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = c; b.setAttribute("aria-pressed", c === cur); b.onclick = () => on(c); el.appendChild(b); }
}
function renderCats() { chips($("catChips"), CATS, S.cat, (c) => { S.cat = c; renderCats(); }); }
renderCats();

const ta = $("text");
const nick = $("nick");
nick.value = store("voiceup-nick") || "";
function autosize() { ta.style.height = "auto"; ta.style.height = Math.max(72, ta.scrollHeight) + "px"; }
function syncDraft() {
  $("cnt").textContent = ta.value.length;
  const nm = S.anon ? "" : nick.value.trim();
  $("draftName").textContent = nm || (S.anon ? "匿名" : "ニックネーム未入力");
  $("footWho").textContent = S.anon ? "匿名で投稿されます" : (nm ? nm + " として投稿" : "ニックネームを入れてね");
  avatar($("draftAv"), nm, nm);
  $("submit").disabled = ta.value.trim().length < 3 || (!S.anon && !nm);
  autosize();
}
ta.addEventListener("input", syncDraft);
nick.addEventListener("input", syncDraft);
$("whoToggle").onclick = () => {
  S.anon = !S.anon;
  nick.hidden = S.anon;
  $("whoToggle").textContent = S.anon ? "ニックネームにする" : "匿名にする";
  if (!S.anon) nick.focus();
  syncDraft();
};
syncDraft();

/* ---------- voice input (Web Speech API) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recOn = false;
function micIdle() { recOn = false; $("micBtn").classList.remove("rec"); $("micLabel").textContent = "声で入力"; $("micSub").textContent = "タップして話すだけ"; }
function hint(m) { $("micHint").textContent = m; $("micHint").hidden = !m; }
if (!SR) hint("このブラウザは音声入力に対応していません。入力欄をタップして、キーボードのマイクから話してね。");

$("micBtn").onclick = () => {
  if (recOn && rec) { rec.stop(); return; }
  if (!SR) { ta.focus(); return; }
  hint("");
  rec = new SR();
  rec.lang = "ja-JP";
  rec.interimResults = true;
  rec.continuous = false;
  const base = ta.value ? ta.value.replace(/\s+$/, "") + "\n" : "";
  let finalText = "";
  rec.onstart = () => { recOn = true; $("micBtn").classList.add("rec"); $("micLabel").textContent = "聞いてるよ…"; $("micSub").textContent = "話し終わったら、もう一度タップ"; };
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    ta.value = (base + finalText + interim).slice(0, 400);
    syncDraft();
  };
  rec.onerror = (e) => {
    micIdle();
    if (e.error === "not-allowed" || e.error === "service-not-allowed")
      hint("マイクが許可されていません。iPhoneは「設定 > Siriと検索」と「設定 > 一般 > キーボード > 音声入力」がオンか確認してね。");
    else if (e.error === "no-speech") hint("声が聞き取れませんでした。もう一度タップして話してね。");
    else if (e.error !== "aborted") hint("音声入力がうまく動きませんでした。入力欄に直接書いても投稿できます。");
  };
  rec.onend = micIdle;
  try { rec.start(); } catch (e) { micIdle(); ta.focus(); }
};

$("submit").onclick = async () => {
  const item = { text: ta.value.trim(), cat: S.cat, name: S.anon ? "" : nick.value.trim() };
  if (!S.anon) store("voiceup-nick", item.name);
  $("submit").disabled = true;
  try {
    if (S.mode === "live") {
      await api.addDoc(api.collection(api.db, "posts"), { ...item, uid: S.uid, at: api.serverTimestamp(), empathizers: [] });
    } else {
      S.local.posts.unshift({ ...item, id: "l" + Date.now(), at: Date.now() });
      saveLocal(); renderFeed();
    }
    ta.value = ""; hint(""); syncDraft(); closeCompose();
    S.sort = "new"; renderFeed(); window.scrollTo(0, 0);
    toast("投稿しました");
  } catch (e) {
    console.error(e); toast("投稿できませんでした。通信を確認してもう一度試してね");
    syncDraft();
  }
};

/* ---------- feed ---------- */
function allPosts() {
  if (S.mode === "live") return S.posts.map((p) => ({ ...p, n: p.empathizers.length, mine: p.uid === S.uid, empd: p.empathizers.includes(S.uid) }));
  const e = new Set(S.local.emp);
  return [
    ...S.local.posts.map((p) => ({ ...p, uid: "me", n: e.has(p.id) ? 1 : 0, mine: true, empd: e.has(p.id) })),
    ...SAMPLE.map((p) => ({ ...p, name: "", uid: p.id, n: p.n + (e.has(p.id) ? 1 : 0), mine: false, empd: e.has(p.id), sample: true }))
  ];
}
const ICON = {
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.6-4.6-9.4-9.3C1.3 7.9 3.4 4.5 6.8 4.5c2.2 0 3.9 1.3 5.2 3 1.3-1.7 3-3 5.2-3 3.4 0 5.5 3.4 4.2 6.7-1.8 4.7-9.4 9.3-9.4 9.3z"/></svg>',
  dots: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>'
};

function renderFeed() {
  chips($("filterChips"), ["すべて", ...CATS], S.filter, (c) => { S.filter = c; renderFeed(); });
  document.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-selected", b.dataset.sort === S.sort));
  const list = $("list");
  if (S.mode === "loading") { list.innerHTML = '<div class="empty">みんなの声を読み込み中…</div>'; $("stat").textContent = ""; return; }
  let ps = allPosts();
  $("stat").textContent = ps.length ? "ぜんぶで " + ps.length + " 件の声" : "";
  if (S.filter !== "すべて") ps = ps.filter((p) => p.cat === S.filter);
  ps.sort(S.sort === "new" ? (a, b) => b.at - a.at : (a, b) => b.n - a.n || b.at - a.at);
  list.innerHTML = "";
  if (!ps.length) {
    list.innerHTML = '<div class="empty">' + (S.filter === "すべて" ? "まだ声がありません。<br>右下の ＋ から、最初のひとつを投稿してみよう。" : "このカテゴリの声はまだありません。") + "</div>";
    return;
  }
  for (const p of ps) list.appendChild(rowEl(p));
}

function rowEl(p) {
  const r = document.createElement("article"); r.className = "row";
  r.innerHTML =
    '<span class="av"></span>' +
    '<div class="row-main">' +
      '<div class="row-head"><span class="name"></span><span class="time"></span>' +
        '<button type="button" class="more" aria-label="その他の操作" aria-haspopup="menu">' + ICON.dots + "</button></div>" +
      '<span class="cat"></span>' + (p.sample ? '<span class="tag-sample">サンプル</span>' : "") +
      '<p class="body"></p>' +
      '<div class="acts"><button type="button" class="act emp">' + ICON.heart + '<span class="n"></span><span class="lbl">わかる</span></button></div>' +
    "</div>";
  avatar(r.querySelector(".av"), p.name, p.uid);
  r.querySelector(".name").textContent = (p.name || "匿名") + (p.mine ? "（あなた）" : "");
  r.querySelector(".time").textContent = ago(p.at);
  r.querySelector(".cat").textContent = p.cat;
  r.querySelector(".body").textContent = p.text;
  const e = r.querySelector(".emp");
  e.setAttribute("aria-pressed", p.empd);
  e.setAttribute("aria-label", "わかる " + p.n + "件");
  r.querySelector(".n").textContent = p.n || "";
  e.onclick = () => toggleEmp(p);
  const more = r.querySelector(".more");
  if (p.sample) more.hidden = true;
  more.onclick = (ev) => { ev.stopPropagation(); openMenu(more, p); };
  return r;
}

/* row menu (delete own / report others) */
function closeMenus() { document.querySelectorAll(".menu").forEach((m) => m.remove()); }
document.addEventListener("click", closeMenus);
function openMenu(anchor, p) {
  const was = anchor.querySelector(".menu"); closeMenus(); if (was) return;
  const m = document.createElement("div"); m.className = "menu"; m.setAttribute("role", "menu");
  m.onclick = (ev) => ev.stopPropagation();
  const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem");
  if (p.mine) {
    b.className = "danger"; b.textContent = "削除";
    b.onclick = () => { if (b.dataset.arm) { closeMenus(); del(p); } else { b.dataset.arm = "1"; b.textContent = "本当に削除する"; } };
  } else if (S.reported.has(p.id)) {
    b.textContent = "通報済み"; b.disabled = true;
  } else {
    b.className = "danger"; b.textContent = "通報する";
    b.onclick = () => { closeMenus(); report(p); };
  }
  m.appendChild(b); anchor.appendChild(m); b.focus();
}

const busy = new Set();
async function toggleEmp(p) {
  if (S.mode !== "live") {
    const s = new Set(S.local.emp); s.has(p.id) ? s.delete(p.id) : s.add(p.id); S.local.emp = [...s]; saveLocal(); renderFeed(); return;
  }
  if (busy.has(p.id)) return; busy.add(p.id);
  try {
    await api.updateDoc(api.doc(api.db, "posts", p.id), { empathizers: p.empd ? api.arrayRemove(S.uid) : api.arrayUnion(S.uid) });
  } catch (e) { console.error(e); toast("共感を保存できませんでした"); }
  finally { busy.delete(p.id); }
}
async function del(p) {
  if (S.mode !== "live") { S.local.posts = S.local.posts.filter((x) => x.id !== p.id); saveLocal(); renderFeed(); toast("削除しました"); return; }
  try { await api.deleteDoc(api.doc(api.db, "posts", p.id)); toast("削除しました"); }
  catch (e) { console.error(e); toast("削除できませんでした"); }
}
async function report(p) {
  try {
    if (S.mode === "live") await api.setDoc(api.doc(api.db, "reports", p.id + "_" + S.uid), { postId: p.id, uid: S.uid, at: api.serverTimestamp() });
    S.reported.add(p.id); store("voiceup-reported", [...S.reported]);
    toast("運営に通報しました");
  } catch (e) { console.error(e); toast("通報できませんでした"); }
}

document.querySelectorAll("[data-sort]").forEach((b) => (b.onclick = () => { S.sort = b.dataset.sort; renderFeed(); }));

/* ---------- storage / boot ---------- */
function saveLocal() { store("voiceup-demo", S.local); }
function demo(msg) {
  const d = store("voiceup-demo");
  S.local = d && d.posts ? d : { posts: [], emp: [] };
  S.mode = "demo"; status(msg); renderFeed();
}

async function start() {
  S.reported = new Set(store("voiceup-reported") || []);
  renderFeed();
  if (!firebaseConfig.projectId) { demo("お試しモード：Firebaseが未設定のため、投稿はこの端末の中だけに保存されます。"); return; }
  try {
    const [{ initializeApp }, auth, fs] = await Promise.all([
      import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")
    ]);
    const app = initializeApp(firebaseConfig);
    const cred = await auth.signInAnonymously(auth.getAuth(app));
    S.uid = cred.user.uid;
    api = { db: fs.getFirestore(app), ...fs };
    S.mode = "live";
    const timer = setTimeout(() => status("まだデータに接続できていません。通信状況を確認してね。", "warn"), 10000);
    const q = fs.query(fs.collection(api.db, "posts"), fs.orderBy("at", "desc"), fs.limit(300));
    fs.onSnapshot(q, (snap) => {
      clearTimeout(timer); status("");
      S.posts = snap.docs.map((d) => {
        const x = d.data();
        return { id: d.id, text: x.text || "", cat: x.cat || "その他", name: x.name || "", uid: x.uid, empathizers: x.empathizers || [], at: x.at ? x.at.toMillis() : Date.now() };
      });
      renderFeed();
    }, (err) => { clearTimeout(timer); console.error(err); status("みんなの声を読み込めませんでした。時間をおいて開き直してね。", "warn"); });
  } catch (e) {
    console.error(e);
    demo("サーバーにつながらなかったため、お試しモードで動いています（投稿はこの端末だけに保存）。");
  }
}
start();
