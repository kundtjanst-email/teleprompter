(() => {
  const API = 'https://brljbxzppkgbzmvbfbom.supabase.co/functions/v1/teleprompter';
  const CHANNEL = 'main';
  const isIpad = document.body.classList.contains('ipad');
  const $ = id => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tp_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('tp_' + k, JSON.stringify(v)); } catch {} }
  };
  const DEFAULTS = { speed: 25, size: 64, pad: 6, line: 55, mx: false, my: false };
  const LIMITS = { speed: [1, 100, 1], size: [24, 160, 4], pad: [0, 30, 1], line: [10, 85, 5] };
  const KEYS = Object.keys(DEFAULTS);
  const st = Object.assign({ playing: false, y: 0, last: 0 }, DEFAULTS, store.get('settings', {}));
  const cur = () => { const o = {}; for (const k of KEYS) o[k] = st[k]; return o; };

  const text = $('text'), stage = $('stage'), bar = $('bar');
  function syncMsg(t, cls) {
    for (const el of [$('sync'), $('barSync')]) { if (!el) continue; el.textContent = t; el.className = cls || ''; }
  }

  // ---- Prompter rendering
  // Text size scales with screen width, so line breaks match between the computer preview and the iPad
  const px = () => st.size * stage.clientWidth / 1024;
  // The reading line sits where the text starts, so there is always black space above the first line
  const markerTop = () => stage.clientHeight * st.line / 100;
  function applySettings() {
    text.style.fontSize = px() + 'px';
    text.style.paddingLeft = text.style.paddingRight = st.pad + 'vw';
    $('marker').style.top = markerTop() + 'px';
    stage.classList.toggle('mirror-x', st.mx);
    stage.classList.toggle('mirror-y', st.my);
    $('mirrorX').setAttribute('aria-pressed', st.mx);
    $('mirrorY').setAttribute('aria-pressed', st.my);
    $('speedOut').value = st.speed;
    $('sizeOut').value = st.size;
    $('padOut').value = st.pad;
    $('lineOut').value = st.line + '%';
    render();
  }
  function render() { text.style.transform = 'translateY(' + (markerTop() - st.y) + 'px)'; }
  function maxY() { return text.offsetHeight + 40; }
  const clean = s => s.replace(/^\s*\n/, '').replace(/\s+$/, '');
  function setText(s) { text.textContent = clean(s) || 'Inget manus ännu. Skriv det på datorn.'; }

  // Settings are shared: saved centrally from either device, so they survive new scripts and page reloads
  let setT = null, lastLocalSet = 0, savingSet = Promise.resolve();
  function settingsChanged() {
    store.set('settings', cur());
    lastLocalSet = Date.now();
    clearTimeout(setT);
    setT = setTimeout(() => {
      const settings = cur();
      savingSet = savingSet.then(() => post({ settings })).catch(() => {
        syncMsg('Kunde inte spara inställningarna. Kolla internet.', 'err');
      });
    }, 500);
  }
  async function post(obj) {
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ id: CHANNEL }, obj)) });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  // Take settings from the server unless this device changed them a moment ago
  let firstSync = true;
  function adoptServerSettings(serverSet) {
    const isFirst = firstSync; firstSync = false;
    const serverIsDefault = !serverSet || JSON.stringify(Object.assign({}, DEFAULTS, serverSet)) === JSON.stringify(DEFAULTS);
    // First time after the update: keep what this device already had instead of falling back to defaults
    if (isFirst && serverIsDefault && JSON.stringify(cur()) !== JSON.stringify(DEFAULTS)) { settingsChanged(); return false; }
    if (!serverSet || !Object.keys(serverSet).length) return false;
    if (Date.now() - lastLocalSet < 3000) return false;
    const next = Object.assign({}, DEFAULTS, serverSet);
    if (JSON.stringify(next) === JSON.stringify(cur())) return false;
    const old = st.size;
    Object.assign(st, next);
    if (st.size !== old) st.y *= st.size / old;
    store.set('settings', cur());
    applySettings();
    return true;
  }
  function stepSetting(key, dir) {
    const [min, max, inc] = LIMITS[key];
    const next = Math.max(min, Math.min(max, st[key] + dir * inc));
    if (next === st[key]) return;
    const old = st.size;
    st[key] = next;
    if (key === 'size') st.y *= st.size / old;
    applySettings(); settingsChanged();
  }
  // Tap to step once, hold to keep stepping
  for (const b of document.querySelectorAll('.step')) {
    let holdT = null;
    const stop = () => { clearTimeout(holdT); clearInterval(holdT); holdT = null; };
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const k = b.dataset.k, d = +b.dataset.d;
      stepSetting(k, d);
      holdT = setTimeout(() => { holdT = setInterval(() => stepSetting(k, d), 90); }, 400);
      if (st.playing) showBar(true);
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
    b.addEventListener('click', e => { e.stopPropagation(); if (e.detail === 0) stepSetting(b.dataset.k, +b.dataset.d); });
  }
  $('mirrorX').onclick = e => { e.stopPropagation(); st.mx = !st.mx; applySettings(); settingsChanged(); };
  $('mirrorY').onclick = e => { e.stopPropagation(); st.my = !st.my; applySettings(); settingsChanged(); };

  let wake = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
      if (!on && wake) { await wake.release(); wake = null; }
    } catch {}
  }
  let hideT;
  function showBar(autoHide) {
    bar.classList.remove('hide');
    clearTimeout(hideT);
    if (autoHide) hideT = setTimeout(() => { if (st.playing) bar.classList.add('hide'); }, 1800);
  }
  function setPlaying(p) {
    st.playing = p;
    $('play').textContent = p ? '❚❚ Paus' : '▶ Spela';
    keepAwake(p);
    if (p) { st.last = performance.now(); requestAnimationFrame(tick); $('hint').style.opacity = 0; showBar(true); }
    else showBar(false);
  }
  function tick(now) {
    if (!st.playing) return;
    const dt = Math.min(0.1, (now - st.last) / 1000); st.last = now;
    st.y += (st.speed * 3) * (px() / 64) * dt;
    if (st.y >= maxY()) { st.y = maxY(); render(); setPlaying(false); return; }
    render();
    requestAnimationFrame(tick);
  }
  $('play').onclick = e => { e.stopPropagation(); setPlaying(!st.playing); };
  $('restart').onclick = e => { e.stopPropagation(); st.y = 0; render(); };
  bar.addEventListener('click', e => { e.stopPropagation(); if (st.playing) showBar(true); });

  let dragY = null, dragged = false;
  stage.addEventListener('click', () => { if (dragged) return; setPlaying(!st.playing); });
  stage.addEventListener('pointerdown', e => { dragY = e.clientY; dragged = false; });
  window.addEventListener('pointermove', e => {
    if (dragY === null) return;
    let d = e.clientY - dragY;
    if (Math.abs(d) > 6) dragged = true;
    if (!dragged) return;
    if (st.my) d = -d;
    st.y = Math.max(0, Math.min(maxY(), st.y - d)); dragY = e.clientY; render();
  });
  window.addEventListener('pointerup', () => { dragY = null; setTimeout(() => { dragged = false; }, 0); });
  stage.addEventListener('wheel', e => { e.preventDefault(); st.y = Math.max(0, Math.min(maxY(), st.y + e.deltaY)); render(); }, { passive: false });

  window.addEventListener('keydown', e => {
    if ($('prompter').hidden) return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!st.playing); }
    else if (e.key === 'ArrowUp') stepSetting('speed', 2);
    else if (e.key === 'ArrowDown') stepSetting('speed', -2);
    else if (e.key === 'Escape' && !isIpad) $('edit').click();
  });
  $('fs').onclick = async e => {
    e.stopPropagation();
    const el = document.documentElement;
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else await (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    } catch {}
  };
  window.addEventListener('resize', applySettings);

  async function fetchState() {
    const r = await fetch(API + '?id=' + CHANNEL + '&t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  // ---- iPad: show the prompter and follow whatever the computer sends
  if (isIpad) {
    $('prompter').hidden = false;
    setText('Hämtar manus…');
    applySettings();
    let lastText = null, failures = 0;
    async function poll() {
      try {
        const d = await fetchState();
        failures = 0; syncMsg('');
        adoptServerSettings(d.settings);
        if (d.text !== lastText) {
          const first = lastText === null;
          lastText = d.text; setText(d.text || '');
          if (!first) { setPlaying(false); st.y = 0; }
          applySettings();
        }
      } catch {
        if (++failures >= 3) syncMsg('Ingen kontakt med datorn just nu. Försöker igen…', 'err');
      }
      setTimeout(poll, document.hidden ? 5000 : 1500);
    }
    poll();
    return;
  }

  // ---- Host
  const ipadUrl = new URL('ipad.html', location.href).href;
  $('ipadLink').value = ipadUrl;
  try {
    const q = qrcode(0, 'M'); q.addData(ipadUrl, 'Byte'); q.make();
    $('qr').innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch { $('qr').hidden = true; }
  $('copyLink').onclick = async () => {
    try { await navigator.clipboard.writeText(ipadUrl); $('copyLink').textContent = 'Kopierad'; }
    catch { $('ipadLink').select(); $('copyLink').textContent = 'Markerad, tryck ⌘C'; }
    setTimeout(() => { $('copyLink').textContent = 'Kopiera iPad-länk'; }, 2000);
  };
  $('ipadLink').addEventListener('focus', e => e.target.select());

  // Text is sent on its own, so a new script never touches the settings
  let sendT = null, sending = false, again = false, lastSentText = null;
  function queueSend() { syncMsg('Skickar…'); clearTimeout(sendT); sendT = setTimeout(sendText, 700); }
  async function sendText() {
    if (sending) { again = true; return; }
    const t = $('script').value;
    if (t === lastSentText) { syncMsg('iPaden visar samma sak som här.', 'ok'); return; }
    sending = true;
    try {
      await post({ text: t });
      lastSentText = t;
      syncMsg('iPaden visar samma sak som här.', 'ok');
    } catch {
      syncMsg('Kunde inte skicka. Kolla internet, försöker igen…', 'err');
      clearTimeout(sendT); sendT = setTimeout(sendText, 3000);
    } finally {
      sending = false;
      if (again) { again = false; sendText(); }
    }
  }

  $('script').addEventListener('input', () => { store.set('draft', $('script').value); queueSend(); });
  $('clear').onclick = () => { $('script').value = ''; store.set('draft', ''); queueSend(); $('script').focus(); };
  $('start').onclick = () => {
    setText($('script').value);
    $('editor').hidden = true; $('prompter').hidden = false;
    st.y = 0; $('hint').style.opacity = 1; applySettings(); showBar(false);
  };
  $('edit').onclick = e => { if (e) e.stopPropagation(); setPlaying(false); $('prompter').hidden = true; $('editor').hidden = false; };
  applySettings();

  // On load: settings always come from the server; text from this computer's own draft, else what the iPad shows now
  const draft = store.get('draft', null);
  if (typeof draft === 'string') $('script').value = draft;
  syncMsg('Hämtar…');
  fetchState().then(d => {
    adoptServerSettings(d.settings);
    if (typeof draft !== 'string') { $('script').value = d.text || ''; lastSentText = d.text || ''; }
    else if (draft === d.text) lastSentText = draft;
    syncMsg(typeof draft === 'string' && draft !== d.text ? 'iPaden visar ett annat manus. Ändra texten här så skickas den.' : 'iPaden visar samma sak som här.', 'ok');
  }).catch(() => syncMsg('Kunde inte hämta senaste läget. Det du ändrar skickas när kontakten är tillbaka.', 'err'));

  // Keep settings in step if they are changed on the iPad or another computer
  (function pollSettings() {
    setTimeout(async () => {
      try { adoptServerSettings((await fetchState()).settings); } catch {}
      pollSettings();
    }, document.hidden ? 10000 : 3000);
  })();
})();
