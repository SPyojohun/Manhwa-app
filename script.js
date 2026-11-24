/* ===========================================================
   만화 — Manhwa Library
   - IndexedDB persistence (resists cache clearing)
   - JSON Export/Import for backup
   - PWA installable
   - Share system (serverless: items are packed into the link)
=========================================================== */

/* -------------------- Audio (click sound) -------------------- */
const Sound = (()=> {
  let ctx;
  function play(freq=520, dur=0.05, type='sine', vol=0.06){
    try{
      ctx = ctx || new (window.AudioContext||window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type=type; o.frequency.value=freq;
      g.gain.value=vol;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+dur);
      o.stop(ctx.currentTime+dur+0.02);
    }catch(_){}
  }
  return {
    click: ()=>play(620,0.04,'triangle',0.05),
    pop:   ()=>play(880,0.06,'sine',0.05),
    soft:  ()=>play(420,0.07,'sine',0.04),
    warn:  ()=>play(280,0.12,'sawtooth',0.04),
  };
})();

/* -------------------- IndexedDB store -------------------- */
const DB_NAME = 'manhwa_library';
const DB_VER = 1;
const STORE = 'kv';

function openDB(){
  return new Promise((res, rej)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = ()=>res(req.result);
    req.onerror = ()=>rej(req.error);
  });
}
async function dbGet(key){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE,'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
}
async function dbSet(key, val){
  const db = await openDB();
  return new Promise((res, rej)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete=()=>res(); tx.onerror=()=>rej(tx.error);
  });
}

/* -------------------- App State (JSON shape) -------------------- */
let state = {
  manhwa: [],      // {id,title,desc,url,img,createdAt}
  collections: [], // {id,name,desc,img,items:[manhwaId]}
  heroines: [],    // {id,name,desc,img}
  history: [],     // {id, manhwaId, title, openedAt}
};

const STATE_KEY = 'state_v1';
async function loadState(){
  const d = await dbGet(STATE_KEY);
  if(d) state = {...state, ...d};
}
let saveTimer;
async function saveState(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=> dbSet(STATE_KEY, state), 120);
}

const uid = ()=> Date.now().toString(36)+Math.random().toString(36).slice(2,8);

/* -------------------- DOM helpers -------------------- */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toast(msg){
  const t = $('#toast');
  t.textContent = msg; t.hidden=false;
  clearTimeout(t._h);
  t._h = setTimeout(()=>{ t.hidden=true; }, 2200);
}

/* -------------------- Page nav -------------------- */
function showPage(name){
  if(name!=='manhwa' && selectMode) setSelectMode(false);
  $$('.page').forEach(p => p.hidden = p.dataset.page !== name);
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.target===name));
  Sound.click();
  if(name==='manhwa') renderManhwa();
  if(name==='collections') renderCollections();
  if(name==='heroine') renderHeroines();
  if(name==='search') $('#searchInput').focus();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', ()=> showPage(b.dataset.target)));

/* -------------------- Image utils -------------------- */
function fileToDataURL(file){
  return new Promise((res, rej)=>{
    const r = new FileReader();
    r.onload = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
    r.readAsDataURL(file);
  });
}
async function compressImage(file, maxW=600, quality=0.82){
  const dataURL = await fileToDataURL(file);
  return new Promise((res)=>{
    const img = new Image();
    img.onload = ()=>{
      const scale = Math.min(1, maxW/img.width);
      const w = Math.round(img.width*scale);
      const h = Math.round(img.height*scale);
      const c = document.createElement('canvas');
      c.width=w; c.height=h;
      c.getContext('2d').drawImage(img,0,0,w,h);
      res(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = ()=> res(dataURL);
    img.src = dataURL;
  });
}

function placeholderImg(){
  // returns a markup snippet for placeholder (Korean text)
  return `<span style="font-family:'Noto Sans KR',sans-serif;font-weight:900;">만화</span>`;
}

/* -------------------- Card renderers -------------------- */
/* -------------------- Pinning (favourites) -------------------- */
// Stored on the item itself (m.pinned / m.pinnedAt) so it is saved with the library and included in backups.
const PIN_SVG = '<svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6 3.5 3.5V15H6.5v-2.5L10 9 9 3zM12 15v6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function pinBtn(m){
  return `<button class="pin-btn${m.pinned?' on':''}" data-action="pin" data-id="${m.id}" aria-pressed="${!!m.pinned}" aria-label="${m.pinned?'เลิกปักหมุด':'ปักหมุด'}">${PIN_SVG}</button>`;
}
function togglePin(id){
  const m = state.manhwa.find(x => x.id === id); if(!m) return;
  m.pinned = !m.pinned;
  if(m.pinned) m.pinnedAt = Date.now(); else delete m.pinnedAt;
  saveState();
  // update every visible copy of this card's pin button (grid, search results, collection viewer)
  document.querySelectorAll(`.card .pin-btn[data-id="${id}"]`).forEach(b=>{
    b.classList.toggle('on', m.pinned);
    b.setAttribute('aria-pressed', String(m.pinned));
    b.setAttribute('aria-label', m.pinned ? 'เลิกปักหมุด' : 'ปักหมุด');
  });
  renderPinned();
  toast(m.pinned ? 'ปักหมุดแล้ว' : 'เลิกปักหมุดแล้ว');
  m.pinned ? Sound.pop() : Sound.soft();
}
function renderPinned(){
  const sec = $('#pinnedSection');
  if(selectMode || state.manhwa.length === 0){ sec.hidden = true; return; }   // nothing to pin yet / hidden while selecting
  const pins = state.manhwa.filter(m => m.pinned).sort((a,b)=> (b.pinnedAt||0) - (a.pinnedAt||0));
  $('#pinnedCount').textContent = pins.length ? pins.length + ' เรื่อง' : '';
  $('#pinnedEmpty').hidden = pins.length > 0;
  $('#pinnedRow').hidden = pins.length === 0;
  $('#pinnedRow').innerHTML = pins.map(m => `
    <div class="pin-item">
      <button class="today-card" data-id="${m.id}" aria-label="เปิด ${escapeHTML(m.title)}">
        <div class="today-img">${m.img ? `<img src="${m.img}" alt="" loading="lazy">` : placeholderImg()}</div>
        <span>${escapeHTML(m.title)}</span>
      </button>
      <button class="pin-btn on" data-action="pin" data-id="${m.id}" aria-pressed="true" aria-label="เลิกปักหมุด">${PIN_SVG}</button>
    </div>`).join('');
  sec.hidden = false;
}
$('#pinnedRow').addEventListener('click', e=>{
  const c = e.target.closest('.today-card'); if(c) openManhwa(c.dataset.id);
});
// one delegated handler: works in the grid, search results and the collection viewer
document.addEventListener('click', e=>{
  const b = e.target.closest('[data-action="pin"]'); if(!b) return;
  e.preventDefault(); e.stopPropagation();
  togglePin(b.dataset.id);
});

function manhwaCard(m){
  const img = m.img
    ? `<img src="${m.img}" alt="${escapeHTML(m.title)}" loading="lazy">`
    : placeholderImg();
  return `
    <div class="card" data-id="${m.id}">
      <div class="card-img">${img}${pinBtn(m)}</div>
      <div class="card-body">
        <div class="card-title">${escapeHTML(m.title)}</div>
        ${m.desc ? `<div class="card-desc">${escapeHTML(m.desc)}</div>` : ''}
        <div class="card-actions">
          <button class="btn-open" data-action="open" data-id="${m.id}">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;"><path d="M14 5h5v5M19 5L10 14M5 19h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
            เปิด
          </button>
          <button class="btn-mini" data-action="edit" data-id="${m.id}" aria-label="แก้ไข">
            <svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z M14 6l4 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

function escapeHTML(s){
  return String(s||'').replace(/[&<>"']/g, c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* -------------------- Manhwa page -------------------- */
/* -------------------- Today's list -------------------- */
// 4 random picks from the library, kept stable for the whole day.
// Hidden when the library has fewer than 4 items.
const TODAY_KEY = 'manhwa_today_v1';
const TODAY_SIZE = 4;

function localDayKey(){
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
}
function shuffled(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function getTodayList(){
  const pool = state.manhwa;
  if(pool.length < TODAY_SIZE) return [];
  const day = localDayKey();
  let saved = null;
  try{ saved = JSON.parse(localStorage.getItem(TODAY_KEY)); }catch(_){}
  // keep today's saved picks that still exist (e.g. none were deleted)
  let ids = (saved && saved.date === day && Array.isArray(saved.ids))
    ? saved.ids.filter(id => pool.some(m => m.id === id))
    : [];
  if(ids.length < TODAY_SIZE){                       // new day, or a pick was deleted -> top up
    const rest = shuffled(pool.filter(m => !ids.includes(m.id)).map(m => m.id));
    ids = ids.concat(rest.slice(0, TODAY_SIZE - ids.length));
  }
  ids = ids.slice(0, TODAY_SIZE);
  try{ localStorage.setItem(TODAY_KEY, JSON.stringify({date:day, ids})); }catch(_){}
  return ids.map(id => pool.find(m => m.id === id));
}
function renderToday(){
  const sec = $('#todaySection');
  const list = selectMode ? [] : getTodayList();
  if(list.length < TODAY_SIZE){ sec.hidden = true; $('#todayRow').innerHTML = ''; return; }
  $('#todayDate').textContent = new Date().toLocaleDateString('th-TH', {weekday:'long', day:'numeric', month:'long'});
  $('#todayRow').innerHTML = list.map(m => `
    <button class="today-card" data-id="${m.id}" aria-label="เปิด ${escapeHTML(m.title)}">
      <div class="today-img">${m.img ? `<img src="${m.img}" alt="" loading="lazy">` : placeholderImg()}</div>
      <span>${escapeHTML(m.title)}</span>
    </button>`).join('');
  sec.hidden = false;
}
$('#todayRow').addEventListener('click', e=>{
  const c = e.target.closest('.today-card'); if(c) openManhwa(c.dataset.id);
});
// pick up a new day if the app was left open overnight
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) renderToday(); });

const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';

function renderManhwa(){
  const grid = $('#manhwaGrid');
  $('#manhwaCount').textContent = state.manhwa.length + ' เรื่อง';
  $('#btnSelectMode').hidden = state.manhwa.length===0 || selectMode;
  renderToday();
  renderPinned();
  if(state.manhwa.length===0){
    if(selectMode){ selectMode=false; selectedIds.clear(); document.body.classList.remove('selecting'); $('#selectBar').hidden=true; }
    grid.classList.remove('selecting');
    grid.innerHTML = '';
    $('#manhwaEmpty').classList.add('show');
    return;
  }
  $('#manhwaEmpty').classList.remove('show');
  // sort newest first
  const list = [...state.manhwa].sort((a,b)=> b.createdAt - a.createdAt);
  grid.innerHTML = list.map(manhwaCard).join('');

  grid.querySelectorAll('[data-action="open"]').forEach(b=>{
    b.addEventListener('click', e=>{ openManhwa(b.dataset.id); });
  });
  grid.querySelectorAll('[data-action="edit"]').forEach(b=>{
    b.addEventListener('click', e=>{ openManhwaForm(b.dataset.id); });
  });

  // selection mode decorations
  grid.classList.toggle('selecting', selectMode);
  if(selectMode){
    // drop ids that no longer exist
    for(const id of [...selectedIds]) if(!state.manhwa.some(m=>m.id===id)) selectedIds.delete(id);
    grid.querySelectorAll('.card').forEach(card=>{
      card.querySelector('.card-img').insertAdjacentHTML('beforeend', `<span class="sel-mark">${CHECK_SVG}</span>`);
      card.classList.toggle('selected', selectedIds.has(card.dataset.id));
    });
    updateSelectBar();
  }
}

function openManhwa(id){
  const m = state.manhwa.find(x=>x.id===id);
  if(!m) return;
  Sound.pop();
  // log history
  state.history.unshift({id: uid(), manhwaId:id, title:m.title, openedAt: Date.now()});
  state.history = state.history.slice(0, 100);
  saveState();
  // open in default browser (new tab => system handles it)
  window.open(m.url, '_blank', 'noopener,noreferrer');
}

/* -------------------- Add/Edit Manhwa form -------------------- */
function openManhwaForm(id){
  const editing = state.manhwa.find(m => m.id===id);
  let imgData = editing?.img || '';

  openModal(editing ? 'แก้ไขมังฮวา' : 'เพิ่มมังฮวา', `
    <div class="field">
      <label>ชื่อมังฮวา</label>
      <input type="text" id="f_title" value="${escapeHTML(editing?.title||'')}" placeholder="เช่น The Lady's Sword">
    </div>
    <div class="field">
      <label>URL <small>(ลิงก์ที่จะเปิด)</small></label>
      <input type="url" id="f_url" value="${escapeHTML(editing?.url||'')}" placeholder="https://...">
    </div>
    <div class="field">
      <label>คำอธิบาย <small>(ไม่บังคับ)</small></label>
      <textarea id="f_desc" placeholder="แนวเรื่อง / โน้ตส่วนตัว">${escapeHTML(editing?.desc||'')}</textarea>
    </div>
    <div class="field">
      <label>รูปปก <small>(ไม่บังคับ — ถ้าไม่ใส่ จะใช้รูป "만화")</small></label>
      <div class="img-picker">
        <div class="img-preview" id="f_imgPreview">${imgData? `<img src="${imgData}">`:'만화'}</div>
        <div class="img-pick-btns">
          <button type="button" class="btn-ghost" id="f_pickImg">เลือกรูป</button>
          <button type="button" class="btn-ghost" id="f_clearImg">ล้างรูป</button>
        </div>
      </div>
      <input type="file" id="f_imgInput" accept="image/*" hidden>
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" data-close>ยกเลิก</button>
      <button class="btn-primary" id="f_save">${editing?'บันทึก':'เพิ่ม'}</button>
    </div>
  `);

  $('#f_pickImg').addEventListener('click', ()=> $('#f_imgInput').click());
  $('#f_imgInput').addEventListener('change', async (e)=>{
    const file = e.target.files[0]; if(!file) return;
    const compressed = await compressImage(file);
    imgData = compressed;
    $('#f_imgPreview').innerHTML = `<img src="${imgData}">`;
  });
  $('#f_clearImg').addEventListener('click', ()=>{
    imgData=''; $('#f_imgPreview').innerHTML='만화';
  });
  $('#f_save').addEventListener('click', ()=>{
    const title = $('#f_title').value.trim();
    const url = $('#f_url').value.trim();
    const desc = $('#f_desc').value.trim();
    if(!title){ toast('กรุณาใส่ชื่อ'); return; }
    if(!url){ toast('กรุณาใส่ URL'); return; }
    if(editing){
      Object.assign(editing, {title, url, desc, img:imgData});
      toast('บันทึกแล้ว');
    } else {
      state.manhwa.push({id:uid(), title, url, desc, img:imgData, createdAt:Date.now()});
      toast('เพิ่มแล้ว');
    }
    saveState();
    closeModal();
    renderManhwa();
    Sound.pop();
  });
}

/* -------------------- Collections -------------------- */
function collectionCard(c){
  const items = c.items.length;
  const img = c.img ? `<img src="${c.img}" alt="${escapeHTML(c.name)}" loading="lazy">` : placeholderImg();
  return `
    <div class="card" data-id="${c.id}">
      <div class="card-img">${img}<span class="card-badge">${items} เรื่อง</span></div>
      <div class="card-body">
        <div class="card-title">${escapeHTML(c.name)}</div>
        ${c.desc ? `<div class="card-desc">${escapeHTML(c.desc)}</div>` : ''}
        <div class="card-actions">
          <button class="btn-open" data-action="view" data-id="${c.id}">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;"><path d="M3 12h18M13 5l8 7-8 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>
            ดู
          </button>
          <button class="btn-mini" data-action="edit-col" data-id="${c.id}" aria-label="แก้ไข">
            <svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z M14 6l4 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>
          </button>
          <button class="btn-mini" data-action="del-col" data-id="${c.id}" aria-label="ลบ" style="background:#ffe1e8;color:#d94d75;">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" fill="none" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}
function renderCollections(){
  const g = $('#collectionsGrid');
  if(state.collections.length===0){
    g.innerHTML=''; $('#collectionsEmpty').classList.add('show'); return;
  }
  $('#collectionsEmpty').classList.remove('show');
  g.innerHTML = state.collections.map(collectionCard).join('');
  g.querySelectorAll('[data-action="view"]').forEach(b=> b.addEventListener('click',()=> viewCollection(b.dataset.id)));
  g.querySelectorAll('[data-action="edit-col"]').forEach(b=> b.addEventListener('click',()=> openCollectionForm(b.dataset.id)));
  g.querySelectorAll('[data-action="del-col"]').forEach(b=> b.addEventListener('click',()=> confirmDelete('คอลเล็กชั่นนี้', ()=>{
    state.collections = state.collections.filter(c=> c.id!==b.dataset.id);
    saveState(); renderCollections(); toast('ลบคอลเล็กชั่นแล้ว');
  })));
}

$('#btnAddCollection').addEventListener('click', ()=> openCollectionForm());

function openCollectionForm(id){
  const editing = state.collections.find(c=>c.id===id);
  if(state.manhwa.length===0 && !editing){
    toast('ต้องมีมังฮวาก่อนถึงสร้างคอลเล็กชั่นได้'); Sound.warn(); return;
  }
  let imgData = editing?.img || '';
  let selected = new Set(editing?.items || []);

  const itemsHTML = state.manhwa.map(m=>`
    <label class="check-row">
      <input type="checkbox" data-mid="${m.id}" ${selected.has(m.id)?'checked':''}>
      <span class="thumb">${m.img?`<img src="${m.img}">`:'만'}</span>
      <span>${escapeHTML(m.title)}</span>
    </label>`).join('') || '<p style="padding:12px;color:var(--ink-soft);font-size:13px;">ยังไม่มีมังฮวา</p>';

  openModal(editing?'แก้ไขคอลเล็กชั่น':'สร้างคอลเล็กชั่น', `
    <div class="field"><label>ชื่อคอลเล็กชั่น</label>
      <input type="text" id="c_name" value="${escapeHTML(editing?.name||'')}" placeholder="เช่น โรแมนติกย้อนยุค"></div>
    <div class="field"><label>คำอธิบาย <small>(ไม่บังคับ)</small></label>
      <textarea id="c_desc">${escapeHTML(editing?.desc||'')}</textarea></div>
    <div class="field"><label>รูป <small>(ไม่บังคับ)</small></label>
      <div class="img-picker">
        <div class="img-preview" id="c_imgPreview">${imgData?`<img src="${imgData}">`:'만화'}</div>
        <div class="img-pick-btns">
          <button type="button" class="btn-ghost" id="c_pickImg">เลือกรูป</button>
          <button type="button" class="btn-ghost" id="c_clearImg">ล้างรูป</button>
        </div>
      </div>
      <input type="file" id="c_imgInput" accept="image/*" hidden>
    </div>
    <div class="field"><label>เลือกมังฮวาในคอลเล็กชั่น</label>
      <div class="check-list" id="c_items">${itemsHTML}</div>
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" data-close>ยกเลิก</button>
      <button class="btn-primary" id="c_save">${editing?'บันทึก':'สร้าง'}</button>
    </div>
  `);

  $('#c_pickImg').onclick = ()=> $('#c_imgInput').click();
  $('#c_imgInput').onchange = async e=>{
    const f=e.target.files[0]; if(!f) return;
    imgData = await compressImage(f);
    $('#c_imgPreview').innerHTML = `<img src="${imgData}">`;
  };
  $('#c_clearImg').onclick = ()=>{ imgData=''; $('#c_imgPreview').innerHTML='만화'; };

  $('#c_items').addEventListener('change', e=>{
    const cb = e.target;
    if(cb.checked) selected.add(cb.dataset.mid); else selected.delete(cb.dataset.mid);
  });

  $('#c_save').onclick = ()=>{
    const name = $('#c_name').value.trim();
    const desc = $('#c_desc').value.trim();
    if(!name){ toast('กรุณาใส่ชื่อ'); return; }
    if(editing){
      Object.assign(editing,{name,desc,img:imgData,items:[...selected]});
      toast('บันทึกแล้ว');
    } else {
      state.collections.push({id:uid(),name,desc,img:imgData,items:[...selected]});
      toast('สร้างแล้ว');
    }
    saveState(); closeModal(); renderCollections(); Sound.pop();
  };
}

function viewCollection(id){
  const c = state.collections.find(x=>x.id===id); if(!c) return;
  const list = c.items.map(mid => state.manhwa.find(m=>m.id===mid)).filter(Boolean);
  const inner = list.length
    ? `<div class="grid">${list.map(manhwaCard).join('')}</div>`
    : '<p style="text-align:center;color:var(--ink-soft);padding:30px;">ยังไม่มีมังฮวาในคอลเล็กชั่นนี้</p>';
  openModal(c.name, inner);
  document.querySelectorAll('#modalBody [data-action="open"]').forEach(b=>{
    b.addEventListener('click',()=> openManhwa(b.dataset.id));
  });
  document.querySelectorAll('#modalBody [data-action="edit"]').forEach(b=>{
    b.addEventListener('click',()=>{ closeModal(); openManhwaForm(b.dataset.id); });
  });
}

/* -------------------- Heroines -------------------- */
function heroineCard(h){
  const img = h.img ? `<img src="${h.img}" alt="${escapeHTML(h.name)}" loading="lazy">` : `<span style="font-family:'Noto Sans KR';font-weight:900;">여주</span>`;
  return `
    <div class="card heroine" data-id="${h.id}">
      <div class="card-img">${img}</div>
      <div class="card-body">
        <div class="card-title" style="text-align:center;">${escapeHTML(h.name)}</div>
        ${h.desc?`<div class="card-desc" style="text-align:center;">${escapeHTML(h.desc)}</div>`:''}
        <div class="card-actions">
          <button class="btn-open" data-action="edit-h" data-id="${h.id}">
            <svg viewBox="0 0 24 24" style="width:14px;height:14px;"><path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" stroke-width="2" fill="none"/></svg>
            แก้ไข
          </button>
          <button class="btn-mini del" data-action="del-h" data-id="${h.id}" style="background:#ffe1e8;color:#d94d75;">
            <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" fill="none"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}
function renderHeroines(){
  const g = $('#heroineGrid');
  if(state.heroines.length===0){ g.innerHTML=''; $('#heroineEmpty').classList.add('show'); return; }
  $('#heroineEmpty').classList.remove('show');
  g.innerHTML = state.heroines.map(heroineCard).join('');
  g.querySelectorAll('[data-action="edit-h"]').forEach(b=> b.addEventListener('click',()=> openHeroineForm(b.dataset.id)));
  g.querySelectorAll('[data-action="del-h"]').forEach(b=> b.addEventListener('click',()=> confirmDelete('นางเอกคนนี้', ()=>{
    state.heroines = state.heroines.filter(h=>h.id!==b.dataset.id);
    saveState(); renderHeroines(); toast('ลบแล้ว');
  })));
}
$('#btnAddHeroine').addEventListener('click', ()=> openHeroineForm());

function openHeroineForm(id){
  const editing = state.heroines.find(h=>h.id===id);
  let imgData = editing?.img || '';
  openModal(editing?'แก้ไขนางเอก':'เพิ่มนางเอก', `
    <div class="field"><label>ชื่อ</label>
      <input type="text" id="h_name" value="${escapeHTML(editing?.name||'')}" placeholder="ชื่อตัวละคร"></div>
    <div class="field"><label>คำอธิบาย <small>(ไม่บังคับ)</small></label>
      <textarea id="h_desc">${escapeHTML(editing?.desc||'')}</textarea></div>
    <div class="field"><label>รูป <small>(ไม่บังคับ)</small></label>
      <div class="img-picker">
        <div class="img-preview" id="h_imgPreview" style="border-radius:50%;width:80px;height:80px;">${imgData?`<img src="${imgData}">`:'여주'}</div>
        <div class="img-pick-btns">
          <button type="button" class="btn-ghost" id="h_pickImg">เลือกรูป</button>
          <button type="button" class="btn-ghost" id="h_clearImg">ล้างรูป</button>
        </div>
      </div>
      <input type="file" id="h_imgInput" accept="image/*" hidden>
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" data-close>ยกเลิก</button>
      <button class="btn-primary" id="h_save">${editing?'บันทึก':'เพิ่ม'}</button>
    </div>
  `);
  $('#h_pickImg').onclick = ()=> $('#h_imgInput').click();
  $('#h_imgInput').onchange = async e=>{
    const f=e.target.files[0]; if(!f) return;
    imgData = await compressImage(f, 400, 0.85);
    $('#h_imgPreview').innerHTML = `<img src="${imgData}">`;
  };
  $('#h_clearImg').onclick = ()=>{ imgData=''; $('#h_imgPreview').innerHTML='여주'; };
  $('#h_save').onclick = ()=>{
    const name = $('#h_name').value.trim();
    const desc = $('#h_desc').value.trim();
    if(!name){ toast('กรุณาใส่ชื่อ'); return; }
    if(editing) Object.assign(editing,{name,desc,img:imgData});
    else state.heroines.push({id:uid(),name,desc,img:imgData});
    saveState(); closeModal(); renderHeroines(); Sound.pop();
    toast(editing?'บันทึกแล้ว':'เพิ่มแล้ว');
  };
}

/* -------------------- Search -------------------- */
$('#searchInput').addEventListener('input', e=>{
  const q = e.target.value.trim().toLowerCase();
  const box = $('#searchResults');
  if(!q){ box.innerHTML = '<p class="hint">เริ่มพิมพ์เพื่อค้นหา</p>'; return; }
  const m = state.manhwa.filter(x => x.title.toLowerCase().includes(q) || (x.desc||'').toLowerCase().includes(q));
  const c = state.collections.filter(x => x.name.toLowerCase().includes(q) || (x.desc||'').toLowerCase().includes(q));
  const h = state.heroines.filter(x => x.name.toLowerCase().includes(q) || (x.desc||'').toLowerCase().includes(q));
  let html='';
  if(m.length) html += `<div class="search-section"><h4><span class="kr-mini">만화</span> มังฮวา (${m.length})</h4><div class="grid">${m.map(manhwaCard).join('')}</div></div>`;
  if(c.length) html += `<div class="search-section"><h4><span class="kr-mini">컬렉션</span> คอลเล็กชั่น (${c.length})</h4><div class="grid">${c.map(collectionCard).join('')}</div></div>`;
  if(h.length) html += `<div class="search-section"><h4><span class="kr-mini">여주</span> นางเอก (${h.length})</h4><div class="grid">${h.map(heroineCard).join('')}</div></div>`;
  if(!html) html = '<p class="hint">ไม่พบผลลัพธ์</p>';
  box.innerHTML = html;
  box.querySelectorAll('[data-action="open"]').forEach(b=> b.addEventListener('click',()=> openManhwa(b.dataset.id)));
  box.querySelectorAll('[data-action="edit"]').forEach(b=> b.addEventListener('click',()=> openManhwaForm(b.dataset.id)));
  box.querySelectorAll('[data-action="view"]').forEach(b=> b.addEventListener('click',()=> viewCollection(b.dataset.id)));
  box.querySelectorAll('[data-action="edit-h"]').forEach(b=> b.addEventListener('click',()=> openHeroineForm(b.dataset.id)));
});

/* -------------------- More menu actions -------------------- */
document.querySelectorAll('.more-item').forEach(it=>{
  it.addEventListener('click', ()=>{
    Sound.click();
    const a = it.dataset.action;
    if(a==='add') openManhwaForm();
    else if(a==='manage') openManageModal();
    else if(a==='history') openHistoryModal();
    else if(a==='export') exportData();
    else if(a==='import') $('#importFile').click();
    else if(a==='receive') openReceiveModal();
    else if(a==='update') forceUpdate();
    else if(a==='install') triggerInstall();
  });
});

/* manage all manhwa */
function openManageModal(){
  if(state.manhwa.length===0){
    openModal('จัดการข้อมูล','<p style="text-align:center;color:var(--ink-soft);padding:20px;">ยังไม่มีมังฮวาให้จัดการ</p>');
    return;
  }
  const html = `<div class="manage-list">${state.manhwa.map(m=>`
    <div class="manage-row" data-id="${m.id}">
      <div class="thumb">${m.img?`<img src="${m.img}">`:'만'}</div>
      <div class="info"><b>${escapeHTML(m.title)}</b><small>${escapeHTML(m.url)}</small></div>
      <div class="acts">
        <button data-act="edit" aria-label="แก้ไข"><svg viewBox="0 0 24 24"><path d="M4 20h4l10-10-4-4L4 16v4z" stroke="currentColor" stroke-width="2" fill="none"/></svg></button>
        <button class="del" data-act="del" aria-label="ลบ"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" fill="none"/></svg></button>
      </div>
    </div>`).join('')}</div>`;
  openModal('จัดการมังฮวา', html);
  $$('#modalBody .manage-row').forEach(row=>{
    const id = row.dataset.id;
    row.querySelector('[data-act="edit"]').onclick = ()=>{ closeModal(); openManhwaForm(id); };
    row.querySelector('[data-act="del"]').onclick = ()=> confirmDelete(`มังฮวานี้`, ()=>{
      state.manhwa = state.manhwa.filter(m=> m.id!==id);
      // also remove from collections
      state.collections.forEach(c => c.items = c.items.filter(i=> i!==id));
      saveState(); renderManhwa();
      toast('ลบแล้ว');
      openManageModal(); // refresh
    });
  });
}

/* history */
function openHistoryModal(){
  if(state.history.length===0){
    openModal('ประวัติการดู','<p style="text-align:center;color:var(--ink-soft);padding:20px;">ยังไม่มีประวัติ</p>');
    return;
  }
  const html = `
    <div class="history-list">${state.history.map(h=>{
      const d = new Date(h.openedAt);
      const time = d.toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'});
      const m = state.manhwa.find(x=>x.id===h.manhwaId);
      return `<div class="manage-row">
        <div class="thumb">${m?.img?`<img src="${m.img}">`:'만'}</div>
        <div class="info"><b>${escapeHTML(h.title)}</b><small>${time}</small></div>
        <div class="acts">${m?`<button data-mid="${m.id}" aria-label="เปิดอีกครั้ง"><svg viewBox="0 0 24 24"><path d="M14 5h5v5M19 5L10 14M5 19h7" stroke="currentColor" stroke-width="2" fill="none"/></svg></button>`:''}</div>
      </div>`;
    }).join('')}</div>
    <div class="modal-actions"><button class="btn-ghost" id="h_clear">ล้างประวัติ</button></div>
  `;
  openModal('ประวัติการดู', html);
  $$('#modalBody [data-mid]').forEach(b=> b.onclick = ()=> openManhwa(b.dataset.mid));
  $('#h_clear').onclick = ()=> confirmDelete('ประวัติทั้งหมด', ()=>{
    state.history = []; saveState(); openHistoryModal(); toast('ล้างประวัติแล้ว');
  });
}

/* -------------------- Modal core -------------------- */
let onModalClose = null; // optional callback fired when the modal is dismissed
function openModal(title, bodyHTML){
  onModalClose = null;
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHTML;
  $('#modal').hidden = false;
  // bind close buttons (data-close)
  $$('#modalBody [data-close]').forEach(b=> b.addEventListener('click', closeModal));
}
function closeModal(){
  $('#modal').hidden = true;
  const f = onModalClose; onModalClose = null;
  if(f) f();
}
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('click', e=>{ if(e.target.id==='modal') closeModal(); });

/* -------------------- Confirm dialog -------------------- */
function confirmDelete(what, onConfirm){
  Sound.warn();
  openModal('ยืนยันการลบ', `
    <div class="confirm-text">
      ต้องการลบ <b>${escapeHTML(what)}</b> ใช่หรือไม่?<br>
      การลบนี้ไม่สามารถย้อนกลับได้
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" data-close>ยกเลิก</button>
      <button class="btn-danger" id="confirmYes">
        <svg viewBox="0 0 24 24" class="ic"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" fill="none"/></svg>
        ลบ
      </button>
    </div>
  `);
  $('#confirmYes').onclick = ()=>{ closeModal(); onConfirm(); };
}

/* -------------------- Export / Import -------------------- */
function exportData(){
  const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0,10);
  a.href = url; a.download = `manhwa-backup-${ts}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('ดาวน์โหลด backup แล้ว');
  Sound.pop();
}

$('#importFile').addEventListener('change', async e=>{
  const f = e.target.files[0]; if(!f) return;
  try{
    const text = await f.text();
    const data = JSON.parse(text);
    if(!data || typeof data!=='object') throw 0;
    confirmDelete('ข้อมูลปัจจุบันทั้งหมด (จะถูกแทนที่)', async ()=>{
      state = {
        manhwa: data.manhwa||[],
        collections: data.collections||[],
        heroines: data.heroines||[],
        history: data.history||[],
      };
      await saveState();
      renderManhwa();
      toast('นำเข้าข้อมูลแล้ว');
      showPage('manhwa');
    });
  }catch(_){
    toast('ไฟล์ไม่ถูกต้อง'); Sound.warn();
  }
  e.target.value='';
});

/* ===========================================================
   SHARE SYSTEM
   No server: the selected items are serialised -> deflate -> base64url
   and placed in the URL hash:  https://your-app/#share=<code>
   The hash never leaves the browser, so nothing is uploaded anywhere.
=========================================================== */

/* ---------- encoding helpers ---------- */
function b64uEnc(bytes){
  let bin = '';
  for(let i=0;i<bytes.length;i+=0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i,i+0x8000));
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64uDec(str){
  str = str.replace(/-/g,'+').replace(/_/g,'/');
  while(str.length % 4) str += '=';
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function pipeBytes(bytes, transform, cap=Infinity){
  const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader();
  const chunks = []; let total = 0;
  for(;;){
    const {done, value} = await reader.read();
    if(done) break;
    total += value.length;
    if(total > cap){ reader.cancel(); throw new Error('too-big'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total); let o = 0;
  for(const c of chunks){ out.set(c,o); o += c.length; }
  return out;
}
const MAX_DECODED_BYTES = 4 * 1024 * 1024;   // zip-bomb guard
const MAX_ITEMS = 100;

async function encodeShare(obj){
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if(typeof CompressionStream === 'function'){
    try{ return 'z' + b64uEnc(await pipeBytes(bytes, new CompressionStream('deflate-raw'))); }catch(_){}
  }
  return 'p' + b64uEnc(bytes);                // uncompressed fallback
}
async function decodeShare(code){
  const kind = code[0], bytes = b64uDec(code.slice(1));
  let out;
  if(kind === 'z'){
    if(typeof DecompressionStream !== 'function') throw new Error('no-decompress');
    out = await pipeBytes(bytes, new DecompressionStream('deflate-raw'), MAX_DECODED_BYTES);
  } else if(kind === 'p'){
    if(bytes.length > MAX_DECODED_BYTES) throw new Error('too-big');
    out = bytes;
  } else throw new Error('bad-kind');
  return JSON.parse(new TextDecoder().decode(out));
}

/* ---------- incoming data validation (never trust a link) ---------- */
function safeHttpUrl(u){
  try{
    const p = new URL(String(u||'').trim());
    return (p.protocol==='http:' || p.protocol==='https:') ? p.href : '';
  }catch(_){ return ''; }
}
const normKey = u => (safeHttpUrl(u) || String(u||'').trim()).replace(/\/+$/,'').toLowerCase();

function sanitizeIncoming(payload){
  if(!payload || payload.v !== 1 || !Array.isArray(payload.items)) throw new Error('bad-payload');
  return payload.items.slice(0, MAX_ITEMS).map(x=>{
    if(!x || typeof x !== 'object') return null;
    const url = safeHttpUrl(x.u);                       // only http(s) links
    const title = String(x.t||'').trim().slice(0,200);
    if(!url || !title) return null;
    const desc = String(x.d||'').trim().slice(0,1000);
    const b64 = typeof x.i === 'string' ? x.i : '';
    const img = (b64 && b64.length < 150000 && /^[A-Za-z0-9+/=]+$/.test(b64))
      ? 'data:image/jpeg;base64,' + b64 : '';
    return {title, url, desc, img};
  }).filter(Boolean);
}

/* find a share code inside a full URL, "#share=..." or a bare code */
function extractShareCode(text){
  const t = String(text||'').trim();
  if(!t) return '';
  const m = t.match(/share=([A-Za-z0-9_-]+)/);
  if(m) return m[1];
  const bare = t.replace(/\s+/g,'');
  return /^[zp][A-Za-z0-9_-]{8,}$/.test(bare) ? bare : '';
}
function clearShareHash(){
  if(/share=/.test(location.hash)){
    try{ history.replaceState(null, '', location.pathname + location.search); }catch(_){ location.hash=''; }
  }
}

/* ---------- selection mode ---------- */
let selectMode = false;
const selectedIds = new Set();

function setSelectMode(on){
  selectMode = on;
  selectedIds.clear();
  document.body.classList.toggle('selecting', on);
  $('#selectBar').hidden = !on;
  renderManhwa();
  if(on) updateSelectBar();
}
function updateSelectBar(){
  const n = selectedIds.size;
  $('#selCount').innerHTML = '<span class="lbl">เลือก </span>' + n;
  $('#selShare').disabled = n === 0;
  $('#selDelete').disabled = n === 0;
  $('#selAll').textContent = (n === state.manhwa.length && n > 0) ? 'ล้าง' : 'ทั้งหมด';
}
$('#btnSelectMode').addEventListener('click', ()=>{ Sound.click(); setSelectMode(true); });
$('#selCancel').addEventListener('click', ()=>{ Sound.click(); setSelectMode(false); });
$('#selAll').addEventListener('click', ()=>{
  Sound.click();
  if(selectedIds.size === state.manhwa.length) selectedIds.clear();
  else state.manhwa.forEach(m=> selectedIds.add(m.id));
  $$('#manhwaGrid .card').forEach(c=> c.classList.toggle('selected', selectedIds.has(c.dataset.id)));
  updateSelectBar();
});
$('#manhwaGrid').addEventListener('click', e=>{
  if(!selectMode) return;
  const card = e.target.closest('.card'); if(!card) return;
  const id = card.dataset.id;
  if(selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  card.classList.toggle('selected', selectedIds.has(id));
  Sound.click();
  updateSelectBar();
});
$('#selShare').addEventListener('click', ()=>{
  if(selectedIds.size) openShareModal();
});
$('#selDelete').addEventListener('click', ()=>{
  const ids = new Set(selectedIds);
  if(!ids.size) return;
  confirmDelete(`มังฮวาที่เลือก ${ids.size} เรื่อง`, ()=>{
    state.manhwa = state.manhwa.filter(m=> !ids.has(m.id));
    state.collections.forEach(c => c.items = c.items.filter(i=> !ids.has(i)));  // keep collections consistent
    selectedIds.clear();
    saveState();
    renderManhwa();          // stays in select mode (resets itself if the library is now empty)
    toast(`ลบแล้ว ${ids.size} เรื่อง`);
  });
});

/* ---------- thumbnails (keep the link short) ---------- */
const thumbCache = new Map();
function makeThumb(dataURL, maxW=90, quality=0.5){
  if(thumbCache.has(dataURL)) return Promise.resolve(thumbCache.get(dataURL));
  return new Promise(res=>{
    const img = new Image();
    img.onload = ()=>{
      try{
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width*scale));
        c.height = Math.max(1, Math.round(img.height*scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', quality).split(',')[1] || '';
        thumbCache.set(dataURL, out); res(out);
      }catch(_){ res(''); }
    };
    img.onerror = ()=> res('');
    img.src = dataURL;
  });
}

async function buildShareURL(items, withImg){
  const payload = {v:1, items:[]};
  for(const m of items){
    const o = {t:m.title, u:m.url};
    if(m.desc) o.d = m.desc;
    if(withImg && m.img){ const t = await makeThumb(m.img); if(t) o.i = t; }
    payload.items.push(o);
  }
  const base = location.href.split('#')[0];
  return base + '#share=' + await encodeShare(payload);
}

/* ---------- share modal ---------- */
function copyText(text, inputEl){
  if(navigator.clipboard && window.isSecureContext){
    return navigator.clipboard.writeText(text);
  }
  return new Promise((res, rej)=>{
    try{
      inputEl.focus(); inputEl.select();
      document.execCommand('copy') ? res() : rej();
    }catch(e){ rej(e); }
  });
}

async function openShareModal(){
  const items = state.manhwa
    .filter(m => selectedIds.has(m.id))
    .sort((a,b)=> b.createdAt - a.createdAt);
  if(!items.length) return;
  const hasAnyImg = items.some(m=> m.img);
  const isLocal = location.protocol==='file:' || /^(localhost|127\.|192\.168\.|10\.|\[?::1)/.test(location.hostname);
  const canNativeShare = typeof navigator.share === 'function';

  openModal('แชร์มังฮวา', `
    <div class="share-sum">กำลังแชร์ <b>${items.length}</b> เรื่อง — คนที่เปิดลิงก์จะเห็นตัวอย่างก่อน แล้วเลือกรับหรือปฏิเสธได้</div>
    ${hasAnyImg ? `
    <label class="toggle-row">
      <input type="checkbox" id="s_img" checked>
      <span>แนบรูปปก (ย่อขนาด)<small>ลิงก์จะยาวขึ้น ถ้าส่งผ่านแชตแล้วลิงก์ขาด ให้ปิดตัวเลือกนี้</small></span>
    </label>` : ''}
    <div class="field">
      <label>ลิงก์แชร์</label>
      <input type="text" class="share-url" id="s_url" readonly value="กำลังสร้างลิงก์...">
      <div class="share-meta" id="s_meta"></div>
    </div>
    ${isLocal ? `<div class="share-note">ตอนนี้เปิดแอปจากที่อยู่ในเครื่อง (${escapeHTML(location.hostname||'file')}) — คนอื่นจะเปิดลิงก์นี้ไม่ได้จนกว่าจะ deploy แอปขึ้นเว็บ (Netlify / GitHub Pages ฯลฯ)</div>` : ''}
    <div class="modal-actions">
      ${canNativeShare ? '<button class="btn-ghost" id="s_native" disabled>แชร์ผ่านแอป</button>' : ''}
      <button class="btn-primary" id="s_copy" disabled>คัดลอกลิงก์</button>
    </div>
  `);

  let token = 0, currentURL = '';
  const urlInput = $('#s_url'), meta = $('#s_meta');
  const copyBtn = $('#s_copy'), nativeBtn = $('#s_native');

  async function build(){
    const my = ++token;
    copyBtn.disabled = true; if(nativeBtn) nativeBtn.disabled = true;
    urlInput.value = 'กำลังสร้างลิงก์...';
    const withImg = hasAnyImg ? $('#s_img').checked : false;
    let url;
    try{ url = await buildShareURL(items, withImg); }
    catch(_){ if(my===token){ urlInput.value=''; meta.textContent='สร้างลิงก์ไม่สำเร็จ'; meta.className='share-meta warn'; } return; }
    if(my !== token) return;              // a newer build superseded this one
    currentURL = url;
    urlInput.value = url;
    const len = url.length;
    meta.textContent = `ความยาวลิงก์ ${len.toLocaleString()} ตัวอักษร`;
    meta.className = 'share-meta';
    if(len > 8000){
      meta.textContent += ' — ยาวมาก บางแอปแชทอาจตัดลิงก์ ลองปิดรูปปกหรือแชร์ทีละน้อยลง';
      meta.className = 'share-meta warn';
    }
    copyBtn.disabled = false; if(nativeBtn) nativeBtn.disabled = false;
  }
  if(hasAnyImg) $('#s_img').addEventListener('change', build);
  urlInput.addEventListener('focus', ()=> urlInput.select());

  copyBtn.addEventListener('click', async ()=>{
    try{ await copyText(currentURL, urlInput); toast('คัดลอกลิงก์แล้ว'); Sound.pop(); }
    catch(_){ urlInput.select(); toast('กดค้างที่ช่องลิงก์เพื่อคัดลอก'); }
  });
  if(nativeBtn) nativeBtn.addEventListener('click', async ()=>{
    try{ await navigator.share({title:'만화 — Manhwa Library', text:`แชร์มังฮวา ${items.length} เรื่อง`, url: currentURL}); }
    catch(_){ /* user cancelled */ }
  });
  build();
}

/* ---------- receive: preview + accept / deny ---------- */
function hostOf(u){ try{ return new URL(u).hostname.replace(/^www\./,''); }catch(_){ return u; } }

async function showReceive(code, fromHash){
  let items;
  try{
    items = sanitizeIncoming(await decodeShare(code));
  }catch(err){
    const old = err && err.message === 'no-decompress';
    toast(old ? 'เบราว์เซอร์นี้เก่าเกินไปสำหรับลิงก์นี้' : 'ลิงก์แชร์ไม่ถูกต้องหรือไม่สมบูรณ์');
    Sound.warn();
    if(fromHash) clearShareHash();
    return false;
  }
  if(!items.length){
    toast('ลิงก์นี้ไม่มีรายการที่ใช้ได้');
    if(fromHash) clearShareHash();
    return false;
  }
  const have = new Set(state.manhwa.map(m=> normKey(m.url)));
  const seen = new Set();
  items.forEach(it=>{
    const k = normKey(it.url);
    it.dup = have.has(k) || seen.has(k);   // already in library (or repeated inside the link)
    seen.add(k);
  });
  const newCount = items.filter(i=>!i.dup).length;

  const rows = items.map((it,i)=>`
    <label class="manage-row recv-row ${it.dup?'off':''}">
      <input type="checkbox" data-i="${i}" ${it.dup?'':'checked'}>
      <div class="thumb">${it.img?`<img src="${it.img}" alt="">`:'만'}</div>
      <div class="info">
        <b>${escapeHTML(it.title)}</b>
        <small class="host">${escapeHTML(hostOf(it.url))}</small>
        ${it.desc?`<div class="rdesc">${escapeHTML(it.desc)}</div>`:''}
      </div>
      ${it.dup?'<span class="badge-dup">มีอยู่แล้ว</span>':''}
    </label>`).join('');

  openModal('มีคนแชร์มังฮวามาให้คุณ', `
    <div class="recv-intro">ได้รับ <b>${items.length}</b> เรื่อง — ติ๊กเลือกเรื่องที่ต้องการเก็บ แล้วกด <b>ยอมรับ</b></div>
    <div class="recv-bar"><span id="rv_count"></span><button id="rv_all"></button></div>
    <div class="recv-list">${rows}</div>
    <div class="recv-hint">ตัวอย่างนี้ยังไม่ถูกบันทึก — จะเพิ่มเข้าคลังเมื่อกด “ยอมรับ” เท่านั้น ตรวจสอบโดเมนของลิงก์ก่อนเปิดเสมอ</div>
    <div class="modal-actions">
      <button class="btn-ghost" id="rv_deny">ปฏิเสธ</button>
      <button class="btn-primary" id="rv_accept">ยอมรับ</button>
    </div>
  `);
  onModalClose = ()=> clearShareHash();   // closing the preview = not accepted; don't re-show on reload

  const boxes = [...$$('#modalBody .recv-row input')];
  function refresh(){
    const n = boxes.filter(b=>b.checked).length;
    $('#rv_count').textContent = `เลือกแล้ว ${n} / ${items.length}`;
    $('#rv_accept').textContent = n ? `ยอมรับ (${n})` : 'ยอมรับ';
    $('#rv_accept').disabled = n === 0;
    $('#rv_all').textContent = n === items.length ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด';
    boxes.forEach(b=>{ const r=b.closest('.recv-row'); r.classList.toggle('off', !b.checked); r.classList.toggle('on', b.checked); });
  }
  boxes.forEach(b=> b.addEventListener('change', refresh));
  $('#rv_all').addEventListener('click', ()=>{
    const all = boxes.every(b=>b.checked);
    boxes.forEach(b=> b.checked = !all);
    refresh();
  });
  refresh();

  $('#rv_deny').addEventListener('click', ()=>{
    closeModal();                          // hook clears the hash
    toast('ปฏิเสธแล้ว'); Sound.soft();
  });
  $('#rv_accept').addEventListener('click', ()=>{
    const picked = boxes.filter(b=>b.checked).map(b=> items[+b.dataset.i]);
    if(!picked.length) return;
    const now = Date.now();
    picked.forEach((it,idx)=>{
      // keep the shared order: earlier in the list = newer createdAt
      state.manhwa.push({id:uid(), title:it.title, url:it.url, desc:it.desc, img:it.img, createdAt: now + (picked.length-idx)});
    });
    saveState();
    closeModal();
    if(selectMode) setSelectMode(false);
    showPage('manhwa');
    toast(`เพิ่ม ${picked.length} เรื่องเข้าคลังแล้ว`); Sound.pop();
  });
  return true;
}

/* ---------- "Receive from URL" (More menu) ---------- */
function openReceiveModal(){
  const canPaste = !!(navigator.clipboard && navigator.clipboard.readText);
  openModal('รับจาก URL', `
    <div class="field">
      <label>วางลิงก์แชร์ที่ได้รับ</label>
      <textarea id="r_in" placeholder="https://.../#share=..." spellcheck="false" autocomplete="off"></textarea>
    </div>
    <div class="recv-hint" style="margin-top:-6px;margin-bottom:6px;">จะแสดงตัวอย่างให้ดูก่อน ยังไม่เพิ่มอะไรเข้าคลังจนกว่าจะกดยอมรับ</div>
    <div class="modal-actions">
      ${canPaste ? '<button class="btn-ghost" id="r_paste">วางจากคลิปบอร์ด</button>' : ''}
      <button class="btn-primary" id="r_go">ดูตัวอย่าง</button>
    </div>
  `);
  const input = $('#r_in');
  const go = async ()=>{
    const code = extractShareCode(input.value);
    if(!code){ toast('ไม่พบลิงก์แชร์ในข้อความนี้'); Sound.warn(); return; }
    await showReceive(code, false);
  };
  $('#r_go').addEventListener('click', go);
  input.addEventListener('paste', ()=> setTimeout(()=>{ if(extractShareCode(input.value)) go(); }, 0));
  if(canPaste) $('#r_paste').addEventListener('click', async ()=>{
    try{ input.value = await navigator.clipboard.readText(); go(); }
    catch(_){ toast('อ่านคลิปบอร์ดไม่ได้ กรุณากดวางเอง'); }
  });
  setTimeout(()=> input.focus(), 50);
}

/* -------------------- PWA service worker -------------------- */
const APP_VERSION = '3';   // keep in step with CACHE in sw.js (manhwa-v3)
$('#appVersion').textContent = 'เวอร์ชัน ' + APP_VERSION + ' · แตะเพื่อดึงเวอร์ชันล่าสุด';

if('serviceWorker' in navigator){
  // only register on real (not iframe) contexts
  const isInIframe = (()=>{ try{ return window.self!==window.top; }catch(_){ return true; }})();
  if(!isInIframe){
    window.addEventListener('load', async ()=>{
      try{
        const hadController = !!navigator.serviceWorker.controller;
        // updateViaCache:'none' -> the browser never trusts GitHub Pages' cached copy of sw.js
        const reg = await navigator.serviceWorker.register('sw.js', {updateViaCache:'none'});
        reg.update().catch(()=>{});
        // PWAs stay alive in the background: re-check whenever the app comes back to the foreground
        document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) reg.update().catch(()=>{}); });
        // a new service worker took over -> reload once so the new code actually runs
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', ()=>{
          if(!hadController || reloaded) return;          // first install: nothing to refresh
          if(!$('#modal').hidden){ toast('มีเวอร์ชันใหม่ — ปิดแล้วเปิดแอปใหม่เพื่ออัปเดต'); return; }  // don't wipe a form mid-edit
          reloaded = true; location.reload();
        });
      }catch(_){}
    });
  }
}

/* manual "pull the latest version" — clears app caches only; your library (IndexedDB) is untouched */
async function forceUpdate(){
  toast('กำลังอัปเดต...');
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=> r.unregister()));
    }
    if(window.caches){
      const keys = await caches.keys();
      await Promise.all(keys.map(k=> caches.delete(k)));
    }
    // refresh the browser's HTTP cache too (GitHub Pages sends max-age=600)
    await Promise.all(['./','index.html','style.css','script.js','manifest.json','sw.js']
      .map(u=> fetch(u, {cache:'reload'}).catch(()=>{})));
  }catch(_){}
  location.reload();
}



/* -------------------- PWA install prompt -------------------- */
let deferredInstallPrompt = null;
function showInstallItem(show){
  const el = document.getElementById('installItem');
  if(el) el.hidden = !show;
}
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallItem(true);
});
window.addEventListener('appinstalled', ()=>{
  deferredInstallPrompt = null;
  showInstallItem(false);
  toast('ติดตั้งสำเร็จ');
});
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}
async function triggerInstall(){
  // Already installed
  if(isStandalone()){
    toast('แอปถูกติดตั้งแล้ว');
    return;
  }
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    showInstallItem(false);
    if(outcome === 'accepted') toast('กำลังติดตั้ง...');
    return;
  }
  // No prompt available — show manual instructions (iOS Safari, unsupported browsers)
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  let how;
  if(isIOS){
    how = 'บน iPhone/iPad: กดปุ่ม <b>แชร์</b> (รูปสี่เหลี่ยมมีลูกศรขึ้น) ที่แถบล่างของ Safari แล้วเลือก <b>Add to Home Screen / เพิ่มที่หน้าจอโฮม</b>';
  } else if(isAndroid){
    how = 'บน Android: กดเมนู <b>⋮</b> ที่มุมขวาบนของ Chrome แล้วเลือก <b>Install app / ติดตั้งแอป</b> หรือ <b>Add to Home screen</b>';
  } else {
    how = 'บนคอม: ที่ Chrome/Edge กดไอคอน <b>ติดตั้ง</b> ที่ปลายขวาของแถบที่อยู่ (address bar) หรือเปิดเมนูแล้วเลือก <b>Install Manhwa Library</b>';
  }
  openModal('ติดตั้งเป็นแอป', `
    <div class="confirm-text">
      เบราว์เซอร์นี้ไม่รองรับการกดติดตั้งโดยตรง<br><br>
      วิธีติดตั้งด้วยตัวเอง:<br>${how}<br><br>
      <small style="color:var(--ink-soft)">หมายเหตุ: ต้องเปิดผ่าน https:// (หรือ localhost) เท่านั้น ไฟล์โลคัล file:// จะติดตั้งไม่ได้</small>
    </div>
    <div class="modal-actions"><button class="btn-primary" data-close>เข้าใจแล้ว</button></div>
  `);
}
// Hide install item when running as installed PWA
if(isStandalone()) showInstallItem(false);

/* -------------------- Init -------------------- */
(async function init(){
  await loadState();
  renderManhwa();
  // opened via a share link?
  const code = extractShareCode(location.hash);
  if(code) showReceive(code, true);
})();
window.addEventListener('hashchange', ()=>{
  const code = extractShareCode(location.hash);
  if(code) showReceive(code, true);
});
