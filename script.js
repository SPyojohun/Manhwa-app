/* ===========================================================
   만화 — Manhwa Library
   - IndexedDB persistence (resists cache clearing)
   - JSON Export/Import for backup
   - PWA installable
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
function manhwaCard(m){
  const img = m.img
    ? `<img src="${m.img}" alt="${escapeHTML(m.title)}" loading="lazy">`
    : placeholderImg();
  return `
    <div class="card" data-id="${m.id}">
      <div class="card-img">${img}</div>
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
function renderManhwa(){
  const grid = $('#manhwaGrid');
  $('#manhwaCount').textContent = state.manhwa.length + ' เรื่อง';
  if(state.manhwa.length===0){
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
function openModal(title, bodyHTML){
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHTML;
  $('#modal').hidden = false;
  // bind close buttons (data-close)
  $$('#modalBody [data-close]').forEach(b=> b.addEventListener('click', closeModal));
}
function closeModal(){ $('#modal').hidden = true; }
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

/* -------------------- PWA service worker -------------------- */
if('serviceWorker' in navigator){
  // only register on real (not iframe) contexts
  const isInIframe = (()=>{ try{ return window.self!==window.top; }catch(_){ return true; }})();
  if(!isInIframe){
    window.addEventListener('load', ()=> navigator.serviceWorker.register('sw.js').catch(()=>{}));
  }
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
})();
