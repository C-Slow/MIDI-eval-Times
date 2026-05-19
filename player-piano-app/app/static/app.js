async function api(path, method='GET', body=null) {
  const opts = { method, headers: {} };
  
  // Add auth token if present
  const token = localStorage.getItem('piano_token');
  if (token) {
    opts.headers['Authorization'] = `Bearer ${token}`;
  }

  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    opts.body = body;
  }
  
  const res = await fetch(path, opts);
  if (res.status === 401) {
    // Session expired or invalid
    localStorage.removeItem('piano_token');
    showAuth(true);
    throw new Error('Unauthorized');
  }
  return res.json();
}

function showAuth(visible) {
  if (visible) {
    document.body.classList.add('auth-hidden');
  } else {
    document.body.classList.remove('auth-hidden');
  }
}

async function doLogin() {
  const pass = document.getElementById('loginPass').value;
  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem('piano_token', data.token);
      showAuth(false);
      init(); // Re-init everything
    } else {
      alert('Invalid password');
    }
  } catch (e) {
    console.error(e);
    alert('Login error');
  }
}

function logout() {
  localStorage.removeItem('piano_token');
  location.reload();
}

document.getElementById('loginBtn').onclick = doLogin;
document.getElementById('loginPass').onkeydown = (e) => { if(e.key === 'Enter') doLogin(); };
document.getElementById('logoutBtn').onclick = logout;

document.getElementById('savePassword').onclick = async () => {
  const newPass = document.getElementById('newPassword').value.trim();
  if(!newPass) return;
  if(!confirm('This will change the master password. You will need to log in again on all devices. Continue?')) return;
  
  const s = await api('/settings') || {};
  s.password = newPass;
  await api('/settings','POST', s);
  alert('Password updated. Logging out...');
  logout();
};

async function refreshFiles(){
  const data = await api('/files');
  const el = document.getElementById('files');
  el.innerHTML = '';
  ['raw','processed'].forEach(k=>{
    const container = document.createElement('div');
    container.className = 'file-group';
    const header = document.createElement('div'); header.className='group-header';
    const h = document.createElement('h3'); h.textContent = k; header.appendChild(h);
    const toggle = document.createElement('button'); toggle.textContent='▸'; 
    toggle.onclick = ()=>{
      if(list.style.display === 'none'){
        list.style.display = '';
        toggle.textContent = '▾';
      } else {
        list.style.display = 'none';
        toggle.textContent = '▸';
      }
    };
    header.appendChild(toggle);
    container.appendChild(header);
    const list = document.createElement('ul');
    list.style.display = 'none'; // Default to collapsed
      (data[k]||[]).forEach(f=>{
      const li = document.createElement('li'); li.className='file-item';
      const nameSpan = document.createElement('span'); nameSpan.textContent = f.name + ' '; nameSpan.className='file-name';
      
      // Show metadata badges
      if(f.metadata){
        if(f.metadata.clean_profile){
          const b = document.createElement('span'); b.className='muted'; b.style.marginLeft='6px';
          b.textContent = `[${f.metadata.clean_profile}]`;
          nameSpan.appendChild(b);
        }
        if(f.metadata.tempo_factor && f.metadata.tempo_factor !== 1.0){
          const b = document.createElement('span'); b.className='muted'; b.style.marginLeft='6px';
          b.textContent = `(x${f.metadata.tempo_factor})`;
          nameSpan.appendChild(b);
        }
      }
      li.appendChild(nameSpan);
      const len = document.createElement('span'); len.className='muted'; len.style.marginLeft='8px';
      if(f.length) len.textContent = `(${formatTime(f.length)})`;
      li.appendChild(len);

      const play = document.createElement('button'); play.textContent='▶';
      play.title = 'Preview Locally';
      play.onclick = async ()=>{
        await previewMidi(f.name);
      };
      li.appendChild(play);

      const rename = document.createElement('button'); rename.textContent='✎';
      rename.title = 'Rename';
      rename.onclick = async ()=>{
        const nv = prompt('New name:', f.name);
        if(!nv) return;
        await api('/files/rename_json','POST',{old:f.name, new:nv});
        setTimeout(refreshFiles, 300);
      };
      li.appendChild(rename);

      // Add Clean button for raw files only
      if(k === 'raw'){
        const cleanBtn = document.createElement('button'); cleanBtn.textContent = '🧹';
        cleanBtn.title = 'Clean';
        cleanBtn.onclick = async ()=>{
          try{
            await api('/process/clean','POST',{filename: f.name, profile: 'soft'});
            setTimeout(refreshFiles, 700);
          }catch(e){ console.error('clean failed', e); alert('Clean failed') }
        };
        li.appendChild(cleanBtn);
      }

      // Add tempo/send buttons for processed files only
      if(k === 'processed'){
        // Tempo adjust (prompt for factor)
        const tempoBtn = document.createElement('button'); tempoBtn.textContent = '♩';
        tempoBtn.title = 'Adjust tempo';
        tempoBtn.onclick = async ()=>{
          const cur = (f.metadata && f.metadata.tempo_factor) ? f.metadata.tempo_factor.toString() : '1.0';
          const v = prompt('Tempo factor (e.g. 1.2 = faster, 0.8 = slower)', cur);
          if(!v) return;
          const fct = parseFloat(v);
          if(isNaN(fct) || fct <= 0){ alert('Invalid factor'); return; }
          try{
            await api('/process/tempo','POST',{filename: f.name, factor: fct});
            setTimeout(refreshFiles, 700);
          }catch(e){ console.error('tempo failed', e); alert('Tempo adjust failed') }
        };
        li.appendChild(tempoBtn);

        // Send to Disklavier (right arrow)
        const send = document.createElement('button'); send.textContent='➜';
        send.title = 'Send to Disklavier';
        send.onclick = ()=> sendToDisk(f.name);
        li.appendChild(send);

        // Add to playlist (+)
        const addPl = document.createElement('button'); addPl.textContent='+';
        addPl.title = 'Add to Playlist';
        addPl.onclick = (e)=> showPlaylistPicker(e, f.name);
        li.appendChild(addPl);

        // delete
        const del = document.createElement('button'); del.textContent='🗑'; del.title='Delete';
        del.onclick = async ()=>{ if(!confirm('Delete '+f.name+'?')) return; await api('/files/delete','POST',{filename:f.name}); setTimeout(refreshFiles,300)};
        li.appendChild(del);
      }
      // delete for raw files (next to clean)
      if(k === 'raw'){
        const delr = document.createElement('button'); delr.textContent='🗑'; delr.title='Delete';
        delr.onclick = async ()=>{ if(!confirm('Delete '+f.name+'?')) return; await api('/files/delete','POST',{filename:f.name}); setTimeout(refreshFiles,300)};
        li.appendChild(delr);
      }
      list.appendChild(li);
    });
    container.appendChild(list);
    el.appendChild(container);
  });
}

function formatTime(sec){
  if(!sec && sec !== 0) return '00:00';
  sec = Math.floor(sec);
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = (sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

async function refreshOutputs(){
  const res = await api('/midi-outputs');
  const sel = document.getElementById('midiOutputs');
  sel.innerHTML = '';
  const outs = res.outputs || [];
  if(outs.length===0){
    const opt = document.createElement('option'); opt.textContent='(no outputs)'; sel.appendChild(opt);
    return;
  }
  outs.forEach(o=>{ const opt=document.createElement('option'); opt.value=o; opt.textContent=o; sel.appendChild(opt)});
}

async function refreshPlaylists(){
  const data = await api('/playlists');
  const el = document.getElementById('playlists');
  el.innerHTML = '';
  
  for(const name in data){
    const container = document.createElement('div');
    container.className = 'playlist-container';
    
    const details = document.createElement('details');
    
    const summary = document.createElement('summary');
    summary.className = 'playlist-header';
    const h4 = document.createElement('h4'); h4.textContent = name;
    summary.appendChild(h4);
    
    const delPlaylist = document.createElement('button');
    delPlaylist.textContent = '🗑'; delPlaylist.title = 'Delete Playlist';
    delPlaylist.onclick = async (e) => {
      e.preventDefault();
      if(!confirm(`Delete playlist "${name}"?`)) return;
      await api(`/playlists/${encodeURIComponent(name)}/delete`, 'POST');
      refreshPlaylists();
    };
    summary.appendChild(delPlaylist);
    details.appendChild(summary);

    const controls = document.createElement('div');
    controls.className = 'playlist-controls';
    
    const play = document.createElement('button'); play.textContent='▶ Play All';
    play.onclick = async () => {
      const port = document.getElementById('defaultPort').value.trim() || null;
      const repeat = repeatCheck.checked;
      await api(`/playlists/${encodeURIComponent(name)}/play`, 'POST', { port_name: port, repeat: repeat });
    };
    controls.appendChild(play);
    
    const shuffle = document.createElement('button'); shuffle.textContent='🔀 Shuffle';
    shuffle.onclick = async () => {
      const port = document.getElementById('defaultPort').value.trim() || null;
      const repeat = repeatCheck.checked;
      await api(`/playlists/${encodeURIComponent(name)}/play`, 'POST', { shuffle: true, port_name: port, repeat: repeat });
    };
    controls.appendChild(shuffle);

    const repeatLabel = document.createElement('label');
    repeatLabel.style.marginLeft = '10px';
    repeatLabel.style.display = 'flex';
    repeatLabel.style.alignItems = 'center';
    repeatLabel.style.gap = '4px';
    const repeatCheck = document.createElement('input');
    repeatCheck.type = 'checkbox';
    repeatLabel.appendChild(repeatCheck);
    repeatLabel.appendChild(document.createTextNode('Repeat'));
    controls.appendChild(repeatLabel);
    
    details.appendChild(controls);

    const listDiv = document.createElement('div');
    listDiv.className = 'playlist-items';
    const ul = document.createElement('ul');
    (data[name]||[]).forEach(fn => {
      const li = document.createElement('li');
      li.className = 'playlist-item';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = fn;
      li.appendChild(nameSpan);
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✕';
      removeBtn.className = 'remove-item';
      removeBtn.onclick = () => removeFromPlaylist(name, fn);
      li.appendChild(removeBtn);
      ul.appendChild(li);
    });
    listDiv.appendChild(ul);
    details.appendChild(listDiv);
    container.appendChild(details);
    el.appendChild(container);
  }
}

async function removeFromPlaylist(playlistName, filename) {
  await api(`/playlists/${encodeURIComponent(playlistName)}/remove`, 'POST', { filename });
  refreshPlaylists();
}

async function showPlaylistPicker(event, filename) {
  const data = await api('/playlists');
  const names = Object.keys(data);
  if(names.length === 0) return alert('Create a playlist first');
  const select = document.createElement('select');
  select.className = 'playlist-picker';
  const def = document.createElement('option'); def.textContent = 'Add to...'; def.disabled = true; def.selected = true;
  select.appendChild(def);
  names.forEach(n => {
    const opt = document.createElement('option'); opt.value = n; opt.textContent = n;
    select.appendChild(opt);
  });
  select.onchange = async () => {
    await api(`/playlists/${encodeURIComponent(select.value)}/add`, 'POST', {filename});
    refreshPlaylists();
    select.remove();
  };
  select.onblur = () => select.remove();
  event.target.parentElement.insertBefore(select, event.target.nextSibling);
  select.focus();
}

document.getElementById('uploadBtn').onclick = async ()=>{
  const input = document.getElementById('fileInput');
  if(!input.files.length) return alert('select file');
  const fd = new FormData(); fd.append('file', input.files[0]);
  await api('/upload','POST', fd);
  const processAfter = document.getElementById('processAfterUpload') && document.getElementById('processAfterUpload').checked;
  setTimeout(refreshFiles, 300);
  if(processAfter){
    const fname = input.files[0].name;
    try{
      await api('/process/clean','POST',{filename: fname, profile: 'soft'});
      setTimeout(refreshFiles, 800);
    }catch(e){ console.error(e) }
  }
};

document.getElementById('createPlaylist').onclick = async ()=>{
  const name = document.getElementById('newPlaylist').value.trim();
  if(!name) return;
  await api('/playlists','POST',{name});
  document.getElementById('newPlaylist').value='';
  setTimeout(refreshPlaylists, 200);
};

const nextBtn = document.getElementById('next');
if(nextBtn) nextBtn.onclick = ()=> api('/queue/next','POST');

document.getElementById('refreshOutputs').onclick = ()=> refreshOutputs();

async function init(){
  console.log('App initializing...');
  try { await loadSettings(); } catch(e) {}
  try { await refreshFiles(); } catch(e) {}
  try { await refreshPlaylists(); } catch(e) {}
  try { await refreshOutputs(); } catch(e) {}
  try { pollStatus(); } catch(e) {}
}

window.addEventListener('DOMContentLoaded', init);

function applyTheme(theme){
  if(theme === 'dark') document.body.classList.add('dark');
  else document.body.classList.remove('dark');
}

document.getElementById('themeToggle').onclick = async ()=>{
  try{
    const s = await api('/settings') || {};
    const next = s.theme === 'dark' ? 'light' : 'dark';
    s.theme = next;
    await api('/settings','POST', s);
    applyTheme(next);
    const icon = document.getElementById('themeIcon');
    const text = document.getElementById('themeText');
    if(icon) icon.textContent = next === 'dark' ? '🌙' : '☀️';
    if(text) text.textContent = next === 'dark' ? 'Dark' : 'Light';
  }catch(e){}
}

async function loadSettings(){
  try{
    const s = await api('/settings');
    if(s){
      if(s.default_port) document.getElementById('defaultPort').value = s.default_port;
      if(s.target_device) document.getElementById('targetDevice').value = s.target_device;
      if(s.theme) {
        applyTheme(s.theme);
        const icon = document.getElementById('themeIcon');
        const text = document.getElementById('themeText');
        if(icon) icon.textContent = s.theme === 'dark' ? '🌙' : '☀️';
        if(text) text.textContent = s.theme === 'dark' ? 'Dark' : 'Light';
      }
    }
  }catch(e){}
}

document.getElementById('saveDefault').onclick = async ()=>{
  const port = document.getElementById('defaultPort').value.trim();
  const s = await api('/settings') || {};
  s.default_port = port;
  await api('/settings','POST', s);
  alert('Saved');
}

document.getElementById('saveTargetDevice').onclick = async ()=>{
  const dev = document.getElementById('targetDevice').value.trim();
  const s = await api('/settings') || {};
  s.target_device = dev;
  await api('/settings','POST', s);
  alert('Saved');
}

async function sendToDisk(filename){
  const s = await api('/settings');
  const port = s.default_port || null;
  await api('/play','POST',{filename, port_name: port});
}

// Web Audio Preview Engine (Strictly Local)
let audioCtx = null;
let piano = null;
let midiPlayer = null;
let previewActive = false;
let currentPreviewFile = null;
let isSeekingLocal = false;
let isSeekingPlaylist = false; // Added missing variable

/**
 * Ensures AudioContext exists and is resumed. 
 * MUST be called directly in a user interaction handler.
 */
async function ensureAudioContext() {
  if (!audioCtx) {
    console.log('Creating new AudioContext...');
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    console.log('Resuming AudioContext...');
    await audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Loads the soundfont instrument if not already loaded.
 */
async function loadPiano() {
  if (piano) return piano;
  await ensureAudioContext();
  console.log('Loading soundfont (acoustic_grand_piano)...');
  try {
    piano = await Soundfont.instrument(audioCtx, 'acoustic_grand_piano');
    console.log('Soundfont loaded successfully.');
    return piano;
  } catch (err) {
    console.error('Failed to load soundfont:', err);
    throw err;
  }
}

async function initMidiPlayer() {
  if (midiPlayer) return midiPlayer;
  
  console.log('Initializing MidiPlayer...');
  midiPlayer = new MidiPlayer.Player((event) => {
    if (!piano) return;
    
    // Skip non-note events immediately to save CPU
    if (event.name !== 'Note on' && event.name !== 'Note off') return;
    
    const note = event.noteNumber || event.noteName;
    if (event.name === 'Note on' && event.velocity > 0) {
      // Use a slight gain boost (1.5x) for phone speakers
      piano.play(note, 0, { gain: (event.velocity / 127) * 1.5 });
    } else if (event.name === 'Note off' || (event.name === 'Note on' && event.velocity === 0)) {
      piano.stop(note);
    }
  });

  midiPlayer.on('endOfFile', () => {
    console.log('Local MIDI playback finished.');
    stopPreview();
  });

  // Throttled UI update (only 4 times per second)
  let lastUIUpdate = 0;
  midiPlayer.on('playing', () => {
    if (isSeekingLocal) return;
    const now = Date.now();
    if (now - lastUIUpdate < 250) return; 
    lastUIUpdate = now;

    const progress = document.getElementById('playProgress');
    const times = document.getElementById('playTimes');
    if (!midiPlayer) return;
    
    const totalTicks = midiPlayer.getTotalTicks();
    const curTick = midiPlayer.getCurrentTick();
    
    if (progress) { 
      // Ensure max is set correctly once
      if (progress.max != totalTicks) progress.max = totalTicks || 1;
      progress.value = curTick || 0; 
    }
    if (times) {
      const total = Math.floor(midiPlayer.getSongTime()) || 0;
      const elapsed = Math.floor(midiPlayer.getSongTime() - midiPlayer.getSongTimeRemaining()) || 0;
      times.textContent = `${formatTime(elapsed)} / ${formatTime(total)}`;
    }
  });
  
  return midiPlayer;
}

async function previewMidi(filename) {
  console.log(`--- Starting Local Preview: ${filename} ---`);
  stopPreview(); 
  
  try {
    console.log('1. Resuming AudioContext...');
    await ensureAudioContext();
    console.log(`   State: ${audioCtx.state}`);
    
    console.log('2. Initializing Synth and Player...');
    await Promise.all([loadPiano(), initMidiPlayer()]);
    console.log('   Synth and Player Ready.');

    console.log('3. Fetching MIDI file...');
    const token = localStorage.getItem('piano_token');
    const res = await fetch(`/files/download/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    
    const arrayBuffer = await res.arrayBuffer();
    console.log(`   Downloaded ${arrayBuffer.byteLength} bytes.`);
    
    currentPreviewFile = filename;
    previewActive = true;
    
    console.log('4. Loading into MidiPlayer...');
    if (!midiPlayer) throw new Error('MidiPlayer not initialized');
    midiPlayer.loadArrayBuffer(arrayBuffer);
    
    console.log('5. Starting playback...');
    midiPlayer.play();
    console.log('--- Local playback started successfully ---');
    
  } catch(e) { 
    console.error('Local preview error stack:', e);
    alert(`Local preview failed: ${e.message}\n\nCheck browser console for full stack trace.`);
  }
}

function stopPreview() {
  previewActive = false;
  currentPreviewFile = null;
  if (midiPlayer) {
    midiPlayer.stop();
  }
  if (piano) {
    try { piano.stop(); } catch(e) {}
  }
  const progress = document.getElementById('playProgress');
  const times = document.getElementById('playTimes');
  if (progress) progress.value = 0;
  if (times) times.textContent = '00:00 / 00:00';
}

async function seekLocalPlayback(tickOffset) {
  if (previewActive && midiPlayer) {
    midiPlayer.pause();
    midiPlayer.skipToTick(parseInt(tickOffset));
    midiPlayer.play();
  }
}

const progressEl = document.getElementById('playProgress');
if(progressEl){
  progressEl.onmousedown = () => { isSeekingLocal = true; };
  progressEl.onmouseup = async () => { await seekLocalPlayback(progressEl.value); isSeekingLocal = false; };
  progressEl.ontouchstart = () => { isSeekingLocal = true; };
  progressEl.ontouchend = async () => { await seekLocalPlayback(progressEl.value); isSeekingLocal = false; };
  progressEl.onchange = async () => {
    if(!isSeekingLocal) { isSeekingLocal = true; await seekLocalPlayback(progressEl.value); isSeekingLocal = false; }
  };
}

async function pollStatus(){
  if(isSeekingPlaylist) return;
  try{
    // 1. Check Playlist Manager first
    let s = await api('/queue/status');
    
    // 2. If not playing in playlist, check single-file piano status
    if (!s.playing) {
      const ps = await api('/playback/status');
      if (ps.playing) {
        s = {
          playing: true,
          current_playlist: 'Single Track',
          file: ps.file,
          elapsed: ps.elapsed,
          length: ps.length,
          current_index: -1 // Special flag for single track
        };
      }
    }

    const el = document.getElementById('status');
    const progress = document.getElementById('playlistProgress');
    const times = document.getElementById('playlistTimes');

    if (s.playing) {
      if(el) { 
        const label = s.current_playlist === 'Single Track' ? '' : `(#${s.current_index+1})`;
        el.textContent = `MIDI-eval: ${s.current_playlist} - ${s.file || ''} ${label}`; 
      }
      if(progress && times) {
        if(s.length) { 
          progress.max = s.length; 
          progress.value = s.elapsed || 0; 
        }
        times.textContent = `${formatTime(s.elapsed||0)} / ${formatTime(s.length||0)}`;
      }
    } else {
      if(el) el.textContent = 'MIDI-eval: Stopped';
      if(progress) progress.value = 0;
      if(times) times.textContent = '00:00 / 00:00';
    }
  }catch(e){ console.error('status poll failed', e); }
  setTimeout(pollStatus, 1000);
}

const plProgressEl = document.getElementById('playlistProgress');
if(plProgressEl){
  plProgressEl.onmousedown = () => { isSeekingPlaylist = true; };
  plProgressEl.onmouseup = async () => { await seekQueue(plProgressEl.value); isSeekingPlaylist = false; };
  plProgressEl.ontouchstart = () => { isSeekingPlaylist = true; };
  plProgressEl.ontouchend = async () => { await seekQueue(plProgressEl.value); isSeekingPlaylist = false; };
}

async function seekQueue(offset){
  // Determine if we are seeking a playlist or a single track
  const status = await api('/queue/status');
  if (status.playing) {
    await api('/queue/seek', 'POST', { offset: parseFloat(offset) });
  } else {
    const pStatus = await api('/playback/status');
    if (pStatus.playing) {
      const sel = document.getElementById('midiOutputs');
      const port = sel && sel.value ? sel.value : null;
      await api('/play/seek', 'POST', { filename: pStatus.file, offset: parseFloat(offset), port_name: port });
    }
  }
}

const stopPreviewBtn = document.getElementById('stopPreview');
if(stopPreviewBtn) stopPreviewBtn.onclick = () => stopPreview();

const stopQueueBtn = document.getElementById('stop');
if(stopQueueBtn) stopQueueBtn.onclick = async () => {
  await api('/queue/stop','POST');
  await api('/play/stop','POST');
};
