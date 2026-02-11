const $ = (sel) => document.querySelector(sel);

const LS_KEY = "vocab_app_backup_mode_v1";

function toast(msg, ms = 1800){
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._tm);
  toast._tm = setTimeout(()=> (t.hidden = true), ms);
}

function setSaveDot(mode){
  // ok / saving / err
  const dot = $("#saveDot");
  if(mode === "ok"){
    dot.style.background = "rgba(72, 168, 120, .85)";
    dot.style.boxShadow = "0 0 0 6px rgba(72,168,120,.16)";
    dot.title = "已儲存";
  }else if(mode === "saving"){
    dot.style.background = "rgba(154,123,217,.95)";
    dot.style.boxShadow = "0 0 0 6px rgba(154,123,217,.18)";
    dot.title = "儲存中…";
  }else{
    dot.style.background = "rgba(197,66,107,.85)";
    dot.style.boxShadow = "0 0 0 6px rgba(197,66,107,.14)";
    dot.title = "儲存失敗";
  }
}

function normalize(s){ return (s ?? "").trim().replace(/\s+/g, " "); }
function isLikelyEnglishWord(w){
  return /^[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z'’-]+)*$/.test(w);
}

function uid(){
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(2, 8);
}
function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* -----------------------------
  State
------------------------------ */
let state = {
  version: 1,
  words: [],   // [{id, word, pos, zh, createdAt}]
  counts: {},  // { [id]: number }
  updatedAt: 0
};

function loadLocal(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(!data || typeof data !== "object") return null;
    return data;
  }catch{
    return null;
  }
}

let saveTimer = null;
function saveLocalDebounced(){
  setSaveDot("saving");
  if(saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    try{
      state.updatedAt = Date.now();
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      setSaveDot("ok");
    }catch(e){
      console.error(e);
      setSaveDot("err");
      toast("儲存失敗（可能瀏覽器空間不足）", 2200);
    }
  }, 120);
}

/* -----------------------------
  Drawer + views
------------------------------ */
const views = ["cards", "add", "list", "backup"];
function showView(name){
  for(const v of views){
    $(`#view-${v}`).classList.toggle("hidden", v !== name);
  }
  closeDrawer();
  if(name === "cards") $("#cardStage").focus();
}

function openDrawer(){
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#backdrop").hidden = false;
}
function closeDrawer(){
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#backdrop").hidden = true;
}

/* -----------------------------
  Cards: random rule
  「完全亂」+ 「本輪未結束前，任何單字不會 > 5 次」
------------------------------ */
let deck = [];
let roundSeen = new Set();
let roundCount = {};
let history = [];
let historyIndex = -1;

function resetRound(){
  const ids = state.words.map(w => w.id);
  deck = shuffle(ids);
  roundSeen = new Set();
  roundCount = {};
  history = [];
  historyIndex = -1;
}

function canPick(id){
  const total = state.words.length;
  const seenAll = roundSeen.size >= total && total > 0;
  const c = roundCount[id] ?? 0;
  if(!seenAll && c >= 5) return false;
  return true;
}

function pickNextId(){
  const total = state.words.length;
  if(total === 0) return null;

  if(deck.length !== total) resetRound();

  if(roundSeen.size >= total) resetRound();

  const maxTries = 80;
  for(let t=0; t<maxTries; t++){
    const id = deck[Math.floor(Math.random() * deck.length)];
    if(canPick(id)) return id;
  }
  // 極端情況放寬一次避免死鎖（幾乎不會）
  return deck[Math.floor(Math.random() * deck.length)];
}

function getWordById(id){
  return state.words.find(w => w.id === id) ?? null;
}

function updatePills(){
  $("#pillCount").textContent = `${state.words.length} 張`;
  const total = state.words.length;
  const seen = Math.min(roundSeen.size, total);
  $("#pillRound").textContent = total ? `本輪：${seen} / ${total}` : `本輪：0 / 0`;
}

function showCardById(id, {pushHistory=true} = {}){
  const w = getWordById(id);
  if(!w) return;

  $("#flashcard").classList.remove("flipped");
  $("#cardWord").textContent = w.word;
  $("#cardPos").textContent = w.pos;
  $("#cardZh").textContent = w.zh;

  roundSeen.add(id);
  roundCount[id] = (roundCount[id] ?? 0) + 1;

  state.counts[id] = (state.counts[id] ?? 0) + 1;
  saveLocalDebounced();
  rebuildListTable();

  if(pushHistory){
    if(historyIndex < history.length - 1){
      history = history.slice(0, historyIndex + 1);
    }
    history.push(id);
    historyIndex = history.length - 1;
  }

  updatePills();
}

function nextCard(){
  const id = pickNextId();
  if(!id){
    $("#cardWord").textContent = "尚無單字";
    $("#cardPos").textContent = "—";
    $("#cardZh").textContent = "去新增一點吧";
    $("#flashcard").classList.remove("flipped");
    updatePills();
    return;
  }
  showCardById(id, {pushHistory:true});
}

function prevCard(){
  if(historyIndex <= 0) return;
  historyIndex -= 1;
  showCardById(history[historyIndex], {pushHistory:false});
}

function forwardCard(){
  if(historyIndex < history.length - 1){
    historyIndex += 1;
    showCardById(history[historyIndex], {pushHistory:false});
  }else{
    nextCard();
  }
}

/* swipe */
let touch = {x0:0, y0:0, t0:0, active:false};
function onTouchStart(e){
  const p = e.touches[0];
  touch = {x0:p.clientX, y0:p.clientY, t0:Date.now(), active:true};
}
function onTouchEnd(e){
  if(!touch.active) return;
  touch.active = false;
  const p = e.changedTouches[0];
  const dx = p.clientX - touch.x0;
  const dy = p.clientY - touch.y0;
  const dt = Date.now() - touch.t0;

  if(Math.abs(dx) < 50) return;
  if(Math.abs(dx) < Math.abs(dy) * 1.2) return;
  if(dt > 900) return;

  if(dx < 0) forwardCard();
  else prevCard();
}

/* -----------------------------
  Add word: 防呆 + 覆蓋
------------------------------ */
function findByWord(word){
  const key = normalize(word).toLowerCase();
  return state.words.find(w => w.word.toLowerCase() === key) ?? null;
}

async function addOrUpdateWord({word, pos, zh}){
  const w = normalize(word);
  const p = normalize(pos);
  const z = normalize(zh);

  if(!w || !p || !z){
    toast("三欄都要填（不然卡片會尷尬）");
    return;
  }
  if(!isLikelyEnglishWord(w)){
    toast("英文單字格式怪怪的（建議：純英文字母/空格/連字號）");
    return;
  }

  const existing = findByWord(w);
  if(existing){
    const ok = confirm(`「${w}」已存在，要用新內容覆蓋更新嗎？`);
    if(!ok) return;
    const ok2 = confirm("最後確認：真的要覆蓋更新？");
    if(!ok2) return;

    existing.pos = p;
    existing.zh = z;
    saveLocalDebounced();
    resetRound();
    rebuildAllViews();
    toast("已更新");
    return;
  }

  const ok = confirm(`確認新增：\n英文：${w}\n詞性：${p}\n中文：${z}`);
  if(!ok) return;

  state.words.push({ id: uid(), word: w, pos: p, zh: z, createdAt: Date.now() });
  saveLocalDebounced();
  resetRound();
  rebuildAllViews();
  toast("新增成功");
}

/* -----------------------------
  List + edit
------------------------------ */
let editingId = null;

function rebuildListTable(){
  const tbody = $("#tbody");
  const q = normalize($("#search")?.value ?? "").toLowerCase();

  const rows = state.words
    .slice()
    .sort((a,b)=> a.word.localeCompare(b.word))
    .filter(w => !q || w.word.toLowerCase().includes(q) || (w.zh ?? "").toLowerCase().includes(q));

  tbody.innerHTML = "";
  $("#emptyList").hidden = state.words.length !== 0;

  for(const w of rows){
    const tr = document.createElement("tr");

    const tdWord = document.createElement("td");
    tdWord.textContent = w.word;

    const tdPos = document.createElement("td");
    tdPos.textContent = w.pos;
    tdPos.className = "td-pos";

    const tdZh = document.createElement("td");
    tdZh.textContent = w.zh;

    const tdCount = document.createElement("td");
    tdCount.className = "td-count";
    tdCount.textContent = String(state.counts[w.id] ?? 0);

    const tdAct = document.createElement("td");
    tdAct.className = "actions";
    const btn = document.createElement("button");
    btn.className = "btn secondary";
    btn.style.minHeight = "34px";
    btn.style.borderRadius = "12px";
    btn.textContent = "編輯";
    btn.addEventListener("click", ()=> openEdit(w.id));
    tdAct.appendChild(btn);

    tr.append(tdWord, tdPos, tdZh, tdCount, tdAct);
    tbody.appendChild(tr);
  }
}

function openEdit(id){
  const w = getWordById(id);
  if(!w) return;
  editingId = id;
  $("#editWord").value = w.word;
  $("#editPos").value = w.pos;
  $("#editZh").value = w.zh;
  $("#modal").hidden = false;
}

function closeEdit(){
  editingId = null;
  $("#modal").hidden = true;
}

function saveEdit(){
  const w = getWordById(editingId);
  if(!w) return;

  const newWord = normalize($("#editWord").value);
  const newPos  = normalize($("#editPos").value);
  const newZh   = normalize($("#editZh").value);

  if(!newWord || !newPos || !newZh){
    toast("三欄都要填");
    return;
  }
  if(!isLikelyEnglishWord(newWord)){
    toast("英文格式怪怪的");
    return;
  }

  const existed = findByWord(newWord);
  if(existed && existed.id !== w.id){
    toast("這個英文單字已存在（會撞車）");
    return;
  }

  const ok = confirm(`確認儲存修改？\n英文：${newWord}\n詞性：${newPos}\n中文：${newZh}`);
  if(!ok) return;
  const ok2 = confirm("最後確認：真的要儲存嗎？");
  if(!ok2) return;

  w.word = newWord;
  w.pos = newPos;
  w.zh = newZh;

  saveLocalDebounced();
  resetRound();
  rebuildAllViews();
  toast("已儲存");
  closeEdit();
}

/* -----------------------------
  Backup / Restore
------------------------------ */
function makeSnapshot(){
  // 只存必要資料（讓備份碼短）
  // counts 裡可能有不存在 id（舊資料），保留也沒差
  return {
    version: 1,
    words: state.words,
    counts: state.counts,
    updatedAt: Date.now()
  };
}

function snapshotToCode(snapshot){
  const json = JSON.stringify(snapshot);
  // 會得到比較短的 base64 字串
  return window.LZString.compressToBase64(json);
}

function codeToSnapshot(code){
  const c = normalize(code);
  if(!c) throw new Error("EMPTY");
  const json = window.LZString.decompressFromBase64(c);
  if(!json) throw new Error("BAD_CODE");
  const snap = JSON.parse(json);
  if(!snap || typeof snap !== "object") throw new Error("BAD_JSON");
  if(!Array.isArray(snap.words) || typeof snap.counts !== "object") throw new Error("BAD_SHAPE");
  return snap;
}

function downloadJson(snapshot){
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vocab-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

let pendingRestore = null;

function restorePreviewFromSnapshot(snap, mode){
  const nowWords = state.words;
  const nowMap = new Map(nowWords.map(w => [w.word.toLowerCase(), w]));
  const incoming = snap.words ?? [];

  let willAdd = 0, willUpdate = 0, willOverwrite = incoming.length;
  for(const w of incoming){
    const key = (w.word ?? "").toLowerCase();
    if(nowMap.has(key)) willUpdate++;
    else willAdd++;
  }

  if(mode === "overwrite"){
    return [
      `模式：覆蓋`,
      `目前：${nowWords.length} 筆 → 會被整包取代`,
      `備份：${incoming.length} 筆`,
      `結果：${incoming.length} 筆（以備份為主）`,
      ``,
      `⚠️ 覆蓋會把你目前資料整包換掉（所以我才做兩層確認）`
    ].join("\n");
  }

  return [
    `模式：合併`,
    `目前：${nowWords.length} 筆`,
    `備份：${incoming.length} 筆`,
    `將新增：${willAdd} 筆`,
    `將更新：${willUpdate} 筆（同英文單字）`,
    ``,
    `提示：出現次數 counts 會取「較大值」，避免回捲。`
  ].join("\n");
}

function mergeRestore(snap){
  const incoming = (snap.words ?? []).map(w => ({
    id: w.id ?? uid(),
    word: normalize(w.word),
    pos: normalize(w.pos),
    zh: normalize(w.zh),
    createdAt: w.createdAt ?? Date.now()
  })).filter(w => w.word && w.pos && w.zh);

  const mapByWord = new Map(state.words.map(w => [w.word.toLowerCase(), w]));
  for(const w of incoming){
    const key = w.word.toLowerCase();
    if(mapByWord.has(key)){
      const cur = mapByWord.get(key);
      // 保留原 id（避免 counts 斷掉），但更新內容
      cur.pos = w.pos;
      cur.zh = w.zh;
    }else{
      state.words.push(w);
      mapByWord.set(key, w);
    }
  }

  // counts：取最大，避免回捲
  const c = snap.counts ?? {};
  for(const [id, val] of Object.entries(c)){
    const v = Number(val ?? 0);
    state.counts[id] = Math.max(state.counts[id] ?? 0, isFinite(v) ? v : 0);
  }
}

function overwriteRestore(snap){
  state.words = (snap.words ?? []).map(w => ({
    id: w.id ?? uid(),
    word: normalize(w.word),
    pos: normalize(w.pos),
    zh: normalize(w.zh),
    createdAt: w.createdAt ?? Date.now()
  })).filter(w => w.word && w.pos && w.zh);

  const c = snap.counts ?? {};
  const counts = {};
  for(const [id, val] of Object.entries(c)){
    const v = Number(val ?? 0);
    counts[id] = isFinite(v) ? v : 0;
  }
  state.counts = counts;
}

function applyRestore(snap, mode){
  if(mode === "overwrite") overwriteRestore(snap);
  else mergeRestore(snap);

  saveLocalDebounced();
  resetRound();
  rebuildAllViews();
}

function getRestoreMode(){
  return document.querySelector('input[name="restoreMode"]:checked')?.value ?? "merge";
}

/* -----------------------------
  Rebuild
------------------------------ */
function rebuildAllViews(){
  rebuildListTable();
  updatePills();

  if(state.words.length === 0){
    $("#cardWord").textContent = "尚無單字";
    $("#cardPos").textContent = "—";
    $("#cardZh").textContent = "去新增一點吧";
    $("#flashcard").classList.remove("flipped");
  }else{
    if(history.length === 0) nextCard();
  }
}

/* -----------------------------
  Bind events
------------------------------ */
function bindUI(){
  $("#btnMenu").addEventListener("click", openDrawer);
  $("#btnCloseMenu").addEventListener("click", closeDrawer);
  $("#backdrop").addEventListener("click", closeDrawer);

  document.querySelectorAll(".nav-btn").forEach(btn=>{
    btn.addEventListener("click", ()=> showView(btn.dataset.view));
  });

  $("#flashcard").addEventListener("click", ()=>{
    $("#flashcard").classList.toggle("flipped");
  });

  $("#btnPrev").addEventListener("click", prevCard);
  $("#btnNext").addEventListener("click", forwardCard);

  $("#cardStage").addEventListener("keydown", (e)=>{
    if(e.key === "ArrowRight") forwardCard();
    if(e.key === "ArrowLeft") prevCard();
    if(e.key === " " || e.key === "Enter"){
      e.preventDefault();
      $("#flashcard").classList.toggle("flipped");
    }
  });

  $("#cardStage").addEventListener("touchstart", onTouchStart, {passive:true});
  $("#cardStage").addEventListener("touchend", onTouchEnd, {passive:true});

  $("#addForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    await addOrUpdateWord({
      word: $("#inWord").value,
      pos: $("#inPos").value,
      zh: $("#inZh").value,
    });
  });

  $("#btnClearAdd").addEventListener("click", ()=>{
    const ok = confirm("確定要清空嗎？（你剛剛打的字會直接蒸發）");
    if(!ok) return;
    $("#inWord").value = "";
    $("#inPos").value = "";
    $("#inZh").value = "";
    toast("已清空");
  });

  $("#search").addEventListener("input", rebuildListTable);

  $("#btnCloseModal").addEventListener("click", closeEdit);
  $("#btnCancelEdit").addEventListener("click", closeEdit);
  $("#btnSaveEdit").addEventListener("click", saveEdit);
  $("#modal").addEventListener("click", (e)=>{ if(e.target === $("#modal")) closeEdit(); });

  // Backup
  $("#btnGenCode").addEventListener("click", ()=>{
    if(!window.LZString) { toast("壓縮工具未載入（lz-string.min.js）"); return; }
    const snap = makeSnapshot();
    const code = snapshotToCode(snap);
    $("#backupCode").value = code;
    toast("已產生備份碼");
  });

  $("#btnCopyCode").addEventListener("click", async ()=>{
    const code = $("#backupCode").value;
    if(!normalize(code)){
      toast("沒有備份碼可複製");
      return;
    }
    try{
      await navigator.clipboard.writeText(code);
      toast("已複製");
    }catch{
      $("#backupCode").focus();
      $("#backupCode").select();
      toast("已全選，手動複製（Cmd/Ctrl+C）");
    }
  });

  $("#btnDownloadJson").addEventListener("click", ()=>{
    const snap = makeSnapshot();
    downloadJson(snap);
    toast("已下載 JSON");
  });

  $("#btnPreviewRestore").addEventListener("click", ()=>{
    const code = $("#backupCode").value;
    const mode = getRestoreMode();
    try{
      const snap = codeToSnapshot(code);
      pendingRestore = { snap, mode };

      const text = restorePreviewFromSnapshot(snap, mode);
      const box = $("#restorePreview");
      box.hidden = false;
      box.textContent = text;

      $("#btnConfirmRestore").disabled = false;
      toast("預覽完成：確認無誤再還原");
    }catch(e){
      console.error(e);
      pendingRestore = null;
      $("#restorePreview").hidden = false;
      $("#restorePreview").textContent = "讀取失敗：備份碼格式不正確或損毀。";
      $("#btnConfirmRestore").disabled = true;
      toast("備份碼無法解析");
    }
  });

  $("#btnConfirmRestore").addEventListener("click", ()=>{
    if(!pendingRestore){
      toast("請先預覽");
      return;
    }
    const {snap, mode} = pendingRestore;

    const ok = confirm("最後確認：真的要還原嗎？");
    if(!ok) return;

    const ok2 = confirm("再確認一次：手殘按錯會哭的那種，確定嗎？");
    if(!ok2) return;

    applyRestore(snap, mode);
    pendingRestore = null;
    $("#btnConfirmRestore").disabled = true;
    toast("還原完成");
  });

  $("#fileJson").addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      const text = await file.text();
      const snap = JSON.parse(text);
      // 直接丟到 textarea 讓你可見
      const code = snapshotToCode(snap);
      $("#backupCode").value = code;
      toast("已載入 JSON（已轉成備份碼），可先預覽再還原");
    }catch(err){
      console.error(err);
      toast("JSON 讀取失敗");
    }finally{
      e.target.value = "";
    }
  });
}

/* -----------------------------
  Init
------------------------------ */
(function init(){
  setSaveDot("ok");
  bindUI();
  document.body.classList.remove("modal-open"); // 防止卡死
  $("#modal").hidden = true;                    // 防止彈窗殘留

  showView("cards");

  const local = loadLocal();
  if(local){
    state = local;
  }
  resetRound();
  rebuildAllViews();
})();
