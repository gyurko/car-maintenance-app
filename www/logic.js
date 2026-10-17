// Pure logic: dates, mileage prediction, reminder status. No DOM access, so it can be reused in the Android build.
(function (root) {
  const DAY = 86400000;

  function parse(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
  function fmt(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function today() { const n = new Date(); return fmt(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / DAY); }
  function addDays(s, n) { return fmt(parse(s) + n * DAY); }
  function addMonths(s, n) {
    const [y, m, d] = s.split('-').map(Number);
    const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
    return fmt(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  }

  // All known odometer readings for a car: explicit readings plus the mileage on each maintenance record.
  function readings(car, items) {
    const pts = (car.entries || []).map(e => ({ date: e.date, miles: e.miles }));
    items.filter(i => i.carId === car.id && i.mileage != null && i.mileage !== '')
      .forEach(i => pts.push({ date: i.date, miles: Number(i.mileage) }));
    pts.sort((a, b) => parse(a.date) - parse(b.date) || a.miles - b.miles);
    return pts;
  }

  // Driving rate in miles/day via least-squares over the last ~year of readings (falls back to all readings).
  function rate(pts) {
    if (pts.length < 2) return null;
    const last = pts[pts.length - 1].date;
    let use = pts.filter(p => daysBetween(p.date, last) <= 365);
    if (use.length < 2) use = pts;
    const xs = use.map(p => daysBetween(use[0].date, p.date)), ys = use.map(p => p.miles);
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let num = 0, den = 0;
    xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    if (den === 0) return null;
    const r = num / den;
    return r > 0 ? r : null;
  }

  // Estimated odometer on `date`, anchored to the most recent real reading.
  function estimateMiles(pts, date) {
    if (!pts.length) return null;
    const last = pts[pts.length - 1], r = rate(pts);
    const days = Math.max(0, daysBetween(last.date, date));
    return Math.round(last.miles + (r || 0) * days);
  }

  // Date on which the odometer is expected to reach `target`.
  function dateForMiles(pts, target) {
    if (!pts.length) return null;
    const last = pts[pts.length - 1], r = rate(pts);
    if (last.miles >= target) return last.date;
    if (!r) return null;
    return addDays(last.date, Math.ceil((target - last.miles) / r));
  }

  // Reminder status for one maintenance record that has a reminder.
  function reminderStatus(item, pts, now, soonDays = 30, soonMiles = 500) {
    const rem = item.reminder || {};
    const dueDate = rem.months ? addMonths(item.date, Number(rem.months)) : null;
    const dueMiles = rem.miles && item.mileage !== '' && item.mileage != null ? Number(item.mileage) + Number(rem.miles) : null;
    const estNow = estimateMiles(pts, now);
    const milesDate = dueMiles != null ? dateForMiles(pts, dueMiles) : null;
    const dates = [dueDate, milesDate].filter(Boolean).sort();
    const effective = dates[0] || null; // whichever comes first
    let status = 'ok';
    if (effective) {
      const left = daysBetween(now, effective);
      if (left < 0 || (dueMiles != null && estNow != null && estNow >= dueMiles)) status = 'overdue';
      else if (left <= soonDays || (dueMiles != null && estNow != null && dueMiles - estNow <= soonMiles)) status = 'soon';
    }
    return { dueDate, dueMiles, milesDate, effective, estNow, status,
      milesLeft: dueMiles != null && estNow != null ? dueMiles - estNow : null,
      daysLeft: effective ? daysBetween(now, effective) : null };
  }

  // Only the newest record of each type per car counts as an active reminder.
  function activeReminders(cars, items, now) {
    const out = [];
    cars.forEach(car => {
      const mine = items.filter(i => i.carId === car.id);
      const latest = {};
      mine.forEach(i => {
        const k = i.type.trim().toLowerCase();
        if (!latest[k] || parse(i.date) > parse(latest[k].date)) latest[k] = i;
      });
      const pts = readings(car, items);
      Object.values(latest).forEach(i => {
        if (i.reminder && (i.reminder.months || i.reminder.miles)) out.push({ car, item: i, ...reminderStatus(i, pts, now) });
      });
    });
    const order = { overdue: 0, soon: 1, ok: 2 };
    out.sort((a, b) => order[a.status] - order[b.status] || (a.effective || '9').localeCompare(b.effective || '9'));
    return out;
  }

  // Cars whose last mileage reading is older than `days` (or that have none).
  function staleCars(cars, items, now, days) {
    return cars.filter(c => {
      const pts = readings(c, items);
      return !pts.length || daysBetween(pts[pts.length - 1].date, now) >= days;
    });
  }

  root.Logic = { parse, fmt, today, daysBetween, addDays, addMonths, readings, rate, estimateMiles, dateForMiles, reminderStatus, activeReminders, staleCars };
  if (typeof module !== 'undefined') module.exports = root.Logic;
})(typeof window !== 'undefined' ? window : globalThis);
