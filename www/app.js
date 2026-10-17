(function () {
  const L = window.Logic;
  const KEY = 'carlog.v1';
  const PRESETS = {
    'Oil change': { months: 6, miles: 5000 },
    'Tire rotation': { months: 6, miles: 6000 },
    'New tires': { months: '', miles: 50000 },
    'Air filter': { months: 12, miles: 15000 },
    'Cabin filter': { months: 12, miles: 15000 },
    'Brake pads': { months: '', miles: 40000 },
    'Brake fluid': { months: 24, miles: '' },
    'Coolant flush': { months: 60, miles: 60000 },
    'Transmission fluid': { months: '', miles: 60000 },
    'Spark plugs': { months: '', miles: 60000 },
    'Battery': { months: 48, miles: '' },
    'Wiper blades': { months: 12, miles: '' },
    'Alignment': { months: 12, miles: '' },
    'Inspection / registration': { months: 12, miles: '' },
  };

  let state = load();
  const $view = document.getElementById('view');
  const $dlg = document.getElementById('dlg');

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.cars) return { settings: { promptDays: 30 }, ...s };
    } catch (e) {}
    return { cars: [], items: [], settings: { promptDays: 30 } };
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); syncNative(); }

  // ---------- native (Android) notifications via Capacitor ----------
  const LN = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
    ? window.Capacitor.Plugins.LocalNotifications : null;

  // Re-create all scheduled notifications: one monthly mileage check-in plus one per upcoming reminder.
  async function syncNative() {
    if (!LN) return;
    try {
      const perm = await LN.checkPermissions();
      if (perm.display !== 'granted') return;
      const pending = await LN.getPending();
      if (pending.notifications.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
      const notifications = [{
        id: 1, title: 'Mileage check-in', body: 'Time to enter the odometer reading for your cars.',
        schedule: { on: { day: Math.min(28, Number(state.settings.checkinDay) || 1), hour: 9, minute: 0 }, allowWhileIdle: true },
      }];
      const now = L.today();
      L.activeReminders(state.cars, state.items, now).forEach((r, idx) => {
        if (!r.effective || r.effective < now) return;
        const at = new Date(r.effective + 'T09:00:00');
        if (at > new Date()) notifications.push({
          id: 100 + idx, title: `${r.item.type} due`, body: `${carName(r.car)}: ${r.item.type} is due today.`,
          schedule: { at, allowWhileIdle: true },
        });
      });
      await LN.schedule({ notifications });
    } catch (e) { console.error('notification sync failed', e); }
  }
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = n => n == null || n === '' ? '—' : Number(n).toLocaleString();
  const dateFmt = s => s ? new Date(L.parse(s)).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
  const carName = c => c.name || [c.year, c.make, c.model].filter(Boolean).join(' ') || 'Car';

  // ---------- routing ----------
  function route() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [, a, b] = h.split('/');
    if (a === 'cars' && b) return carView(b);
    if (a === 'cars') return carsView();
    if (a === 'settings') return settingsView();
    dashboard();
  }
  window.addEventListener('hashchange', route);
  const rerender = () => route();

  // ---------- dashboard ----------
  function dashboard() {
    const now = L.today();
    const stale = L.staleCars(state.cars, state.items, now, state.settings.promptDays);
    let html = '<h1>Dashboard</h1>';
    if (!state.cars.length) html += '<div class="card">No cars yet. <a href="#/cars">Add your first car</a> to get started.</div>';
    stale.forEach(c => {
      const pts = L.readings(c, state.items), last = pts[pts.length - 1];
      const est = last ? L.estimateMiles(pts, now) : null;
      html += `<div class="card banner"><b>${esc(carName(c))}</b>: time for a mileage check-in.
        <div class="muted">${last ? `Last reading ${num(last.miles)} mi on ${dateFmt(last.date)}${est && est !== last.miles ? ` · estimated now ~${num(est)} mi` : ''}` : 'No readings yet.'}</div>
        <form data-car="${c.id}"><input type="number" min="0" inputmode="numeric" placeholder="Odometer (mi)" required><button class="primary">Save mileage</button></form></div>`;
    });
    const rems = L.activeReminders(state.cars, state.items, now);
    html += '<h2>Upcoming maintenance</h2>';
    if (!rems.length) html += '<div class="card muted">No reminders set. Add a maintenance record with a reminder and it will show up here.</div>';
    rems.forEach(r => { html += reminderCard(r, true); });
    $view.innerHTML = html;
    $view.querySelectorAll('.banner form').forEach(f => f.addEventListener('submit', e => {
      e.preventDefault();
      addReading(f.dataset.car, f.querySelector('input').value);
      rerender();
    }));
    $view.querySelectorAll('[data-done]').forEach(b => b.addEventListener('click', () => {
      const [carId, itemId] = b.dataset.done.split('|');
      const it = state.items.find(i => i.id === itemId);
      itemDialog(carId, null, it.type);
    }));
  }

  function reminderCard(r, showCar) {
    const parts = [];
    if (r.dueDate) parts.push(`by ${dateFmt(r.dueDate)}`);
    if (r.dueMiles != null) parts.push(`at ${num(r.dueMiles)} mi${r.milesDate ? ` (est. ${dateFmt(r.milesDate)})` : ''}`);
    let left = '';
    if (r.status === 'overdue') left = r.daysLeft != null && r.daysLeft < 0 ? `${-r.daysLeft} day${r.daysLeft === -1 ? '' : 's'} past due` : '';
    else if (r.daysLeft != null) left = r.daysLeft === 0 ? 'Due today' : `Due in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`;
    if (r.milesLeft != null && r.milesLeft > 0) left += ` · ~${num(r.milesLeft)} mi left`;
    return `<div class="card"><div class="row"><div>
      <b>${esc(r.item.type)}</b> <span class="chip ${r.status}">${r.status === 'ok' ? 'OK' : r.status === 'soon' ? 'Due soon' : 'Overdue'}</span>
      ${showCar ? `<div class="muted"><a href="#/cars/${r.car.id}">${esc(carName(r.car))}</a></div>` : ''}
      <div class="muted">Next due ${parts.join(' or ') || '—'}</div>
      <div class="muted">${left}</div></div>
      <button class="small" data-done="${r.car.id}|${r.item.id}">Mark done</button></div></div>`;
  }

  // ---------- cars ----------
  function carsView() {
    let html = '<div class="row"><h1>Cars</h1><button class="primary" id="addCar">+ Add car</button></div>';
    if (!state.cars.length) html += '<div class="card muted">No cars yet.</div>';
    state.cars.forEach(c => {
      const pts = L.readings(c, state.items), est = L.estimateMiles(pts, L.today());
      html += `<div class="card"><div class="row"><div><a href="#/cars/${c.id}"><b>${esc(carName(c))}</b></a>
        <div class="muted">${[c.year, c.make, c.model].filter(Boolean).join(' ')}</div></div>
        <div class="muted">${est != null ? `~${num(est)} mi` : 'no mileage yet'}</div></div></div>`;
    });
    $view.innerHTML = html;
    document.getElementById('addCar').onclick = () => carDialog();
  }

  function carDialog(car) {
    car = car || {};
    $dlg.innerHTML = `<form method="dialog" id="f"><h2>${car.id ? 'Edit' : 'Add'} car</h2>
      <label>Nickname</label><input name="name" value="${esc(car.name)}" placeholder="e.g. Daily Driver" required>
      <div class="two"><div><label>Year</label><input name="year" value="${esc(car.year)}" inputmode="numeric"></div>
      <div><label>Make</label><input name="make" value="${esc(car.make)}"></div></div>
      <label>Model</label><input name="model" value="${esc(car.model)}">
      ${car.id ? '' : '<label>Current mileage</label><input name="miles" type="number" min="0" inputmode="numeric">'}
      <div class="dlg-actions"><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`;
    $dlg.showModal();
    $dlg.querySelector('#cancel').onclick = () => $dlg.close();
    $dlg.querySelector('#f').onsubmit = e => {
      const f = Object.fromEntries(new FormData(e.target));
      if (car.id) Object.assign(car, { name: f.name, year: f.year, make: f.make, model: f.model });
      else {
        const c = { id: uid(), name: f.name, year: f.year, make: f.make, model: f.model, entries: [] };
        state.cars.push(c);
        if (f.miles !== '') addReading(c.id, f.miles, true);
      }
      save(); $dlg.close(); rerender();
    };
  }

  function addReading(carId, miles, silent) {
    const c = state.cars.find(x => x.id === carId);
    c.entries.push({ id: uid(), date: L.today(), miles: Number(miles) });
    if (!silent) save();
  }

  // ---------- car detail ----------
  function carView(id) {
    const c = state.cars.find(x => x.id === id);
    if (!c) { location.hash = '#/cars'; return; }
    const now = L.today(), pts = L.readings(c, state.items), r = L.rate(pts), est = L.estimateMiles(pts, now);
    const items = state.items.filter(i => i.carId === id).sort((a, b) => L.parse(b.date) - L.parse(a.date));
    const rems = L.activeReminders([c], state.items, now);
    let html = `<div class="row"><div><a href="#/cars">← Cars</a><h1>${esc(carName(c))}</h1></div>
      <div class="actions"><button id="editCar">Edit</button><button class="danger" id="delCar">Delete</button></div></div>
      <div class="card row"><div><div class="stat">${est != null ? '~' + num(est) : '—'} mi</div>
        <div class="muted">${r ? `Estimated from ${pts.length} readings · about ${num(Math.round(r * 30.4))} mi/month` : pts.length ? 'Add another reading to enable predictions' : 'No readings yet'}</div></div>
        <button class="primary" id="addReading">+ Mileage reading</button></div>
      <div class="row"><h2>Reminders</h2></div>`;
    html += rems.length ? rems.map(x => reminderCard(x, false)).join('') : '<div class="card muted">None active.</div>';
    html += `<div class="row"><h2>Maintenance history</h2><button class="primary" id="addItem">+ Add maintenance</button></div>`;
    html += items.length ? '' : '<div class="card muted">No records yet.</div>';
    items.forEach(i => {
      const rm = i.reminder ? [i.reminder.months && `${i.reminder.months} mo`, i.reminder.miles && `${num(i.reminder.miles)} mi`].filter(Boolean).join(' / ') : '';
      html += `<div class="card"><div class="row"><div><b>${esc(i.type)}</b>
        <div class="muted">${dateFmt(i.date)} · ${num(i.mileage)} mi${i.cost ? ` · $${esc(i.cost)}` : ''}${rm ? ` · remind every ${rm}` : ''}</div>
        ${i.notes ? `<div>${esc(i.notes)}</div>` : ''}</div>
        <div class="actions"><button class="small" data-edit="${i.id}">Edit</button><button class="small danger" data-del="${i.id}">Delete</button></div></div></div>`;
    });
    html += '<h2>Mileage readings</h2>';
    const ents = [...(c.entries || [])].sort((a, b) => L.parse(b.date) - L.parse(a.date));
    html += ents.length ? `<div class="card"><table>${ents.map(e => `<tr><td>${dateFmt(e.date)}</td><td>${num(e.miles)} mi</td><td><button class="small danger" data-delr="${e.id}">✕</button></td></tr>`).join('')}</table></div>` : '<div class="card muted">None.</div>';
    $view.innerHTML = html;
    document.getElementById('editCar').onclick = () => carDialog(c);
    document.getElementById('delCar').onclick = () => {
      if (!confirm(`Delete ${carName(c)} and all its records?`)) return;
      state.cars = state.cars.filter(x => x.id !== id); state.items = state.items.filter(i => i.carId !== id);
      save(); location.hash = '#/cars';
    };
    document.getElementById('addReading').onclick = () => readingDialog(c);
    document.getElementById('addItem').onclick = () => itemDialog(id);
    $view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => itemDialog(id, state.items.find(i => i.id === b.dataset.edit)));
    $view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (confirm('Delete this record?')) { state.items = state.items.filter(i => i.id !== b.dataset.del); save(); rerender(); } });
    $view.querySelectorAll('[data-delr]').forEach(b => b.onclick = () => { c.entries = c.entries.filter(e => e.id !== b.dataset.delr); save(); rerender(); });
    $view.querySelectorAll('[data-done]').forEach(b => b.onclick = () => itemDialog(id, null, state.items.find(i => i.id === b.dataset.done.split('|')[1]).type));
  }

  function readingDialog(c) {
    $dlg.innerHTML = `<form method="dialog" id="f"><h2>Mileage reading</h2>
      <div class="two"><div><label>Date</label><input type="date" name="date" value="${L.today()}" required></div>
      <div><label>Odometer (mi)</label><input type="number" name="miles" min="0" required autofocus></div></div>
      <div class="dlg-actions"><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`;
    $dlg.showModal();
    $dlg.querySelector('#cancel').onclick = () => $dlg.close();
    $dlg.querySelector('#f').onsubmit = e => {
      const f = Object.fromEntries(new FormData(e.target));
      c.entries.push({ id: uid(), date: f.date, miles: Number(f.miles) });
      save(); $dlg.close(); rerender();
    };
  }

  // Maintenance types: presets first, then any type already used, de-duplicated ignoring case.
  function knownTypes() {
    const seen = new Map();
    [...Object.keys(PRESETS), ...state.items.map(i => i.type.trim())].forEach(t => {
      if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    });
    return [...seen.values()];
  }
  function canonicalType(t) {
    t = t.trim();
    return knownTypes().find(k => k.toLowerCase() === t.toLowerCase()) || t;
  }
  // Reminder to prefill: the most recent record of this type that had one, else the built-in preset.
  function reminderDefault(type) {
    const k = type.trim().toLowerCase();
    const last = state.items.filter(i => i.type.trim().toLowerCase() === k && i.reminder)
      .sort((a, b) => L.parse(b.date) - L.parse(a.date))[0];
    if (last) return last.reminder;
    const key = Object.keys(PRESETS).find(p => p.toLowerCase() === k);
    return key ? PRESETS[key] : null;
  }

  function itemDialog(carId, item, presetType) {
    const editing = !!item;
    item = item || { type: presetType || '', date: L.today(), mileage: '', notes: '', cost: '', reminder: null };
    const rem = item.reminder || {};
    const car = state.cars.find(c => c.id === carId);
    if (!editing && item.mileage === '') {
      const e = L.estimateMiles(L.readings(car, state.items), L.today());
      if (e != null) item.mileage = e;
    }
    const known = knownTypes();
    $dlg.innerHTML = `<form method="dialog" id="f"><h2>${editing ? 'Edit' : 'Add'} maintenance</h2>
      <label>What was done</label><input name="type" list="types" value="${esc(item.type)}" required placeholder="Oil change, new tires…">
      <datalist id="types">${known.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
      <div class="two"><div><label>Date</label><input type="date" name="date" value="${item.date}" required></div>
      <div><label>Mileage</label><input type="number" name="mileage" min="0" value="${esc(item.mileage)}"></div></div>
      <div class="two"><div><label>Cost ($, optional)</label><input name="cost" value="${esc(item.cost)}" inputmode="decimal"></div><div></div></div>
      <label>Notes</label><textarea name="notes" rows="3">${esc(item.notes)}</textarea>
      <fieldset><legend>Remind me when next one is due (leave blank for none)</legend>
        <div class="two"><div><label>After this many months</label><input type="number" name="rmonths" min="0" value="${esc(rem.months)}"></div>
        <div><label>After this many miles</label><input type="number" name="rmiles" min="0" value="${esc(rem.miles)}"></div></div>
        <div class="muted" style="margin-top:6px">If both are set, you're reminded at whichever comes first.</div></fieldset>
      <div class="dlg-actions"><button type="button" id="cancel">Cancel</button><button class="primary">Save</button></div></form>`;
    $dlg.showModal();
    const f = $dlg.querySelector('#f');
    f.elements.type.addEventListener('change', () => {
      const p = reminderDefault(f.elements.type.value);
      if (p &&!f.elements.rmonths.value && !f.elements.rmiles.value) { f.elements.rmonths.value = p.months; f.elements.rmiles.value = p.miles; }
    });
    if (presetType && !editing) f.elements.type.dispatchEvent(new Event('change'));
    $dlg.querySelector('#cancel').onclick = () => $dlg.close();
    f.onsubmit = e => {
      const v = Object.fromEntries(new FormData(f));
      const data = {
        type: canonicalType(v.type), date: v.date, mileage: v.mileage === '' ? '' : Number(v.mileage), cost: v.cost, notes: v.notes,
        reminder: (v.rmonths || v.rmiles) ? { months: v.rmonths ? Number(v.rmonths) : '', miles: v.rmiles ? Number(v.rmiles) : '' } : null,
      };
      if (editing) Object.assign(item, data); else state.items.push({ id: uid(), carId, ...data });
      save(); $dlg.close(); rerender();
    };
  }

  // ---------- settings / notifications ----------
  async function settingsView() {
    const perm = LN ? (await LN.checkPermissions()).display : 'Notification' in window ? Notification.permission : 'unsupported';
    $view.innerHTML = `<h1>Settings</h1>
      <div class="card"><b>Mileage check-in</b>
        <div class="muted">How often to ask you for each car's odometer reading.</div>
        <label>Show the check-in banner after this many days</label><input type="number" id="pdays" min="1" value="${state.settings.promptDays}" style="width:120px">
        <label>Android notification: day of month (1–28, at 9:00 AM)</label><input type="number" id="cday" min="1" max="28" value="${state.settings.checkinDay || 1}" style="width:120px"></div>
      <div class="card"><b>Notifications</b>
        <div class="muted">Status: ${perm}. In the browser, notifications only appear while this page is open. The Android app will schedule them in the background.</div>
        <div class="actions" style="margin-top:8px"><button id="perm">Enable notifications</button><button id="testn">Send test notification</button></div></div>
      <div class="card"><b>Backup</b>
        <div class="muted">Data is stored in this browser. Export a copy now and then.</div>
        <div class="actions" style="margin-top:8px"><button id="exp">Export JSON</button><button id="imp">Import JSON</button>
        <input type="file" id="file" accept="application/json" hidden></div></div>
      <div class="card"><b>Demo data</b><div class="muted">Fill the app with sample cars to try it out. Replaces current data.</div>
        <div class="actions" style="margin-top:8px"><button id="demo">Load sample data</button><button class="danger" id="wipe">Erase everything</button></div></div>`;
    document.getElementById('pdays').onchange = e => { state.settings.promptDays = Math.max(1, Number(e.target.value) || 30); save(); };
    document.getElementById('cday').onchange = e => { state.settings.checkinDay = Math.min(28, Math.max(1, Number(e.target.value) || 1)); save(); };
    document.getElementById('perm').onclick = async () => {
      if (LN) { await LN.requestPermissions(); syncNative(); settingsView(); }
      else if ('Notification' in window) { await Notification.requestPermission(); settingsView(); }
    };
    document.getElementById('testn').onclick = () => notify('Car Log', 'Time to enter the mileage for your cars.');
    document.getElementById('exp').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
      a.download = `car-log-${L.today()}.json`; a.click();
    };
    document.getElementById('imp').onclick = () => document.getElementById('file').click();
    document.getElementById('file').onchange = async e => {
      try { const s = JSON.parse(await e.target.files[0].text()); if (!s.cars || !s.items) throw 0; state = { settings: { promptDays: 30 }, ...s }; save(); alert('Imported.'); settingsView(); }
      catch { alert('That file is not a valid backup.'); }
    };
    document.getElementById('demo').onclick = () => { if (confirm('Replace current data with sample data?')) { state = sample(); save(); location.hash = '#/'; } };
    document.getElementById('wipe').onclick = () => { if (confirm('Erase all cars and records?')) { state = { cars: [], items: [], settings: { promptDays: 30 } }; save(); location.hash = '#/'; } };
  }

  async function notify(title, body) {
    if (LN) {
      if ((await LN.checkPermissions()).display !== 'granted') { alert('Notifications are not enabled. Tap "Enable notifications" first.'); return; }
      await LN.schedule({ notifications: [{ id: 2, title, body, schedule: { at: new Date(Date.now() + 2000) } }] });
      return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') { alert('Notifications are not enabled. Click "Enable notifications" first.'); return; }
    new Notification(title, { body });
  }

  function checkNotify() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const stale = L.staleCars(state.cars, state.items, L.today(), state.settings.promptDays);
    const lastKey = 'carlog.lastNotify';
    if (stale.length && localStorage.getItem(lastKey) !== L.today()) {
      localStorage.setItem(lastKey, L.today());
      new Notification('Mileage check-in', { body: `Enter the odometer for: ${stale.map(carName).join(', ')}` });
    }
  }

  function sample() {
    const now = L.today(), d = n => L.addDays(now, -n);
    const civic = { id: 'c1', name: 'Honda Civic', year: '2019', make: 'Honda', model: 'Civic', entries: [
      { id: 'r1', date: d(300), miles: 41200 }, { id: 'r2', date: d(240), miles: 43100 }, { id: 'r3', date: d(170), miles: 45500 },
      { id: 'r4', date: d(100), miles: 47600 }, { id: 'r5', date: d(45), miles: 49500 } ] };
    const truck = { id: 'c2', name: 'Ford F-150', year: '2015', make: 'Ford', model: 'F-150', entries: [{ id: 'r6', date: d(12), miles: 112300 }] };
    return { settings: { promptDays: 30 }, cars: [civic, truck], items: [
      { id: 'i1', carId: 'c1', type: 'Oil change', date: d(200), mileage: 44300, cost: '65', notes: 'Synthetic 0W-20', reminder: { months: 6, miles: 5000 } },
      { id: 'i2', carId: 'c1', type: 'Tire rotation', date: d(200), mileage: 44300, cost: '', notes: '', reminder: { months: 6, miles: 6000 } },
      { id: 'i3', carId: 'c1', type: 'New tires', date: d(700), mileage: 30000, cost: '720', notes: 'Michelin Defender', reminder: { months: '', miles: 50000 } },
      { id: 'i4', carId: 'c2', type: 'Oil change', date: d(20), mileage: 112000, cost: '80', notes: '', reminder: { months: 6, miles: 5000 } },
    ] };
  }

  route();
  checkNotify();
  syncNative();
  setInterval(checkNotify, 3600000);
})();
