/**
 * Golfi Team RE/MAX — AI Agent Widget
 * Chat + passive lead capture + event tracking
 * Brand: #E2001A (red), #0D1B3E (navy)
 */
(function () {
  'use strict';

  // ─── Config ────────────────────────────────────────────────────────────────
  var BRAND_RED   = '#E2001A';
  var BRAND_NAVY  = '#0D1B3E';
  var API_BASE    = '/api';

  // ─── Session ───────────────────────────────────────────────────────────────
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  var sid = localStorage.getItem('golfi_sid') || uuid();
  localStorage.setItem('golfi_sid', sid);

  var sessionCount = parseInt(localStorage.getItem('golfi_sc') || '0', 10) + 1;
  localStorage.setItem('golfi_sc', sessionCount);

  var capturedEmail   = localStorage.getItem('golfi_email') || '';
  var exitShown       = false;
  var hookShown       = {};    // track which hooks fired this session
  var propertyViews   = JSON.parse(localStorage.getItem('golfi_pv') || '{}');
  var searchCount     = parseInt(localStorage.getItem('golfi_sq') || '0', 10);

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function api(path, body) {
    return fetch(API_BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); }).catch(function () { return {}; });
  }

  function captureLead(payload) {
    if (!payload.email && !payload.phone) return;
    if (payload.email) {
      localStorage.setItem('golfi_email', payload.email);
      capturedEmail = payload.email;
    }
    api('/lead', Object.assign({ sessionId: sid }, payload));
  }

  // ─── Inject CSS ────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    '#ga-btn{position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;background:' + BRAND_RED + ';border:none;cursor:pointer;z-index:99999;box-shadow:0 4px 20px rgba(226,0,26,.45);display:flex;align-items:center;justify-content:center;transition:transform .2s}',
    '#ga-btn:hover{transform:scale(1.08)}',
    '#ga-badge{position:absolute;top:-3px;right:-3px;background:#fff;color:' + BRAND_RED + ';font-size:11px;font-weight:700;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;display:none}',
    '#ga-panel{position:fixed;bottom:96px;right:24px;width:340px;height:500px;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.22);z-index:99999;display:none;flex-direction:column;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    '#ga-panel.open{display:flex}',
    '#ga-head{background:' + BRAND_NAVY + ';padding:16px 18px;display:flex;align-items:center;gap:12px}',
    '#ga-head-avatar{width:40px;height:40px;border-radius:50%;background:' + BRAND_RED + ';display:flex;align-items:center;justify-content:center;flex-shrink:0}',
    '#ga-head-info{flex:1}',
    '#ga-head-name{color:#fff;font-weight:700;font-size:14px;line-height:1.2}',
    '#ga-head-sub{color:rgba(255,255,255,.65);font-size:12px}',
    '#ga-close{background:none;border:none;cursor:pointer;color:rgba(255,255,255,.7);font-size:20px;padding:4px;line-height:1}',
    '#ga-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}',
    '.ga-msg{max-width:82%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.55}',
    '.ga-msg.bot{background:#f0f2f5;color:#1a1a2e;border-bottom-left-radius:4px;align-self:flex-start}',
    '.ga-msg.usr{background:' + BRAND_RED + ';color:#fff;border-bottom-right-radius:4px;align-self:flex-end}',
    '.ga-typing{display:flex;gap:4px;padding:10px 14px;background:#f0f2f5;border-radius:14px;border-bottom-left-radius:4px;align-self:flex-start;width:44px}',
    '.ga-typing span{width:6px;height:6px;border-radius:50%;background:#aaa;animation:ga-bounce 1.2s infinite}',
    '.ga-typing span:nth-child(2){animation-delay:.2s}',
    '.ga-typing span:nth-child(3){animation-delay:.4s}',
    '@keyframes ga-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}',
    '#ga-form{padding:12px 14px;border-top:1px solid #eee;display:flex;gap:8px}',
    '#ga-input{flex:1;border:1.5px solid #e0e3e8;border-radius:22px;padding:9px 14px;font-size:13px;outline:none;font-family:inherit;transition:border-color .2s}',
    '#ga-input:focus{border-color:' + BRAND_RED + '}',
    '#ga-send{background:' + BRAND_RED + ';border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s}',
    '#ga-send:hover{opacity:.85}',
    /* exit intent modal */
    '#ga-exit{position:fixed;inset:0;z-index:999999;display:none;align-items:center;justify-content:center}',
    '#ga-exit.show{display:flex}',
    '#ga-exit-bg{position:absolute;inset:0;background:rgba(0,0,0,.5)}',
    '#ga-exit-box{position:relative;background:#fff;border-radius:16px;padding:36px 32px;max-width:420px;width:90%;z-index:1;box-shadow:0 12px 48px rgba(0,0,0,.2)}',
    '#ga-exit-close{position:absolute;top:14px;right:18px;background:none;border:none;font-size:22px;cursor:pointer;color:#888;line-height:1}',
    '#ga-exit-eyebrow{display:inline-block;background:' + BRAND_RED + ';color:#fff;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 12px;border-radius:4px;margin-bottom:14px}',
    '#ga-exit-box h3{color:' + BRAND_NAVY + ';font-size:22px;font-weight:800;margin:0 0 8px}',
    '#ga-exit-box p{color:#666;font-size:14px;margin:0 0 20px;line-height:1.6}',
    '.ga-field{margin-bottom:12px}',
    '.ga-field input{width:100%;box-sizing:border-box;border:1.5px solid #dde0e8;border-radius:8px;padding:11px 14px;font-size:14px;outline:none;font-family:inherit;transition:border-color .2s}',
    '.ga-field input:focus{border-color:' + BRAND_RED + '}',
    '.ga-submit{width:100%;background:' + BRAND_RED + ';color:#fff;border:none;border-radius:8px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;transition:opacity .2s;font-family:inherit}',
    '.ga-submit:hover{opacity:.88}',
    /* save banner */
    '#ga-save-bar{background:' + BRAND_NAVY + ';color:#fff;padding:12px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:fixed;top:0;left:0;right:0;z-index:99998;transform:translateY(-100%);transition:transform .35s;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px}',
    '#ga-save-bar.show{transform:translateY(0)}',
    '#ga-save-bar span{flex:1}',
    '#ga-save-email{border:none;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;width:200px}',
    '#ga-save-btn{background:' + BRAND_RED + ';color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}',
    '#ga-save-x{background:none;border:none;color:rgba(255,255,255,.6);font-size:18px;cursor:pointer;margin-left:4px}',
    /* search alert */
    '#ga-search-bar{background:#fff4f5;border:1.5px solid ' + BRAND_RED + ';border-radius:10px;padding:14px 18px;margin:16px 0;display:none;align-items:center;gap:12px;flex-wrap:wrap;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px}',
    '#ga-search-bar.show{display:flex}',
    '#ga-search-bar span{flex:1;color:' + BRAND_NAVY + ';font-weight:600}',
    '#ga-search-email{border:1.5px solid #dde0e8;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;width:180px}',
    '#ga-search-btn{background:' + BRAND_RED + ';color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer}',
    /* return visitor banner */
    '#ga-return-bar{background:' + BRAND_NAVY + ';color:#fff;padding:10px 20px;display:flex;align-items:center;gap:14px;position:fixed;bottom:0;left:0;right:0;z-index:99998;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;transform:translateY(100%);transition:transform .35s}',
    '#ga-return-bar.show{transform:translateY(0)}',
    '#ga-return-bar span{flex:1}',
    '#ga-return-chat{background:' + BRAND_RED + ';color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer}',
    '#ga-return-x{background:none;border:none;color:rgba(255,255,255,.6);font-size:18px;cursor:pointer}',
    /* booking modal */
    '#ga-book{position:fixed;inset:0;z-index:999999;display:none;align-items:center;justify-content:center}',
    '#ga-book.show{display:flex}',
    '#ga-book-bg{position:absolute;inset:0;background:rgba(0,0,0,.5)}',
    '#ga-book-box{position:relative;background:#fff;border-radius:16px;padding:32px;max-width:400px;width:90%;z-index:1;box-shadow:0 12px 48px rgba(0,0,0,.2);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
    '#ga-book-close{position:absolute;top:14px;right:18px;background:none;border:none;font-size:22px;cursor:pointer;color:#888}',
    '#ga-book-box h3{color:' + BRAND_NAVY + ';font-size:20px;font-weight:800;margin:0 0 6px}',
    '#ga-book-box p{color:#666;font-size:13px;margin:0 0 18px}',
    /* success toast */
    '#ga-toast{position:fixed;bottom:96px;right:24px;background:' + BRAND_NAVY + ';color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;z-index:999999;opacity:0;transition:opacity .3s;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:280px}',
    /* mobile */
    '@media(max-width:480px){#ga-panel{width:100%;right:0;bottom:0;height:70vh;border-bottom-left-radius:0;border-bottom-right-radius:0}#ga-btn{bottom:16px;right:16px}}',
  ].join('');
  document.head.appendChild(style);

  // ─── Persistent chat history ────────────────────────────────────────────────
  var chatHistory = JSON.parse(localStorage.getItem('golfi_ch') || '[]');
  function saveHistory() {
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    localStorage.setItem('golfi_ch', JSON.stringify(chatHistory));
  }

  // ─── Build widget DOM ───────────────────────────────────────────────────────
  var btn = document.createElement('button');
  btn.id = 'ga-btn';
  btn.setAttribute('aria-label', 'Chat with Golfi Team');
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" fill="none" viewBox="0 0 24 24"><path fill="#fff" d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Zm-2 12H6v-2h12v2Zm0-3H6V9h12v2Zm0-3H6V6h12v2Z"/></svg>';
  btn.innerHTML += '<span id="ga-badge">1</span>';

  var panel = document.createElement('div');
  panel.id = 'ga-panel';
  panel.innerHTML = [
    '<div id="ga-head">',
    '  <div id="ga-head-avatar"><svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path fill="#fff" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3Zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22Z"/></svg></div>',
    '  <div id="ga-head-info"><div id="ga-head-name">Golfi Team AI</div><div id="ga-head-sub">Hamilton & Niagara RE/MAX</div></div>',
    '  <button id="ga-close" aria-label="Close">&#x2715;</button>',
    '</div>',
    '<div id="ga-messages"></div>',
    '<div id="ga-form">',
    '  <input id="ga-input" type="text" placeholder="Ask about properties…" autocomplete="off"/>',
    '  <button id="ga-send" aria-label="Send"><svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path fill="#fff" d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>',
    '</div>',
  ].join('');

  var toast = document.createElement('div');
  toast.id = 'ga-toast';

  document.body.appendChild(btn);
  document.body.appendChild(panel);
  document.body.appendChild(toast);

  // ─── Toast helper ───────────────────────────────────────────────────────────
  function showToast(msg) {
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(function () { toast.style.opacity = '0'; }, 3500);
  }

  // ─── Chat UI ────────────────────────────────────────────────────────────────
  var messagesEl = panel.querySelector('#ga-messages');
  var inputEl    = panel.querySelector('#ga-input');
  var sendEl     = panel.querySelector('#ga-send');
  var closeEl    = panel.querySelector('#ga-close');
  var badge      = document.getElementById('ga-badge');

  function addMsg(role, text) {
    var d = document.createElement('div');
    d.className = 'ga-msg ' + (role === 'user' ? 'usr' : 'bot');
    d.textContent = text;
    messagesEl.appendChild(d);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return d;
  }

  function showTyping() {
    var t = document.createElement('div');
    t.className = 'ga-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    t.id = 'ga-typing';
    messagesEl.appendChild(t);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function removeTyping() {
    var t = document.getElementById('ga-typing');
    if (t) t.remove();
  }

  function openPanel() {
    panel.classList.add('open');
    badge.style.display = 'none';
    inputEl.focus();
    if (!messagesEl.children.length) {
      // Load history or show greeting
      if (chatHistory.length) {
        chatHistory.forEach(function (m) { addMsg(m.role === 'user' ? 'user' : 'assistant', m.content); });
      } else {
        addMsg('assistant', 'Hi! I\'m the Golfi Team AI Assistant. I can help you find properties in Hamilton and Niagara, answer neighbourhood questions, or book a viewing. What are you looking for?');
      }
    }
  }

  function closePanel() { panel.classList.remove('open'); }

  btn.addEventListener('click', function () {
    panel.classList.contains('open') ? closePanel() : openPanel();
  });
  closeEl.addEventListener('click', closePanel);

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    addMsg('user', text);
    chatHistory.push({ role: 'user', content: text });
    saveHistory();
    showTyping();

    api('/chat', { sessionId: sid, message: text }).then(function (res) {
      removeTyping();
      var reply = (res && res.reply) ? res.reply : 'Thanks for your message! A Golfi agent will follow up shortly.';
      addMsg('assistant', reply);
      chatHistory.push({ role: 'assistant', content: reply });
      saveHistory();
      if (!panel.classList.contains('open')) {
        badge.style.display = 'flex';
      }
    });
  }

  sendEl.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendMessage(); });

  // ─── Event Tracking ─────────────────────────────────────────────────────────
  var pagePath = window.location.pathname;
  var isPropertyPage = /property-details/.test(pagePath);
  var isSearchPage   = /sidebar-grid/.test(pagePath);

  // Page view
  api('/event', { sessionId: sid, type: 'page_view', data: { url: window.location.href, title: document.title, referrer: document.referrer } });

  // Property view tracking
  if (isPropertyPage) {
    var propId = pagePath.replace(/\//g, '').replace('.html', '');
    propertyViews[propId] = (propertyViews[propId] || 0) + 1;
    localStorage.setItem('golfi_pv', JSON.stringify(propertyViews));
    api('/event', { sessionId: sid, type: 'property_view', data: { propertyId: propId, title: document.title } }).then(function (res) {
      if (res && res.shouldCaptureLead && !hookShown['property_save']) triggerSaveBar();
    });
  }

  // Search tracking
  if (isSearchPage) {
    var searchForm = document.querySelector('form, .search-form, [data-search]');
    if (searchForm) {
      searchForm.addEventListener('change', function () {
        searchCount++;
        localStorage.setItem('golfi_sq', searchCount);
        api('/event', { sessionId: sid, type: 'search', data: { url: window.location.href } }).then(function (res) {
          if (res && res.shouldCaptureLead && !hookShown['search_alert']) triggerSearchBar();
        });
        if (searchCount >= 2 && !hookShown['search_alert']) triggerSearchBar();
      });
    }
  }

  // ─── Hook 1: Property Save Bar ──────────────────────────────────────────────
  function triggerSaveBar() {
    if (hookShown['property_save'] || capturedEmail) return;
    if (!isPropertyPage) return;
    hookShown['property_save'] = true;

    var bar = document.createElement('div');
    bar.id = 'ga-save-bar';
    bar.innerHTML = [
      '<span>💾 Save this property to get price change alerts</span>',
      '<input id="ga-save-email" type="email" placeholder="Your email…"/>',
      '<button id="ga-save-btn">Save</button>',
      '<button id="ga-save-x" aria-label="Dismiss">&#x2715;</button>',
    ].join('');
    document.body.appendChild(bar);

    setTimeout(function () { bar.classList.add('show'); }, 300);

    bar.querySelector('#ga-save-x').addEventListener('click', function () { bar.classList.remove('show'); });
    bar.querySelector('#ga-save-btn').addEventListener('click', function () {
      var email = bar.querySelector('#ga-save-email').value.trim();
      if (!email || !email.includes('@')) return;
      captureLead({ email: email, type: 'property_save', data: { page: pagePath, title: document.title } });
      bar.classList.remove('show');
      showToast('✓ Saved! We\'ll alert you to any price changes.');
    });
  }

  // Trigger save bar after 3 views of any property
  if (isPropertyPage) {
    var totalViews = Object.values(propertyViews).reduce(function (a, b) { return a + b; }, 0);
    if (totalViews >= 3) setTimeout(triggerSaveBar, 4000);
  }

  // ─── Hook 2: Exit Intent – Home Valuation ───────────────────────────────────
  function buildExitModal() {
    var el = document.createElement('div');
    el.id = 'ga-exit';
    el.innerHTML = [
      '<div id="ga-exit-bg"></div>',
      '<div id="ga-exit-box">',
      '  <button id="ga-exit-close" aria-label="Close">&#x2715;</button>',
      '  <div id="ga-exit-eyebrow">Free — No Obligation</div>',
      '  <h3>What\'s Your Home Worth?</h3>',
      '  <p>Get a free market valuation from the Golfi Team RE/MAX in 24 hours.</p>',
      '  <div class="ga-field"><input id="ga-val-addr" type="text" placeholder="Property address…"/></div>',
      '  <div class="ga-field"><input id="ga-val-name" type="text" placeholder="Your name…"/></div>',
      '  <div class="ga-field"><input id="ga-val-email" type="email" placeholder="Your email…"/></div>',
      '  <button class="ga-submit" id="ga-val-submit">Get My Free Valuation →</button>',
      '</div>',
    ].join('');
    document.body.appendChild(el);

    el.querySelector('#ga-exit-bg').addEventListener('click', function () { el.classList.remove('show'); });
    el.querySelector('#ga-exit-close').addEventListener('click', function () { el.classList.remove('show'); });
    el.querySelector('#ga-val-submit').addEventListener('click', function () {
      var addr  = el.querySelector('#ga-val-addr').value.trim();
      var name  = el.querySelector('#ga-val-name').value.trim();
      var email = el.querySelector('#ga-val-email').value.trim();
      if (!email || !email.includes('@')) { el.querySelector('#ga-val-email').focus(); return; }
      captureLead({ name: name, email: email, type: 'valuation', data: { address: addr }, source: 'exit_intent' });
      el.classList.remove('show');
      showToast('✓ Request received! We\'ll send your valuation within 24 hours.');
    });
    return el;
  }

  if (!capturedEmail && !sessionStorage.getItem('ga_exit_done')) {
    var exitModal = null;
    document.addEventListener('mouseleave', function handler(e) {
      if (e.clientY > 10 || exitShown) return;
      exitShown = true;
      sessionStorage.setItem('ga_exit_done', '1');
      document.removeEventListener('mouseleave', handler);
      exitModal = exitModal || buildExitModal();
      setTimeout(function () { exitModal.classList.add('show'); }, 200);
    });
  }

  // ─── Hook 3: Search Alert Bar ───────────────────────────────────────────────
  function triggerSearchBar() {
    if (hookShown['search_alert'] || capturedEmail || !isSearchPage) return;
    hookShown['search_alert'] = true;

    var bar = document.createElement('div');
    bar.id = 'ga-search-bar';
    bar.innerHTML = [
      '<span>📬 Get new listings matching your search sent to your inbox</span>',
      '<input id="ga-search-email" type="email" placeholder="Your email…"/>',
      '<button id="ga-search-btn">Alert Me</button>',
    ].join('');

    // Insert after first results heading or at top of page content
    var target = document.querySelector('.sidebar-section, .property-grid, main, .content-area') || document.body;
    target.insertBefore(bar, target.firstChild);

    setTimeout(function () { bar.classList.add('show'); }, 400);

    bar.querySelector('#ga-search-btn').addEventListener('click', function () {
      var email = bar.querySelector('#ga-search-email').value.trim();
      if (!email || !email.includes('@')) return;
      captureLead({ email: email, type: 'search_alert', data: { url: window.location.href }, source: 'search_page' });
      bar.classList.remove('show');
      showToast('✓ Done! We\'ll send matching listings to your inbox.');
    });
  }

  // ─── Hook 4: Return Visitor Banner ──────────────────────────────────────────
  if (sessionCount >= 2 && !capturedEmail && !sessionStorage.getItem('ga_rv_shown')) {
    sessionStorage.setItem('ga_rv_shown', '1');
    setTimeout(function () {
      var bar = document.createElement('div');
      bar.id = 'ga-return-bar';
      bar.innerHTML = [
        '<span>👋 Welcome back! Still looking in Hamilton or Niagara? Let us help.</span>',
        '<button id="ga-return-chat">Chat with us</button>',
        '<button id="ga-return-x" aria-label="Dismiss">&#x2715;</button>',
      ].join('');
      document.body.appendChild(bar);
      setTimeout(function () { bar.classList.add('show'); }, 100);
      bar.querySelector('#ga-return-chat').addEventListener('click', function () {
        bar.classList.remove('show');
        openPanel();
      });
      bar.querySelector('#ga-return-x').addEventListener('click', function () { bar.classList.remove('show'); });
    }, 2500);
  }

  // ─── Hook 5: Book a Viewing ──────────────────────────────────────────────────
  function buildBookModal(propertyTitle) {
    var el = document.createElement('div');
    el.id = 'ga-book';
    el.innerHTML = [
      '<div id="ga-book-bg"></div>',
      '<div id="ga-book-box">',
      '  <button id="ga-book-close" aria-label="Close">&#x2715;</button>',
      '  <h3>Book a Viewing</h3>',
      '  <p>' + (propertyTitle || 'Schedule a showing with the Golfi Team') + '</p>',
      '  <div class="ga-field"><input id="ga-bk-name" type="text" placeholder="Your name…"/></div>',
      '  <div class="ga-field"><input id="ga-bk-phone" type="tel" placeholder="Phone number…"/></div>',
      '  <div class="ga-field"><input id="ga-bk-email" type="email" placeholder="Email…"/></div>',
      '  <div class="ga-field"><input id="ga-bk-time" type="text" placeholder="Preferred date & time…"/></div>',
      '  <button class="ga-submit" id="ga-bk-submit">Confirm Viewing Request →</button>',
      '</div>',
    ].join('');
    document.body.appendChild(el);

    el.querySelector('#ga-book-bg').addEventListener('click', function () { el.remove(); });
    el.querySelector('#ga-book-close').addEventListener('click', function () { el.remove(); });
    el.querySelector('#ga-bk-submit').addEventListener('click', function () {
      var name  = el.querySelector('#ga-bk-name').value.trim();
      var phone = el.querySelector('#ga-bk-phone').value.trim();
      var email = el.querySelector('#ga-bk-email').value.trim();
      var time  = el.querySelector('#ga-bk-time').value.trim();
      if (!name) { el.querySelector('#ga-bk-name').focus(); return; }
      if (!phone && !email) { el.querySelector('#ga-bk-phone').focus(); return; }
      captureLead({ name: name, phone: phone, email: email, type: 'viewing', data: { property: pagePath, title: propertyTitle, preferredTime: time }, source: 'book_button' });
      el.remove();
      showToast('✓ Viewing request sent! We\'ll confirm shortly.');
    });
    return el;
  }

  // Intercept all "Book a Viewing" links/buttons
  document.addEventListener('click', function (e) {
    var target = e.target.closest('a, button');
    if (!target) return;
    var text = target.textContent.toLowerCase();
    var href = (target.getAttribute('href') || '').toLowerCase();
    if (text.includes('book') || text.includes('viewing') || text.includes('schedule') || href.includes('book')) {
      e.preventDefault();
      var modal = document.getElementById('ga-book');
      if (modal) modal.remove();
      var m = buildBookModal(document.title);
      setTimeout(function () { m.classList.add('show'); }, 50);
    }
  }, true);

  // ─── Expose public API ───────────────────────────────────────────────────────
  window.GolfiAgent = {
    open:   openPanel,
    close:  closePanel,
    lead:   captureLead,
    sessionId: sid
  };

}());
