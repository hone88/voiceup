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
let api = null; // Firebase functions once loaded

/* ---------- helpers ---------- */
function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast._); toast._ = setTimeout(() => (t.hidden = true), 2400); }
function status(m, kind) { const s = $("status"); if (!m) { s.hidden = true; return; } s.textContent = m; s.dataset.kind = kind || ""; s.hidden = false; }
function ago(t) { const m = Math.floor((Date.now() - t) / 6e4); if (m < 1) return "たった今"; if (m < 60) return m + "分前"; const h = Math.floor(m / 60); if (h < 24) return h + "時間前"; return Math.floor(h / 24) + "日前"; }
function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

/* ---------- tabs ---------- */
function show(tab) {
  const post = tab === "post";
  $("v-post").hidden = !post; $("v-feed").hidden = post;
  $("tabPost").setAttribute("aria-selected", post); $("tabFeed").setAttribute("aria-selected", !post);
  window.scrollTo(0, 0);
}
$("tabFeed").onclick = () => show("feed");
$("tabPost").onclick = () => show("post");

/* ---------- post form ---------- */
function chips(el, list, cur, on) {
  el.innerHTML = "";
  for (const c of list) { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = c; b.setAttribute("aria-pressed", c === cur); b.onclick = () => on(c); el.appendChild(b); }
}
function renderCats() { chips($("catChips"), CATS, S.cat, (c) => { S.cat = c; renderCats(); }); }
renderCats();

const ta = $("text");
function syncText() { $("cnt").textContent = ta.value.length; $("toConfirm").disabled = ta.value.trim().length < 3; }
ta.addEventListener("input", syncText);

const nick = $("nick");
nick.value = store("voiceup-nick") || "";
function setAnon(a) { S.anon = a; $("anonOn").setAttribute("aria-pressed", a); $("anonOff").setAttribute("aria-pressed", !a); nick.hidden = a; if (!a) nick.focus(); }
$("anonOn").onclick = () => setAnon(true);
$("anonOff").onclick = () => setAnon(false);

/* ---------- voice input (Web Speech API) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recOn = false;
function micIdle() { recOn = false; $("micBtn").classList.remove("rec"); $("micLabel").textContent = "声で投稿する"; $("micSub").textContent = "タップして話すだけ"; }
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
    syncText();
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

$("toConfirm").onclick = () => {
  if (!S.anon && !nick.value.trim()) { toast("ニックネームを入れてね"); nick.focus(); return; }
  $("cCat").textContent = S.cat;
  $("cAnon").textContent = S.anon ? "匿名で投稿" : nick.value.trim() + " として投稿";
  $("cText").textContent = ta.value.trim();
  $("step-input").hidden = true; $("step-confirm").hidden = false; window.scrollTo(0, 0);
};
$("back").onclick = () => { $("step-confirm").hidden = true; $("step-input").hidden = false; };

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
    ta.value = ""; syncText(); $("step-confirm").hidden = true; $("step-input").hidden = false;
    toast("投稿しました"); show("feed");
  } catch (e) {
    console.error(e); toast("投稿できませんでした。通信を確認してもう一度試してね");
  } finally { $("submit").disabled = false; }
};

/* ---------- feed ---------- */
function allPosts() {
  if (S.mode === "live") return S.posts.map((p) => ({ ...p, n: p.empathizers.length, mine: p.uid === S.uid, empd: p.empathizers.includes(S.uid) }));
  const e = new Set(S.local.emp);
  return [
    ...S.local.posts.map((p) => ({ ...p, n: e.has(p.id) ? 1 : 0, mine: true, empd: e.has(p.id) })),
    ...SAMPLE.map((p) => ({ ...p, name: "", n: p.n + (e.has(p.id) ? 1 : 0), mine: false, empd: e.has(p.id), sample: true }))
  ];
}
const heart = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.5h2c.7-1.3 2.2-2.5 4.3-2.5 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>';

function renderFeed() {
  chips($("filterChips"), ["すべて", ...CATS], S.filter, (c) => { S.filter = c; renderFeed(); });
  document.querySelectorAll("[data-sort]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sort === S.sort));
  const list = $("list");
  if (S.mode === "loading") { list.innerHTML = '<div class="empty">みんなの声を読み込み中…</div>'; return; }
  let ps = allPosts();
  $("stat").textContent = ps.length + "件の声";
  if (S.filter !== "すべて") ps = ps.filter((p) => p.cat === S.filter);
  ps.sort(S.sort === "new" ? (a, b) => b.at - a.at : (a, b) => b.n - a.n || b.at - a.at);
  list.innerHTML = "";
  if (!ps.length) {
    list.innerHTML = '<div class="empty">' + (S.filter === "すべて" ? "まだ声がありません。<br>「声を出す」から最初のひとつを投稿してみよう。" : "このカテゴリの声はまだありません。") + "</div>";
    return;
  }
  for (const p of ps) {
    const c = document.createElement("article"); c.className = "card";
    c.innerHTML = '<div class="meta"><span class="cat"></span><span class="who"></span><span>' + ago(p.at) + "</span>" + (p.sample ? '<span class="sample">サンプル</span>' : "") +
      '</div><p></p><div class="actions"><button type="button" class="emp">' + heart + '<span>わかる</span><span class="n"></span></button><div class="more"></div></div>';
    c.querySelector(".cat").textContent = p.cat;
    c.querySelector(".who").textContent = (p.name || "匿名") + (p.mine ? "（あなた）" : "");
    c.querySelector("p").textContent = p.text;
    const e = c.querySelector(".emp"); e.setAttribute("aria-pressed", p.empd); c.querySelector(".n").textContent = p.n;
    e.onclick = () => toggleEmp(p);
    const more = c.querySelector(".more");
    if (p.mine) { const d = document.createElement("button"); d.type = "button"; d.className = "small danger"; d.textContent = "削除"; d.onclick = () => confirmDel(d, p); more.appendChild(d); }
    else if (!p.sample) {
      const r = document.createElement("button"); r.type = "button"; r.className = "small";
      const done = S.reported.has(p.id); r.textContent = done ? "通報済み" : "通報"; r.disabled = done;
      r.onclick = () => report(p, r); more.appendChild(r);
    }
    list.appendChild(c);
  }
}
document.querySelectorAll("[data-sort]").forEach((b) => (b.onclick = () => { S.sort = b.dataset.sort; renderFeed(); }));

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
function confirmDel(btn, p) {
  if (btn.dataset.arm) { del(p); return; }
  btn.dataset.arm = "1"; btn.textContent = "本当に削除？";
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.arm; btn.textContent = "削除"; } }, 3000);
}
async function del(p) {
  if (S.mode !== "live") { S.local.posts = S.local.posts.filter((x) => x.id !== p.id); saveLocal(); renderFeed(); toast("削除しました"); return; }
  try { await api.deleteDoc(api.doc(api.db, "posts", p.id)); toast("削除しました"); }
  catch (e) { console.error(e); toast("削除できませんでした"); }
}
async function report(p, btn) {
  if (S.reported.has(p.id)) return;
  btn.disabled = true;
  try {
    if (S.mode === "live") await api.setDoc(api.doc(api.db, "reports", p.id + "_" + S.uid), { postId: p.id, uid: S.uid, at: api.serverTimestamp() });
    S.reported.add(p.id); store("voiceup-reported", [...S.reported]);
    btn.textContent = "通報済み"; toast("運営に通報しました");
  } catch (e) { console.error(e); btn.disabled = false; toast("通報できませんでした"); }
}

/* ---------- storage ---------- */
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
    const a = auth.getAuth(app);
    const cred = await auth.signInAnonymously(a);
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
