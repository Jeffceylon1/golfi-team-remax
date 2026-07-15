/* ============================================================
   Golfi Team RE/MAX — Operator Console
   All console logic. Config values come from the API, never hardcoded.
   ============================================================ */
(function () {
  'use strict';

  // ---- Supabase (public anon key — safe for the browser) -------------------
  var SUPABASE_URL = 'https://yklqpqbqlqodcjfecxnt.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrbHFwcWJxbHFvZGNqZmVjeG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NDE1MTAsImV4cCI6MjA5OTMxNzUxMH0.0quJN-M-aPUKwlS4kq3ulx7aDdgLpy2NosaNhxTjty8';

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---- State ---------------------------------------------------------------
  var state = {
    settings: {},          // cached config categories from /api/admin/config
    settingsLoaded: false,
    dirty: {},             // category -> bool
    rendered: {},          // config panel id -> bool (render once)
    visitorTimer: null,
    shellBuilt: false,
  };

  var leadsState = { all: [], filter: 'all', q: '' };

  // ============================================================
  // Icons (inline SVG, stroke = currentColor)
  // ============================================================
  function svg(inner) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  }
  var ICONS = {
    today: svg('<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>'),
    leads: svg('<circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.7-5 5.5-5s5.5 2 5.5 5"/><path d="M17 15c2.2 0 4 1.6 4 4"/><path d="M16 5.5a2.5 2.5 0 0 1 0 5"/>'),
    visitors: svg('<circle cx="12" cy="12" r="9"/><path d="M12 12l6-3"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
    conversations: svg('<path d="M4 5h16v11H9l-4 4z"/><path d="M8 9h8M8 12h5"/>'),
    agent: svg('<rect x="5" y="8" width="14" height="10" rx="2"/><path d="M12 8V4"/><circle cx="9.2" cy="13" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.8" cy="13" r="1.1" fill="currentColor" stroke="none"/>'),
    scoring: svg('<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/>'),
    hooks: svg('<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h3M15 7h3"/>'),
    alerts: svg('<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    business: svg('<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/>'),
    widget: svg('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>'),
    trash: svg('<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>'),
    check: svg('<path d="M20 6L9 17l-5-5"/>'),
    alert: svg('<path d="M12 3l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6" fill="currentColor" stroke="none"/>'),
    insights: svg('<path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8" width="3" height="9"/><rect x="17" y="14" width="3" height="3"/>'),
    digest: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
    nurture: svg('<circle cx="5" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="18" r="2"/><path d="M6.6 7.4l3.8 3.2M13.6 13.4l3.8 3.2"/>'),
  };

  // ============================================================
  // Nav definition
  // ============================================================
  var NAV = [
    { id: 'today',         label: 'Today' },
    { id: 'leads',         label: 'Leads' },
    { id: 'visitors',      label: 'Live Visitors' },
    { id: 'conversations', label: 'Conversations' },
    { id: 'insights',      label: 'Insights' },
    { id: 'agent',         label: 'Agent Settings' },
    { id: 'scoring',       label: 'Scoring Rules' },
    { id: 'hooks',         label: 'Capture Hooks' },
    { id: 'alerts',        label: 'Alerts' },
    { id: 'digest',        label: 'Daily Digest' },
    { id: 'nurture',       label: 'Nurture Sequences' },
    { id: 'business',      label: 'Business Profile' },
    { id: 'widget',        label: 'Widget' },
  ];
  var DATA_PANELS = { today: 1, leads: 1, visitors: 1, conversations: 1, insights: 1 };

  // ============================================================
  // Small helpers
  // ============================================================
  function $(sel, root) { return (root || document).querySelector(sel); }
  function byId(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function panelEl(id) { return byId('panel-' + id); }
  function getVal(id) { var e = byId(id); return e ? e.value : ''; }
  function getChecked(id) { var e = byId(id); return !!(e && e.checked); }
  function numOrNull(id) {
    var v = getVal(id).trim();
    if (v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  // ============================================================
  // Toasts
  // ============================================================
  function toast(msg, kind) {
    var wrap = byId('toast-wrap');
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    var icon = kind === 'error' ? ICONS.alert : ICONS.check;
    t.innerHTML = icon + '<span>' + esc(msg) + '</span>';
    wrap.appendChild(t);
    setTimeout(function () {
      t.classList.add('leaving');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
    }, 3200);
  }

  // ============================================================
  // Auth + API
  // ============================================================
  function ApiError(status, message) { this.status = status; this.message = message; }
  ApiError.prototype = Object.create(Error.prototype);

  function getDataKey() { return (localStorage.getItem('golfi_dash_key') || '').trim(); }

  async function getToken() {
    var res = await sb.auth.getSession();
    return (res && res.data && res.data.session && res.data.session.access_token) || null;
  }

  async function api(path, opts) {
    opts = opts || {};
    var token = await getToken();
    var headers = {};
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.dataKey) {
      var k = getDataKey();
      if (k) headers['X-Dashboard-Key'] = k;
    }
    var res;
    try {
      res = await fetch(path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new ApiError(0, 'Network error — check your connection.');
    }
    var json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (!res.ok) {
      throw new ApiError(res.status, (json && json.error) || ('Request failed (' + res.status + ')'));
    }
    return json;
  }
  function apiData(path) { return api(path, { dataKey: true }); }

  async function loadSettings(force) {
    if (state.settingsLoaded && !force) return state.settings;
    var data = await api('/api/admin/config');
    state.settings = (data && data.settings) || {};
    state.settingsLoaded = true;
    return state.settings;
  }

  function sessionExpired() {
    showLogin('Your session expired. Please sign in again.');
    sb.auth.signOut();
  }

  // ============================================================
  // Login / console show-hide
  // ============================================================
  function showLogin(message) {
    if (state.visitorTimer) { clearInterval(state.visitorTimer); state.visitorTimer = null; }
    byId('console').hidden = true;
    var login = byId('login-screen');
    login.hidden = false;
    var err = byId('login-error');
    if (message) { err.textContent = message; err.hidden = false; }
    else { err.hidden = true; }
  }

  function enterConsole(session) {
    byId('login-screen').hidden = true;
    byId('console').hidden = false;
    var email = (session && session.user && session.user.email) || '';
    byId('topbar-user').textContent = email;
    if (!state.shellBuilt) { buildShell(); state.shellBuilt = true; }
    // Reset caches for a fresh session
    if (!getCurrentPanel()) selectPanel('today');
  }

  async function handleLogin(e) {
    e.preventDefault();
    var btn = byId('login-btn');
    var err = byId('login-error');
    err.hidden = true;
    var email = byId('login-email').value.trim();
    var pass = byId('login-password').value;
    setBtnLoading(btn, true, 'Signing in…');
    try {
      var res = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (res.error) {
        var m = res.error.message || 'Sign in failed.';
        if (/invalid login credentials/i.test(m)) m = 'Incorrect email or password.';
        err.textContent = m; err.hidden = false;
        return;
      }
      byId('login-password').value = '';
      enterConsole(res.data.session);
    } catch (ex) {
      err.textContent = 'Something went wrong. Please try again.';
      err.hidden = false;
    } finally {
      setBtnLoading(btn, false);
    }
  }

  function setBtnLoading(btn, on, label) {
    if (!btn) return;
    if (on) {
      btn.dataset.orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = label || 'Saving…';
    } else {
      btn.disabled = false;
      if (btn.dataset.orig != null) btn.textContent = btn.dataset.orig;
    }
  }

  // ============================================================
  // Shell (sidebar nav + panels)
  // ============================================================
  function buildShell() {
    var nav = byId('nav');
    nav.innerHTML = NAV.map(function (n) {
      return '<button class="nav-item" data-panel="' + n.id + '">' +
        (ICONS[n.id] || '') + '<span>' + esc(n.label) + '</span>' +
        (DATA_PANELS[n.id] ? '' : '') + '</button>';
    }).join('');
    nav.addEventListener('click', function (e) {
      var item = e.target.closest('.nav-item');
      if (item) selectPanel(item.dataset.panel);
    });

    var content = byId('content');
    content.innerHTML = NAV.map(function (n) {
      return '<section class="panel" id="panel-' + n.id + '"></section>';
    }).join('');
  }

  function getCurrentPanel() {
    var el = $('.nav-item.active');
    return el ? el.dataset.panel : null;
  }

  var RENDERERS = {
    today: renderToday,
    leads: renderLeads,
    visitors: renderVisitors,
    conversations: renderConversations,
    insights: renderInsights,
    agent: renderAgent,
    scoring: renderScoring,
    hooks: renderHooks,
    alerts: renderAlerts,
    digest: renderDigest,
    nurture: renderNurture,
    business: renderBusiness,
    widget: renderWidget,
  };

  function selectPanel(id) {
    if (state.visitorTimer) { clearInterval(state.visitorTimer); state.visitorTimer = null; }

    document.querySelectorAll('.nav-item').forEach(function (n) {
      n.classList.toggle('active', n.dataset.panel === id);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + id);
    });
    closeSidebar();

    var fn = RENDERERS[id];
    if (!fn) return;
    if (DATA_PANELS[id]) {
      fn(); // always refresh data panels
    } else if (!state.rendered[id]) {
      state.rendered[id] = true;
      fn();
    }
  }

  // ============================================================
  // Formatting helpers
  // ============================================================
  var TYPE_LABELS = {
    chat: 'Chat conversation',
    property_save: 'Saved a property',
    valuation: 'Requested home value',
    search_alert: 'Set up search alert',
    viewing: 'Booked a viewing',
    market_report: 'Market report request',
    booking: 'Booked a viewing',
  };
  var SRC_LABELS = { google: 'Google', bing: 'Bing', social: 'Social media', direct: 'Direct', referral: 'Referral' };

  function typeLabel(t) { return TYPE_LABELS[t] || (t || '').replace(/_/g, ' ') || '—'; }
  function srcLabel(s) { return SRC_LABELS[s] || (s ? esc(s) : '—'); }

  function fmtPage(path) {
    if (!path) return '—';
    var p = String(path).split('?')[0].replace(/^\//, '').replace(/\.html$/, '').replace(/-/g, ' ').trim();
    return p ? p.charAt(0).toUpperCase() + p.slice(1) : 'Home';
  }
  function fmtTime(secs) {
    secs = Number(secs) || 0;
    if (secs < 60) return secs + 's';
    var m = Math.floor(secs / 60), s = secs % 60;
    if (m < 60) return m + 'm' + (s ? ' ' + s + 's' : '');
    var h = Math.floor(m / 60); m = m % 60;
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtAgo(d) {
    if (!d) return '—';
    var diff = Date.now() - new Date(d).getTime();
    if (diff < 45000) return 'just now';
    var m = Math.round(diff / 60000);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + 'h ago';
    var days = Math.round(h / 24);
    if (days < 7) return days + 'd ago';
    return fmtDate(d);
  }
  function isToday(d) {
    var x = new Date(d), n = new Date();
    return x.getFullYear() === n.getFullYear() && x.getMonth() === n.getMonth() && x.getDate() === n.getDate();
  }
  function tempBadge(t) {
    t = t || 'cold';
    var lbl = { hot: 'Hot', warm: 'Warm', cold: 'Cold' }[t] || t;
    return '<span class="badge ' + esc(t) + '">' + esc(lbl) + '</span>';
  }
  function contactCell(l) {
    var parts = [];
    if (l.email) parts.push('<a class="t-link" href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a>');
    if (l.phone) parts.push('<a class="t-link" href="tel:' + esc(l.phone) + '">' + esc(l.phone) + '</a>');
    if (!parts.length) return '<span class="t-muted">No contact yet</span>';
    return parts.join('<br>');
  }
  function quickBtns(l) {
    var h = '';
    if (l.phone) h += '<a class="qbtn qbtn-wa" target="_blank" rel="noopener" href="https://wa.me/' + l.phone.replace(/\D/g, '') + '">WhatsApp</a>';
    if (l.email) h += '<a class="qbtn qbtn-email" href="mailto:' + esc(l.email) + '">Email</a>';
    return h || '<span class="t-muted">—</span>';
  }
  function displayName(v) {
    if (v.name) return esc(v.name);
    if (v.email) return esc(v.email);
    return '<span class="t-muted">Anonymous</span>';
  }

  // ============================================================
  // Panel head + data error helpers
  // ============================================================
  function head(title, sub, actions) {
    return '<div class="panel-head"><div><h2>' + esc(title) + '</h2>' +
      (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>' +
      (actions ? '<div class="panel-head-actions">' + actions + '</div>' : '') + '</div>';
  }
  function dataErrorHtml(err) {
    if (err && err.status === 503) {
      return '<div class="inline-error"><span>Live data isn\'t available yet — the server\'s dashboard access key hasn\'t been configured. Ask your developer to set <code>DASHBOARD_KEY</code>.</span><button class="btn btn-secondary btn-sm" data-retry>Retry</button></div>';
    }
    if (err && err.status === 401) {
      return '<div class="inline-error"><span>Add your <strong>dashboard access key</strong> in the sidebar (bottom-left) to load this data.</span><button class="btn btn-secondary btn-sm" data-setkey>Set key</button><button class="btn btn-secondary btn-sm" data-retry>Retry</button></div>';
    }
    return '<div class="inline-error"><span>' + esc((err && err.message) || 'Could not load data.') + '</span><button class="btn btn-secondary btn-sm" data-retry>Retry</button></div>';
  }
  function wireDataError(box, retry) {
    var r = box.querySelector('[data-retry]');
    if (r) r.addEventListener('click', retry);
    var s = box.querySelector('[data-setkey]');
    if (s) s.addEventListener('click', function () {
      var d = byId('datakey'); if (d) { d.open = true; openSidebar(); byId('datakey-input').focus(); }
    });
  }

  // ============================================================
  // DATA PANEL: Today
  // ============================================================
  async function renderToday() {
    var box = panelEl('today');
    box.innerHTML = head('Today', 'A quick pulse on your leads and live traffic.',
      '<button class="btn btn-secondary btn-sm" data-refresh>Refresh</button>');
    box.querySelector('[data-refresh]').addEventListener('click', renderToday);

    var body = document.createElement('div');
    body.innerHTML = '<div class="loading">Loading…</div>';
    box.appendChild(body);

    try {
      var results = await Promise.all([apiData('/api/leads'), apiData('/api/visitors')]);
      var leads = results[0].leads || [];
      var live = results[1].live || [];

      var hot = leads.filter(function (l) { return (l.temperature || 'cold') === 'hot'; });
      var todayLeads = leads.filter(function (l) { return isToday(l.created_at); });
      var openHot = hot.filter(function (l) { return ['won', 'closed', 'archived', 'contacted'].indexOf(l.status) === -1; });

      body.innerHTML =
        '<div class="stat-grid">' +
          statCard('Total leads', leads.length, 'All-time captured', ICONS.leads) +
          statCard('Hot leads', hot.length, 'High-intent right now', ICONS.alerts) +
          statCard('On the site now', live.length, 'Active in last 5 min', ICONS.visitors) +
          statCard('Leads today', todayLeads.length, fmtDate(new Date()), ICONS.today) +
        '</div>' +
        '<div class="two-col">' +
          '<div class="card card-pad"><h3 class="card-title">Hot leads needing follow-up</h3><p class="card-sub">Reach out while they\'re warm.</p>' +
            (openHot.length ? todayLeadList(openHot.slice(0, 5)) : '<div class="empty">No hot leads waiting. Nice work.</div>') +
          '</div>' +
          '<div class="card card-pad"><h3 class="card-title">On the site now</h3><p class="card-sub">Live visitors in the last 5 minutes.</p>' +
            (live.length ? todayVisitorList(live.slice(0, 5)) : '<div class="empty">Nobody browsing right now.</div>') +
          '</div>' +
        '</div>';
    } catch (err) {
      body.innerHTML = dataErrorHtml(err);
      wireDataError(body, renderToday);
    }
  }
  function statCard(label, value, foot, icon) {
    return '<div class="stat"><div class="stat-label">' + (icon || '') + esc(label) + '</div>' +
      '<div class="stat-value">' + esc(value) + '</div><div class="stat-foot">' + esc(foot) + '</div></div>';
  }
  function todayLeadList(rows) {
    return '<div class="table-wrap"><table class="table"><tbody>' + rows.map(function (l) {
      return '<tr><td class="t-name">' + (l.name ? esc(l.name) : '<span class="t-muted">Unknown</span>') + '</td>' +
        '<td>' + contactCell(l) + '</td>' +
        '<td>' + tempBadge(l.temperature) + '</td>' +
        '<td class="t-nowrap">' + quickBtns(l) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function todayVisitorList(rows) {
    return '<div class="table-wrap"><table class="table"><tbody>' + rows.map(function (v) {
      return '<tr><td class="t-name">' + displayName(v) + '</td>' +
        '<td>' + esc(fmtPage(v.current_page || v.landing_page)) + '</td>' +
        '<td><span class="badge-score">' + (v.score || 0) + '</span></td>' +
        '<td>' + tempBadge(v.temperature) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  // ============================================================
  // DATA PANEL: Leads
  // ============================================================
  async function renderLeads() {
    var box = panelEl('leads');
    box.innerHTML = head('Leads', 'Everyone the agent has captured.',
      '<button class="btn btn-secondary btn-sm" data-refresh>Refresh</button>') +
      '<div class="card card-pad">' +
        '<div class="toolbar">' +
          '<div class="chips" id="lead-chips">' +
            '<button class="chip active" data-f="all">All</button>' +
            '<button class="chip" data-f="hot">Hot</button>' +
            '<button class="chip" data-f="warm">Warm</button>' +
            '<button class="chip" data-f="cold">Cold</button>' +
          '</div>' +
          '<div class="search-box">' + ICONS.search + '<input type="text" id="lead-search" placeholder="Search name or email…"></div>' +
        '</div>' +
        '<div id="leads-body"></div>' +
      '</div>';

    box.querySelector('[data-refresh]').addEventListener('click', renderLeads);
    var body = byId('leads-body');
    body.innerHTML = '<div class="loading">Loading leads…</div>';

    try {
      var d = await apiData('/api/leads');
      leadsState.all = d.leads || [];
      leadsState.filter = 'all';
      leadsState.q = '';
      fillLeads(body);
    } catch (err) {
      body.innerHTML = dataErrorHtml(err);
      wireDataError(body, renderLeads);
      return;
    }

    byId('lead-chips').addEventListener('click', function (e) {
      var c = e.target.closest('.chip'); if (!c) return;
      document.querySelectorAll('#lead-chips .chip').forEach(function (x) { x.classList.toggle('active', x === c); });
      leadsState.filter = c.dataset.f;
      fillLeads(body);
    });
    byId('lead-search').addEventListener('input', function (e) {
      leadsState.q = e.target.value.toLowerCase().trim();
      fillLeads(body);
    });
  }
  function fillLeads(body) {
    var rows = leadsState.all;
    if (leadsState.filter !== 'all') rows = rows.filter(function (l) { return (l.temperature || 'cold') === leadsState.filter; });
    if (leadsState.q) rows = rows.filter(function (l) {
      return (l.name || '').toLowerCase().indexOf(leadsState.q) !== -1 ||
             (l.email || '').toLowerCase().indexOf(leadsState.q) !== -1;
    });
    if (!rows.length) { body.innerHTML = '<div class="empty">No leads match your filters.</div>'; return; }
    body.innerHTML =
      '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>Name</th><th>Contact</th><th>Type</th><th>Temperature</th><th>Date</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (l) {
        return '<tr>' +
          '<td class="t-name">' + (l.name ? esc(l.name) : '<span class="t-muted">Unknown</span>') + '</td>' +
          '<td>' + contactCell(l) + '</td>' +
          '<td>' + esc(typeLabel(l.type)) + '</td>' +
          '<td>' + tempBadge(l.temperature) + '</td>' +
          '<td class="t-muted t-nowrap">' + esc(fmtDate(l.created_at)) + '</td>' +
          '<td class="t-nowrap">' + quickBtns(l) + '</td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  // ============================================================
  // DATA PANEL: Live Visitors
  // ============================================================
  async function renderVisitors() {
    var box = panelEl('visitors');
    box.innerHTML = head('Live Visitors', 'Who\'s browsing now, plus high-intent anonymous sessions.',
      '<button class="btn btn-secondary btn-sm" data-refresh>Refresh</button>') +
      '<div class="card card-pad"><h3 class="card-title">On the site now</h3><p class="card-sub">Active in the last 5 minutes. Auto-refreshes every 30s.</p><div id="vis-live"></div></div>' +
      '<div class="card card-pad"><h3 class="card-title">High-interest anonymous</h3><p class="card-sub">Score 40+ with no contact captured yet.</p><div id="vis-anon"></div></div>';

    box.querySelector('[data-refresh]').addEventListener('click', function () { loadVisitors(false); });
    await loadVisitors(false);
    state.visitorTimer = setInterval(function () {
      if (getCurrentPanel() === 'visitors') loadVisitors(true);
    }, 30000);
  }
  async function loadVisitors(silent) {
    var liveEl = byId('vis-live'), anonEl = byId('vis-anon');
    if (!liveEl || !anonEl) return;
    if (!silent) { liveEl.innerHTML = '<div class="loading">Loading…</div>'; anonEl.innerHTML = ''; }
    try {
      var r = await Promise.all([apiData('/api/visitors?view=live'), apiData('/api/visitors?view=anon')]);
      liveEl.innerHTML = visitorsTable(r[0].live || [], 'live');
      anonEl.innerHTML = visitorsTable(r[1].anon || [], 'anon');
    } catch (err) {
      liveEl.innerHTML = dataErrorHtml(err); anonEl.innerHTML = '';
      wireDataError(liveEl, function () { loadVisitors(false); });
    }
  }
  function visitorsTable(rows, kind) {
    var live = kind === 'live';
    if (!rows.length) {
      return '<div class="empty">' + (live ? 'Nobody browsing right now.' : 'No high-interest anonymous visitors yet.') + '</div>';
    }
    var lastCol = live ? '<th>Visitor</th>' : '<th>Last seen</th>';
    var pageCol = live ? 'Current page' : 'Landing page';
    return '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>Score</th><th>Temp</th><th>' + pageCol + '</th><th>Visits</th><th>Pages</th><th>Time</th><th>Source</th>' + lastCol +
      '</tr></thead><tbody>' +
      rows.map(function (v) {
        var last = live ? ('<td>' + displayName(v) + '</td>')
                        : ('<td class="t-muted t-nowrap">' + esc(fmtAgo(v.last_seen)) + '</td>');
        return '<tr>' +
          '<td><span class="badge-score">' + (v.score || 0) + '</span></td>' +
          '<td>' + tempBadge(v.temperature) + '</td>' +
          '<td>' + esc(fmtPage(live ? v.current_page : v.landing_page)) + '</td>' +
          '<td>' + (v.session_count || 1) + '</td>' +
          '<td>' + (v.page_views || 0) + '</td>' +
          '<td class="t-nowrap">' + esc(fmtTime(v.total_seconds)) + '</td>' +
          '<td class="t-muted">' + srcLabel(v.traffic_source) + '</td>' +
          last +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  // ============================================================
  // DATA PANEL: Conversations
  // ============================================================
  async function renderConversations() {
    var box = panelEl('conversations');
    box.innerHTML = head('Conversations', 'Chat sessions the agent has had.',
      '<button class="btn btn-secondary btn-sm" data-refresh>Refresh</button>') +
      '<div class="card card-pad"><div class="convo-layout">' +
        '<div id="convo-list" class="convo-list"></div>' +
        '<div id="convo-view" class="transcript"><div class="empty">Select a conversation to view its transcript.</div></div>' +
      '</div></div>';

    box.querySelector('[data-refresh]').addEventListener('click', renderConversations);
    var listEl = byId('convo-list');
    listEl.innerHTML = '<div class="loading">Loading…</div>';

    try {
      var d = await apiData('/api/leads');
      var leads = d.leads || [];
      var map = new Map();
      leads.forEach(function (l) {
        if (!l.session_id) return;
        var isChat = l.type === 'chat' || (l.data && l.data.conversation_snippet);
        if (!isChat) return;
        if (!map.has(l.session_id)) map.set(l.session_id, l);
      });
      var convos = Array.from(map.values());
      if (!convos.length) { listEl.innerHTML = '<div class="empty">No chat conversations yet.</div>'; return; }
      listEl.innerHTML = convos.map(convoItem).join('');
      listEl.addEventListener('click', function (e) {
        var it = e.target.closest('.convo-item'); if (!it) return;
        listEl.querySelectorAll('.convo-item').forEach(function (x) { x.classList.toggle('active', x === it); });
        openTranscript(it.dataset.sid, map.get(it.dataset.sid));
      });
    } catch (err) {
      listEl.innerHTML = dataErrorHtml(err);
      wireDataError(listEl, renderConversations);
    }
  }
  function convoItem(l) {
    var snip = l.data && l.data.conversation_snippet;
    var preview = Array.isArray(snip) ? (snip.length ? (snip[snip.length - 1].content || '') : '')
                : (typeof snip === 'string' ? snip : '');
    return '<div class="convo-item" data-sid="' + esc(l.session_id) + '">' +
      '<div class="ci-name">' + (l.name ? esc(l.name) : 'Anonymous') + '</div>' +
      '<div class="ci-meta">' + esc(typeLabel(l.type)) + ' · ' + esc(fmtDate(l.created_at)) + '</div>' +
      (preview ? '<div class="ci-snip">' + esc(preview) + '</div>' : '') +
    '</div>';
  }
  async function openTranscript(sid, lead) {
    var view = byId('convo-view');
    view.innerHTML = '<div class="loading">Loading transcript…</div>';
    try {
      var d = await apiData('/api/visitors?view=journey&session=' + encodeURIComponent(sid));
      view.innerHTML = transcriptHtml(lead || {}, d.events || [], d.visitor || null);
    } catch (err) {
      view.innerHTML = dataErrorHtml(err);
      wireDataError(view, function () { openTranscript(sid, lead); });
    }
  }
  function transcriptHtml(lead, events, visitor) {
    var header = '<div style="margin-bottom:16px">' +
      '<div class="t-name" style="font-size:15px">' + (lead.name ? esc(lead.name) : 'Anonymous') + '</div>' +
      '<div class="t-muted" style="font-size:12.5px">' +
        (lead.email ? esc(lead.email) : '') +
        (lead.phone ? (lead.email ? ' · ' : '') + esc(lead.phone) : '') +
        (visitor ? ' · score ' + (visitor.score || 0) : '') +
      '</div></div>';

    var body = '';
    var snip = lead.data && lead.data.conversation_snippet;
    if (Array.isArray(snip)) {
      body += snip.map(function (m) { return msgBubble(m.role || 'assistant', m.content || ''); }).join('');
    } else if (typeof snip === 'string' && snip.trim()) {
      body += msgBubble('assistant', snip);
    }

    var evs = (events || []).filter(Boolean);
    if (evs.length) {
      body += '<div class="form-section-title" style="margin-top:20px">Session journey</div>' +
        evs.map(eventLine).join('');
    }
    if (!body) body = '<div class="empty">No transcript available for this session.</div>';
    return header + body;
  }
  function msgBubble(role, content) {
    var who = role === 'user' ? 'Visitor' : 'Agent';
    var cls = role === 'user' ? 'user' : 'assistant';
    return '<div class="msg ' + cls + '"><div class="who">' + who + '</div><div class="bubble">' + esc(content) + '</div></div>';
  }
  function eventLine(e) {
    var detail = '';
    if (e.data) {
      if (e.data.propertyId) detail = 'Property ' + e.data.propertyId;
      else if (e.data.query) detail = 'Search: ' + e.data.query;
      else if (e.data.page) detail = fmtPage(e.data.page);
    }
    return '<div class="event-line"><span class="ev-time">' + esc(fmtDate(e.created_at)) + '</span>' +
      '<span class="ev-type">' + esc(typeLabel(e.type)) + '</span>' +
      (detail ? '<span class="t-muted">' + esc(detail) + '</span>' : '') + '</div>';
  }

  // ============================================================
  // DATA PANEL: Insights
  // ============================================================
  var insightsState = { days: 7 };

  async function renderInsights() {
    var box = panelEl('insights');
    box.innerHTML = head('Insights', 'Where your traffic and leads come from.',
      '<div class="chips" id="insights-range">' +
        '<button class="chip' + (insightsState.days === 7 ? ' active' : '') + '" data-d="7">Last 7 days</button>' +
        '<button class="chip' + (insightsState.days === 30 ? ' active' : '') + '" data-d="30">Last 30 days</button>' +
      '</div>' +
      '<button class="btn btn-secondary btn-sm" data-refresh>Refresh</button>');

    box.querySelector('[data-refresh]').addEventListener('click', function () { loadInsights(); });
    box.querySelector('#insights-range').addEventListener('click', function (e) {
      var c = e.target.closest('.chip'); if (!c) return;
      insightsState.days = Number(c.dataset.d) || 7;
      document.querySelectorAll('#insights-range .chip').forEach(function (x) { x.classList.toggle('active', x === c); });
      loadInsights();
    });

    var body = document.createElement('div');
    body.id = 'insights-body';
    box.appendChild(body);
    await loadInsights();
  }

  async function loadInsights() {
    var body = byId('insights-body');
    if (!body) return;
    body.innerHTML = '<div class="loading">Loading insights…</div>';
    try {
      var d = await api('/api/admin/insights?days=' + insightsState.days);
      body.innerHTML = insightsHtml(d.insights || {});
    } catch (err) {
      if (err.status === 401) { sessionExpired(); return; }
      body.innerHTML = dataErrorHtml(err);
      wireDataError(body, loadInsights);
    }
  }

  function insightsHtml(ins) {
    var f = ins.funnel || {};
    var visitors = f.visitors || 0, engaged = f.engaged || 0, identified = f.identified || 0, hot = f.hot || 0;
    var win = (ins.window && ins.window.days) || insightsState.days;
    function pct(n, base) { return base > 0 ? Math.round((n / base) * 100) + '% of previous' : '—'; }

    var funnel =
      '<div class="stat-grid">' +
        statCard('Visitors', visitors, 'All visitors tracked', ICONS.visitors) +
        statCard('Engaged', engaged, pct(engaged, visitors), ICONS.scoring) +
        statCard('Identified', identified, pct(identified, engaged), ICONS.leads) +
        statCard('Hot', hot, pct(hot, identified), ICONS.alerts) +
      '</div>';

    var meta = '<div class="insights-meta">Property searches in the last ' + esc(win) +
      ' days: <strong>' + esc(ins.searchVolume || 0) + '</strong></div>';

    var sources = (ins.trafficSources || []).map(function (s) { return { label: srcLabel(s.source), value: s.count }; });
    var byType = (ins.leadsByType || []).map(function (t) { return { label: typeLabel(t.type), value: t.count }; });
    var twoCol =
      '<div class="two-col">' +
        '<div class="card card-pad"><h3 class="card-title">Traffic sources</h3>' +
          '<p class="card-sub">Where visitors came from in this window.</p>' + barList(sources) +
        '</div>' +
        '<div class="card card-pad"><h3 class="card-title">Leads by type</h3>' +
          '<p class="card-sub">What visitors asked the agent for.</p>' + barList(byType) +
        '</div>' +
      '</div>';

    var mv = ins.mostViewedProperties || [];
    var mostViewed =
      '<div class="card card-pad"><h3 class="card-title">Most-viewed listings</h3>' +
        '<p class="card-sub">Top properties by views in this window.</p>' +
        (mv.length
          ? '<div class="table-wrap"><table class="table"><thead><tr><th>Property</th><th>Views</th><th>Unique sessions</th></tr></thead><tbody>' +
            mv.map(function (p) {
              var title = p.title || ('Property ' + (p.propertyId != null ? p.propertyId : '—'));
              return '<tr><td class="t-name">' + esc(title) + '</td>' +
                '<td>' + (p.views || 0) + '</td>' +
                '<td>' + (p.uniqueSessions || 0) + '</td></tr>';
            }).join('') +
            '</tbody></table></div>'
          : '<div class="empty">No property views in this window yet.</div>') +
      '</div>';

    var byDay = (ins.leadsByDay || []).map(function (dd) { return { label: fmtDay(dd.date), value: dd.count }; });
    var leadsByDay =
      '<div class="card card-pad"><h3 class="card-title">Leads by day</h3>' +
        '<p class="card-sub">New leads captured per day.</p>' + barList(byDay) +
      '</div>';

    return funnel + meta + twoCol + mostViewed + leadsByDay;
  }

  function barList(items) {
    items = items || [];
    if (!items.length) return '<div class="empty">No data in this window yet.</div>';
    var max = items.reduce(function (m, it) { return Math.max(m, Number(it.value) || 0); }, 0);
    return '<div class="bar-list">' + items.map(function (it) {
      var v = Number(it.value) || 0;
      var w = max > 0 ? Math.max(3, Math.round((v / max) * 100)) : 0;
      return '<div class="bar-row">' +
        '<div class="bar-label" title="' + esc(it.label) + '">' + esc(it.label) + '</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + w + '%"></div></div>' +
        '<div class="bar-val">' + esc(v) + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function fmtDay(d) {
    if (!d) return '—';
    var parts = String(d).split('-');
    if (parts.length === 3) {
      var dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!isNaN(dt.getTime())) return dt.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    }
    return String(d);
  }

  // ============================================================
  // CONFIG form field builders
  // ============================================================
  function textField(id, label, val, opts) {
    opts = opts || {};
    return '<div class="form-group' + (opts.span ? ' span-2' : '') + '">' +
      '<label for="' + id + '">' + esc(label) + '</label>' +
      '<input type="' + (opts.type || 'text') + '" id="' + id + '" value="' + esc(val == null ? '' : val) + '">' +
      (opts.hint ? '<div class="field-hint">' + esc(opts.hint) + '</div>' : '') + '</div>';
  }
  function areaField(id, label, val, opts) {
    opts = opts || {};
    return '<div class="form-group span-2"><label for="' + id + '">' + esc(label) + '</label>' +
      '<textarea id="' + id + '"' + (opts.rows ? ' rows="' + opts.rows + '"' : '') + '>' + esc(val == null ? '' : val) + '</textarea>' +
      (opts.hint ? '<div class="field-hint">' + esc(opts.hint) + '</div>' : '') + '</div>';
  }
  function numField(id, label, val, opts) {
    opts = opts || {};
    return '<div class="form-group" id="wrap-' + id + '"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input type="number" id="' + id + '" value="' + (val == null || val === '' ? '' : esc(val)) + '"' +
      (opts.min != null ? ' min="' + opts.min + '"' : '') +
      (opts.max != null ? ' max="' + opts.max + '"' : '') +
      ' step="' + (opts.step || 1) + '">' +
      (opts.hint ? '<div class="field-hint">' + esc(opts.hint) + '</div>' : '') + '</div>';
  }
  function selectField(id, label, val, options, hint) {
    var opts = options.map(function (o) {
      var v = typeof o === 'string' ? o : o.value;
      var t = typeof o === 'string' ? o : o.label;
      return '<option value="' + esc(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(t) + '</option>';
    }).join('');
    return '<div class="form-group"><label for="' + id + '">' + esc(label) + '</label><select id="' + id + '">' + opts + '</select>' +
      (hint ? '<div class="field-hint">' + esc(hint) + '</div>' : '') + '</div>';
  }
  function colorField(id, label, val, hint) {
    var v = val || '#000000';
    return '<div class="form-group"><label for="' + id + '">' + esc(label) + '</label>' +
      '<div class="color-row"><input type="color" id="' + id + '-c" value="' + esc(v) + '">' +
      '<input type="text" id="' + id + '" value="' + esc(v) + '"></div>' +
      (hint ? '<div class="field-hint">' + esc(hint) + '</div>' : '') + '</div>';
  }
  function toggleField(id, label, checked, desc) {
    return '<div class="toggle-row"><div><div class="toggle-label">' + esc(label) + '</div>' +
      (desc ? '<div class="toggle-desc">' + esc(desc) + '</div>' : '') + '</div>' +
      '<label class="toggle"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><span class="track"></span></label></div>';
  }
  function formFoot() {
    return '<div class="form-foot"><button type="button" class="btn btn-primary" data-save>Save changes</button>' +
      '<span class="dirty-flag" data-dirty>Unsaved changes</span></div>';
  }

  function markDirty(category) {
    state.dirty[category] = true;
    var f = document.querySelector('#panel-' + category + ' [data-dirty]');
    if (f) f.classList.add('show');
  }
  function clearDirty(category) {
    state.dirty[category] = false;
    var f = document.querySelector('#panel-' + category + ' [data-dirty]');
    if (f) f.classList.remove('show');
  }

  async function saveConfig(category, value, btn) {
    setBtnLoading(btn, true);
    try {
      await api('/api/admin/config', { method: 'POST', body: { key: category, value: value } });
      state.settings[category] = value;
      clearDirty(category);
      toast('Changes saved', 'success');
      return true;
    } catch (err) {
      if (err.status === 401) { sessionExpired(); return false; }
      toast(err.message || 'Could not save changes', 'error');
      return false;
    } finally {
      setBtnLoading(btn, false);
    }
  }

  // Generic config panel scaffolding: load settings, build form, wire save + dirty.
  async function renderConfig(id, title, sub, build) {
    var box = panelEl(id);
    box.innerHTML = head(title, sub, '<button class="btn btn-secondary btn-sm" data-reload>Reload</button>');
    var bodyWrap = document.createElement('div');
    box.appendChild(bodyWrap);

    async function paint() {
      bodyWrap.innerHTML = '<div class="loading">Loading settings…</div>';
      try {
        await loadSettings();
      } catch (err) {
        if (err.status === 401) { sessionExpired(); return; }
        bodyWrap.innerHTML = '<div class="inline-error"><span>' + esc(err.message || 'Could not load settings.') + '</span><button class="btn btn-secondary btn-sm" data-retry>Retry</button></div>';
        var r = bodyWrap.querySelector('[data-retry]'); if (r) r.addEventListener('click', paint);
        return;
      }
      var built = build(state.settings[id] || {}); // { html, collect, afterMount? }
      bodyWrap.innerHTML = built.html;
      if (built.afterMount) built.afterMount(bodyWrap);
      wireForm(id, bodyWrap, built.collect);
      clearDirty(id);
    }

    box.querySelector('[data-reload]').addEventListener('click', async function () {
      await loadSettings(true).catch(function () {});
      await paint();
      toast('Reloaded latest settings');
    });
    await paint();
  }

  function wireForm(category, bodyWrap, collect) {
    var save = bodyWrap.querySelector('[data-save]');
    var mark = function () { markDirty(category); };
    bodyWrap.addEventListener('input', mark);
    bodyWrap.addEventListener('change', mark);
    if (save) save.addEventListener('click', async function () {
      var res = collect(bodyWrap);
      if (!res.ok) { toast(res.error || 'Please fix the highlighted fields.', 'error'); return; }
      await saveConfig(category, res.value, save);
    });
  }

  // ============================================================
  // CONFIG PANEL: Agent Settings
  // ============================================================
  function renderAgent() {
    renderConfig('agent', 'Agent Settings', 'Shape how your AI agent speaks and what it knows.', function (a) {
      var models = ['claude-sonnet-4-5', 'claude-haiku-4-5'];
      if (a.model && models.indexOf(a.model) === -1) models.unshift(a.model);
      var nbs = a.neighbourhoods || [];

      var html = '<div class="card card-pad">' +
        '<div class="form-grid">' +
          selectField('agent-model', 'Model', a.model || '', models, 'Sonnet is smartest; Haiku is faster and cheaper.') +
        '</div>' +
        '<div class="form-section-title">Voice &amp; behaviour</div>' +
        '<div class="form-grid">' +
          areaField('agent-personality', 'Personality', a.personality, { rows: 3, hint: 'How the agent should come across — tone, warmth, professionalism.' }) +
          areaField('agent-greeting', 'Greeting', a.greeting, { rows: 2, hint: 'The first message a visitor sees when the chat opens.' }) +
          areaField('agent-marketContext', 'Market context', a.marketContext, { rows: 3, hint: 'Background on the local market the agent should reference.' }) +
          areaField('agent-rules', 'Rules', a.rules, { rows: 3, hint: 'Hard rules the agent must always follow.' }) +
        '</div>' +
        '<div class="form-section-title">Neighbourhood expertise</div>' +
        '<div id="nb-list">' + nbs.map(nbRow).join('') + '</div>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="nb-add">Add neighbourhood</button>' +
        formFoot() +
      '</div>';

      function afterMount(root) {
        root.querySelector('#nb-add').addEventListener('click', function () {
          root.querySelector('#nb-list').insertAdjacentHTML('beforeend', nbRow({}));
          markDirty('agent');
        });
        root.querySelector('#nb-list').addEventListener('click', function (e) {
          var b = e.target.closest('.nb-remove');
          if (b) { b.closest('.nb-row').remove(); markDirty('agent'); }
        });
      }

      function collect(root) {
        var nbs = Array.from(root.querySelectorAll('.nb-row')).map(function (r) {
          return {
            area: r.querySelector('.nb-area').value.trim(),
            note: r.querySelector('.nb-note').value.trim(),
            range: r.querySelector('.nb-range').value.trim(),
          };
        }).filter(function (n) { return n.area || n.note || n.range; });
        return { ok: true, value: {
          model: getVal('agent-model'),
          personality: getVal('agent-personality'),
          greeting: getVal('agent-greeting'),
          marketContext: getVal('agent-marketContext'),
          rules: getVal('agent-rules'),
          neighbourhoods: nbs,
        } };
      }

      return { html: html, afterMount: afterMount, collect: collect };
    });
  }
  function nbRow(nb) {
    nb = nb || {};
    return '<div class="repeat-row nb-row">' +
      '<input type="text" class="nb-area" placeholder="Area" value="' + esc(nb.area || '') + '">' +
      '<input type="text" class="nb-note" placeholder="Note" value="' + esc(nb.note || '') + '">' +
      '<input type="text" class="nb-range" placeholder="Price range" value="' + esc(nb.range || '') + '">' +
      '<button type="button" class="icon-btn nb-remove" title="Remove">' + ICONS.trash + '</button>' +
    '</div>';
  }

  // ============================================================
  // CONFIG PANEL: Scoring Rules
  // ============================================================
  var SCORING_FIELDS = [
    { k: 'returnVisitPoints', l: 'Points per return visit' }, { k: 'returnVisitCap', l: 'Return visit cap' },
    { k: 'pageViewPoints', l: 'Points per page view' },       { k: 'pageViewCap', l: 'Page view cap' },
    { k: 'propertyPoints', l: 'Points per property viewed' }, { k: 'propertyCap', l: 'Property view cap' },
    { k: 'repeatViewPoints', l: 'Points per repeat view' },   { k: 'repeatViewCap', l: 'Repeat view cap' },
    { k: 'searchPoints', l: 'Points per search' },            { k: 'searchCap', l: 'Search cap' },
    { k: 'timePointsPerMin', l: 'Points per minute on site' },{ k: 'timeCap', l: 'Time on site cap' },
  ];
  var SCORING_BONUS = [
    { k: 'savedBonus', l: 'Saved a property (bonus)' },
    { k: 'exitBonus', l: 'Exit intent shown (bonus)' },
  ];
  var SCORING_THRESH = [
    { k: 'hotThreshold', l: 'Hot threshold (score ≥)' },
    { k: 'warmThreshold', l: 'Warm threshold (score ≥)' },
  ];
  var SCORING_ALL = SCORING_FIELDS.concat(SCORING_BONUS, SCORING_THRESH);

  function renderScoring() {
    renderConfig('scoring', 'Scoring Rules', 'Tune how visitor intent is scored from 0–100.', function (s) {
      function fields(list) {
        return list.map(function (f) { return numField('scoring-' + f.k, f.l, s[f.k], { min: 0 }); }).join('');
      }
      var html = '<div class="card card-pad">' +
        '<div class="form-section-title">Points &amp; caps</div>' +
        '<div class="form-grid">' + fields(SCORING_FIELDS) + '</div>' +
        '<div class="form-section-title">Bonuses</div>' +
        '<div class="form-grid">' + fields(SCORING_BONUS) + '</div>' +
        '<div class="form-section-title">Temperature thresholds</div>' +
        '<div class="form-grid">' + fields(SCORING_THRESH) + '</div>' +
        '<div class="live-note" id="scoring-note"></div>' +
        formFoot() +
      '</div>';

      function afterMount(root) {
        var note = root.querySelector('#scoring-note');
        function upd() { note.innerHTML = scoringNote(); }
        root.addEventListener('input', upd);
        upd();
      }

      function collect() {
        var value = {}; var invalid = [];
        SCORING_ALL.forEach(function (f) {
          var n = numOrNull('scoring-' + f.k);
          var wrap = byId('wrap-scoring-' + f.k);
          if (n == null) { invalid.push(f.k); if (wrap) wrap.classList.add('field-invalid'); }
          else { value[f.k] = n; if (wrap) wrap.classList.remove('field-invalid'); }
        });
        if (invalid.length) return { ok: false, error: 'Every scoring value must be a number.' };
        return { ok: true, value: value };
      }

      return { html: html, afterMount: afterMount, collect: collect };
    });
  }
  function scoringNote() {
    function g(k) { return Number(getVal('scoring-' + k)) || 0; }
    function cap(v, c) { return c > 0 ? Math.min(v, c) : v; }
    var ret = cap(2 * g('returnVisitPoints'), g('returnVisitCap'));
    var props = cap(3 * g('propertyPoints'), g('propertyCap'));
    var total = Math.max(0, Math.min(100, Math.round(ret + props)));
    var hot = g('hotThreshold'), warm = g('warmThreshold');
    var band = total >= hot ? 'Hot' : (total >= warm ? 'Warm' : 'Cold');
    return 'A visitor who returns twice and views 3 properties would score about <strong>' + total +
      '</strong> — that lands them in the <strong>' + band + '</strong> band.';
  }

  // ============================================================
  // CONFIG PANEL: Capture Hooks
  // ============================================================
  var HOOK_DEFS = [
    { key: 'propertySave',   title: 'Property Save',    fields: ['threshold', 'headline', 'button'] },
    { key: 'exitIntent',     title: 'Exit Intent',      fields: ['headline', 'sub', 'button'] },
    { key: 'searchAlert',    title: 'Search Alert',     fields: ['threshold', 'headline', 'button'] },
    { key: 'returnVisitor',  title: 'Return Visitor',   fields: ['headline', 'button'] },
    { key: 'booking',        title: 'Booking Prompt',   fields: ['headline', 'button'] },
    { key: 'smartRecapture', title: 'Smart Recapture',  fields: ['scoreThreshold'] },
  ];
  var HOOK_LABEL = {
    threshold: 'Trigger threshold', scoreThreshold: 'Score threshold',
    headline: 'Headline', sub: 'Subtext', button: 'Button label',
  };
  function renderHooks() {
    renderConfig('hooks', 'Capture Hooks', 'The prompts that turn browsers into leads. Toggle and reword each.', function (h) {
      var cards = HOOK_DEFS.map(function (def) {
        var hk = h[def.key] || {};
        var body = def.fields.map(function (f) {
          var id = 'hooks-' + def.key + '-' + f;
          if (f === 'threshold' || f === 'scoreThreshold') return numField(id, HOOK_LABEL[f], hk[f], { min: 0 });
          if (f === 'sub') return areaField(id, HOOK_LABEL[f], hk[f], { rows: 2 });
          return textField(id, HOOK_LABEL[f], hk[f], { span: (f === 'headline') });
        }).join('');
        return '<div class="subcard"><div class="subcard-head"><h4>' + esc(def.title) + '</h4>' +
          '<label class="toggle"><input type="checkbox" id="hooks-' + def.key + '-enabled"' + (hk.enabled ? ' checked' : '') + '><span class="track"></span></label>' +
          '</div><div class="form-grid">' + body + '</div></div>';
      }).join('');

      var html = '<div class="card card-pad">' + cards + formFoot() + '</div>';

      function collect() {
        var value = {};
        HOOK_DEFS.forEach(function (def) {
          var o = { enabled: getChecked('hooks-' + def.key + '-enabled') };
          def.fields.forEach(function (f) {
            var id = 'hooks-' + def.key + '-' + f;
            o[f] = (f === 'threshold' || f === 'scoreThreshold') ? numOrNull(id) : getVal(id);
          });
          value[def.key] = o;
        });
        return { ok: true, value: value };
      }
      return { html: html, collect: collect };
    });
  }

  // ============================================================
  // CONFIG PANEL: Alerts
  // ============================================================
  function renderAlerts() {
    renderConfig('alerts', 'Alerts', 'Get notified the moment a lead heats up.', function (a) {
      var html = '<div class="card card-pad">' +
        '<div class="form-section-title">Channels</div>' +
        toggleField('alerts-whatsappEnabled', 'WhatsApp alerts', a.whatsappEnabled, 'Send a WhatsApp message when a lead qualifies.') +
        toggleField('alerts-emailEnabled', 'Email alerts', a.emailEnabled, 'Send an email when a lead qualifies.') +
        '<div class="form-grid" style="margin-top:14px">' +
          textField('alerts-whatsappTo', 'WhatsApp number', a.whatsappTo, { type: 'tel', hint: 'Include country code, e.g. +1…' }) +
          textField('alerts-alertEmail', 'Alert email', a.alertEmail, { type: 'email' }) +
        '</div>' +
        '<div class="form-section-title">Rules</div>' +
        '<div class="form-grid">' +
          selectField('alerts-alertOnTemperature', 'Alert me when a lead is at least', a.alertOnTemperature || 'hot',
            [{ value: 'hot', label: 'Hot' }, { value: 'warm', label: 'Warm' }, { value: 'cold', label: 'Cold' }]) +
        '</div>' +
        '<div class="form-section-title">Quiet hours</div>' +
        '<div class="form-grid">' +
          numField('alerts-quietHoursStart', 'Quiet hours start (0–23)', a.quietHoursStart, { min: 0, max: 23 }) +
          numField('alerts-quietHoursEnd', 'Quiet hours end (0–23)', a.quietHoursEnd, { min: 0, max: 23 }) +
        '</div>' +
        '<div class="field-hint">No alerts are sent between these times.</div>' +
        formFoot() +
      '</div>';

      function collect() {
        return { ok: true, value: {
          whatsappEnabled: getChecked('alerts-whatsappEnabled'),
          emailEnabled: getChecked('alerts-emailEnabled'),
          whatsappTo: getVal('alerts-whatsappTo').trim(),
          alertEmail: getVal('alerts-alertEmail').trim(),
          alertOnTemperature: getVal('alerts-alertOnTemperature'),
          quietHoursStart: numOrNull('alerts-quietHoursStart'),
          quietHoursEnd: numOrNull('alerts-quietHoursEnd'),
        } };
      }
      return { html: html, collect: collect };
    });
  }

  // ============================================================
  // CONFIG PANEL: Business Profile
  // ============================================================
  function renderBusiness() {
    renderConfig('business', 'Business Profile', 'The facts the agent uses to represent you.', function (b) {
      var html = '<div class="card card-pad"><div class="form-grid">' +
        textField('business-name', 'Business name', b.name) +
        textField('business-brokerage', 'Brokerage', b.brokerage) +
        textField('business-phone', 'Phone', b.phone, { type: 'tel' }) +
        textField('business-email', 'Email', b.email, { type: 'email' }) +
        textField('business-address', 'Address', b.address, { span: true }) +
        textField('business-market', 'Market / area served', b.market) +
        textField('business-since', 'In business since', b.since) +
        textField('business-hours', 'Hours', b.hours, { span: true, hint: 'e.g. Mon–Fri 9am–6pm, Sat 10am–4pm' }) +
      '</div>' + formFoot() + '</div>';

      function collect() {
        return { ok: true, value: {
          name: getVal('business-name').trim(),
          brokerage: getVal('business-brokerage').trim(),
          phone: getVal('business-phone').trim(),
          email: getVal('business-email').trim(),
          address: getVal('business-address').trim(),
          market: getVal('business-market').trim(),
          since: getVal('business-since').trim(),
          hours: getVal('business-hours').trim(),
        } };
      }
      return { html: html, collect: collect };
    });
  }

  // ============================================================
  // CONFIG PANEL: Widget
  // ============================================================
  function renderWidget() {
    renderConfig('widget', 'Widget', 'How the chat widget looks and where it sits.', function (w) {
      var positions = [
        { value: 'bottom-right', label: 'Bottom right' },
        { value: 'bottom-left', label: 'Bottom left' },
        { value: 'top-right', label: 'Top right' },
        { value: 'top-left', label: 'Top left' },
      ];
      var html = '<div class="card card-pad">' +
        toggleField('widget-enabled', 'Widget enabled', w.enabled, 'Show the chat widget on the public site.') +
        '<div class="form-section-title">Appearance</div>' +
        '<div class="form-grid">' +
          colorField('widget-primaryColor', 'Primary colour', w.primaryColor, 'Main button and header colour.') +
          colorField('widget-accentColor', 'Accent colour', w.accentColor) +
          selectField('widget-position', 'Position', w.position || 'bottom-right', positions) +
        '</div>' +
        '<div class="form-section-title">Copy</div>' +
        '<div class="form-grid">' +
          textField('widget-title', 'Title', w.title, { span: true }) +
          textField('widget-subtitle', 'Subtitle', w.subtitle, { span: true }) +
        '</div>' +
        formFoot() +
      '</div>';

      function afterMount(root) {
        ['widget-primaryColor', 'widget-accentColor'].forEach(function (id) {
          var t = root.querySelector('#' + id), c = root.querySelector('#' + id + '-c');
          if (!t || !c) return;
          c.addEventListener('input', function () { t.value = c.value; markDirty('widget'); });
          t.addEventListener('input', function () {
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t.value)) c.value = t.value;
          });
        });
      }
      function collect() {
        return { ok: true, value: {
          enabled: getChecked('widget-enabled'),
          primaryColor: getVal('widget-primaryColor').trim(),
          accentColor: getVal('widget-accentColor').trim(),
          position: getVal('widget-position'),
          title: getVal('widget-title').trim(),
          subtitle: getVal('widget-subtitle').trim(),
        } };
      }
      return { html: html, afterMount: afterMount, collect: collect };
    });
  }

  // ============================================================
  // CONFIG PANEL: Daily Digest
  // ============================================================
  function renderDigest() {
    renderConfig('digest', 'Daily Digest', 'A morning email summarising overnight leads and activity.', function (dg) {
      var html = '<div class="card card-pad">' +
        toggleField('digest-enabled', 'Daily digest enabled', dg.enabled, 'Send a summary email once a day.') +
        '<div class="form-grid" style="margin-top:14px">' +
          textField('digest-recipient', 'Recipient email', dg.recipient, { type: 'email', hint: 'Where the digest is sent each morning.' }) +
          numField('digest-sendHour', 'Send hour (0–23)', dg.sendHour, { min: 0, max: 23, hint: 'Local hour to send, e.g. 7 for 7am.' }) +
        '</div>' +
        '<div class="form-section-title">Include in the digest</div>' +
        toggleField('digest-includeHotLeads', 'Hot leads', dg.includeHotLeads, 'New hot leads that need follow-up.') +
        toggleField('digest-includeAnonymous', 'High-intent anonymous', dg.includeAnonymous, 'Anonymous visitors with a high score.') +
        toggleField('digest-includeInsights', 'Insights summary', dg.includeInsights, 'Funnel and top listings from the last day.') +
        toggleField('digest-includeMarketStat', 'Market stat', dg.includeMarketStat, 'A market highlight to share.') +
        '<div class="form-foot">' +
          '<button type="button" class="btn btn-primary" data-save>Save changes</button>' +
          '<button type="button" class="btn btn-secondary" id="digest-test">Send test now</button>' +
          '<span class="dirty-flag" data-dirty>Unsaved changes</span>' +
        '</div>' +
      '</div>';

      function afterMount(root) {
        var testBtn = root.querySelector('#digest-test');
        testBtn.addEventListener('click', function () { sendTestDigest(testBtn); });
      }

      function collect() {
        var hour = numOrNull('digest-sendHour');
        var wrap = byId('wrap-digest-sendHour');
        if (hour == null || hour < 0 || hour > 23) {
          if (wrap) wrap.classList.add('field-invalid');
          return { ok: false, error: 'Send hour must be a number between 0 and 23.' };
        }
        if (wrap) wrap.classList.remove('field-invalid');
        return { ok: true, value: {
          enabled: getChecked('digest-enabled'),
          recipient: getVal('digest-recipient').trim(),
          sendHour: hour,
          includeHotLeads: getChecked('digest-includeHotLeads'),
          includeAnonymous: getChecked('digest-includeAnonymous'),
          includeInsights: getChecked('digest-includeInsights'),
          includeMarketStat: getChecked('digest-includeMarketStat'),
        } };
      }

      return { html: html, afterMount: afterMount, collect: collect };
    });
  }

  async function sendTestDigest(btn) {
    setBtnLoading(btn, true, 'Sending…');
    try {
      var r = await api('/api/cron/digest', { method: 'POST', body: { test: true } });
      digestResult(r);
    } catch (err) {
      if (err.status === 401) { sessionExpired(); return; }
      toast(err.message || 'Could not send the test digest.', 'error');
    } finally {
      setBtnLoading(btn, false);
    }
  }

  function digestResult(r) {
    r = r || {};
    if (r.skipped === 'disabled') { toast('Turn on Daily Digest and save it before sending a test.', 'error'); return; }
    if (r.sent === true) {
      var c = r.counts || {};
      var bits = [];
      if (typeof c.hotLeads === 'number') bits.push(c.hotLeads + ' hot lead' + (c.hotLeads === 1 ? '' : 's'));
      if (typeof c.anon === 'number') bits.push(c.anon + ' anonymous');
      toast('Test digest sent' + (bits.length ? ' — ' + bits.join(', ') : '') + '.', 'success');
      return;
    }
    if (r.skipped) { toast('Saved — the digest will email once your Resend key is added.'); return; }
    if (r.error) { toast(r.error, 'error'); return; }
    toast('Digest run complete.', 'success');
  }

  // ============================================================
  // CONFIG PANEL: Nurture Sequences
  // ============================================================
  function renderNurture() {
    renderConfig('nurture', 'Nurture Sequences', 'Automated follow-up emails sent to new leads over time.', function (nu) {
      var steps = Array.isArray(nu.steps) ? nu.steps : [];
      var html = '<div class="card card-pad">' +
        toggleField('nurture-enabled', 'Nurture sequence enabled', nu.enabled, 'Automatically email leads on a schedule.') +
        '<div class="form-section-title">Steps</div>' +
        '<div id="nurture-steps">' + steps.map(nurtureStepRow).join('') + '</div>' +
        '<button type="button" class="btn btn-secondary btn-sm" id="nurture-add">Add step</button>' +
        formFoot() +
      '</div>';

      function afterMount(root) {
        var list = root.querySelector('#nurture-steps');
        root.querySelector('#nurture-add').addEventListener('click', function () {
          list.insertAdjacentHTML('beforeend', nurtureStepRow({}));
          markDirty('nurture');
        });
        list.addEventListener('click', function (e) {
          var b = e.target.closest('.nurture-remove');
          if (b) { b.closest('.nurture-step').remove(); markDirty('nurture'); }
        });
      }

      function collect(root) {
        var invalid = false;
        var out = [];
        Array.from(root.querySelectorAll('.nurture-step')).forEach(function (r) {
          var dayEl = r.querySelector('.nurture-day');
          var subject = r.querySelector('.nurture-subject').value.trim();
          var body = r.querySelector('.nurture-body').value;
          var dayRaw = dayEl.value.trim();
          dayEl.classList.remove('input-invalid');
          if (!subject && !body.trim() && dayRaw === '') return; // skip blank rows
          var day = Number(dayRaw);
          if (dayRaw === '' || isNaN(day) || day < 0) { dayEl.classList.add('input-invalid'); invalid = true; return; }
          out.push({ dayOffset: day, subject: subject, body: body });
        });
        if (invalid) return { ok: false, error: 'Each step needs a day offset of 0 or more.' };
        return { ok: true, value: { enabled: getChecked('nurture-enabled'), steps: out } };
      }

      return { html: html, afterMount: afterMount, collect: collect };
    });
  }

  function nurtureStepRow(s) {
    s = s || {};
    var day = (s.dayOffset == null ? '' : s.dayOffset);
    return '<div class="subcard nurture-step">' +
      '<div class="subcard-head">' +
        '<div class="form-group nurture-day-wrap"><label>Day offset</label>' +
          '<input type="number" class="nurture-day" min="0" step="1" value="' + esc(day) + '"></div>' +
        '<button type="button" class="icon-btn nurture-remove" title="Remove step">' + ICONS.trash + '</button>' +
      '</div>' +
      '<div class="form-group"><label>Subject</label>' +
        '<input type="text" class="nurture-subject" placeholder="e.g. Still looking in Hamilton?" value="' + esc(s.subject || '') + '"></div>' +
      '<div class="form-group"><label>Body</label>' +
        '<textarea class="nurture-body" rows="4" placeholder="Write the follow-up email…">' + esc(s.body || '') + '</textarea>' +
        '<div class="field-hint">Use {name} to insert the lead\'s first name.</div>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // Sidebar (mobile) + data key
  // ============================================================
  function openSidebar() { byId('sidebar').classList.add('open'); byId('backdrop').classList.add('show'); }
  function closeSidebar() { byId('sidebar').classList.remove('open'); byId('backdrop').classList.remove('show'); }

  // ============================================================
  // Boot
  // ============================================================
  function boot() {
    byId('login-form').addEventListener('submit', handleLogin);
    byId('logout-btn').addEventListener('click', function () { sb.auth.signOut(); showLogin(); });

    byId('hamburger').addEventListener('click', function () {
      if (byId('sidebar').classList.contains('open')) closeSidebar(); else openSidebar();
    });
    byId('backdrop').addEventListener('click', closeSidebar);

    // Data access key
    var dkInput = byId('datakey-input');
    dkInput.value = getDataKey();
    byId('datakey-save').addEventListener('click', function () {
      var v = dkInput.value.trim();
      if (v) localStorage.setItem('golfi_dash_key', v);
      else localStorage.removeItem('golfi_dash_key');
      toast('Data access key saved', 'success');
      byId('datakey').open = false;
      var cur = getCurrentPanel();
      if (cur && DATA_PANELS[cur]) selectPanel(cur); // reload current data panel
    });

    // Warn on leaving with unsaved config edits
    window.addEventListener('beforeunload', function (e) {
      var dirty = Object.keys(state.dirty).some(function (k) { return state.dirty[k]; });
      if (dirty) { e.preventDefault(); e.returnValue = ''; return ''; }
    });

    // Auth state drives which screen shows. INITIAL_SESSION fires once on load.
    sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_OUT' || !session) { showLogin(); }
      else { enterConsole(session); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
