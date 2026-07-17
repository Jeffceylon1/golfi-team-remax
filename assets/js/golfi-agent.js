/**
 * Golfi Team RE/MAX — AI Agent Widget
 * Chat + passive lead capture + event tracking.
 * Config-driven: colours, header copy, greeting, and hook copy/enabled/thresholds
 * are pulled from /api/config at load. Everything falls back to the brand defaults
 * below if the config request is slow, fails, or returns partial data.
 * Brand fallbacks: #E2001A (red), #0D1B3E (navy)
 */
(function () {
  'use strict';

  // ─── Config defaults / fallbacks ─────────────────────────────────────────────
  var DEFAULT_RED       = '#E2001A';
  var DEFAULT_NAVY      = '#0D1B3E';
  var API_BASE          = '/api';
  var CONFIG_TIMEOUT_MS = 2500;   // never let a slow /api/config block the widget

  var DEFAULTS = {
    widget: {
      primaryColor: DEFAULT_RED,
      accentColor:  DEFAULT_NAVY,
      enabled:      true,
      title:        'Golfi Team AI',
      subtitle:     'Hamilton & Niagara RE/MAX',
      // Persona
      personaName:   'Sofia',
      personaRole:   'Golfi Team Assistant',
      personaAvatar: '',           // '' = branded initial avatar; else an image URL
      showOnlineDot: true,
      launcherPrompt: 'How can I help? \uD83D\uDC4B',  // greeting bubble shown above the launcher
      consentText:   'By chatting, you agree to our Privacy Policy.',
      // Intent quick-replies (label + action + value). Actions:
      // navigate | valuation | booking | message | agent
      quickReplies: [
        { label: 'Browse listings',            action: 'navigate',  value: '/sidebar-grid.html' },
        { label: 'What\u2019s my home worth?', action: 'valuation', value: '' },
        { label: 'Book a viewing',             action: 'booking',   value: '' },
        { label: 'I\u2019m looking to buy',    action: 'message',   value: 'I\u2019m looking to buy a home in Hamilton or Niagara.' },
        { label: 'Talk to an agent',           action: 'agent',     value: '' }
      ]
    },
    greeting: 'Hi! I\'m the Golfi Team AI Assistant. I can help you find properties in Hamilton and Niagara, answer neighbourhood questions, or book a viewing. What are you looking for?',
    hooks: {
      propertySave: {
        enabled: true, threshold: 3,
        headline: '\uD83D\uDCBE Save this property to get price change alerts',
        button: 'Save'
      },
      exitIntent: {
        enabled: true,
        headline: 'What\'s Your Home Worth?',
        sub: 'Get a free market valuation from the Golfi Team RE/MAX in 24 hours.',
        button: 'Get My Free Valuation \u2192'
      },
      searchAlert: {
        enabled: true, threshold: 2,
        headline: '\uD83D\uDCEC Get new listings matching your search sent to your inbox',
        button: 'Alert Me'
      },
      returnVisitor: {
        enabled: true,
        headline: '\uD83D\uDC4B Welcome back! Still looking in Hamilton or Niagara? Let us help.',
        button: 'Chat with us'
      },
      booking: {
        enabled: true,
        headline: 'Book a Viewing',
        sub: 'Schedule a showing with the Golfi Team',
        button: 'Confirm Viewing Request \u2192'
      },
      smartRecapture: {
        enabled: true, scoreThreshold: 60
      }
    }
  };

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
  var lastScore       = 0;     // updated by /api/event responses; exposed via GolfiAgent.score

  // ─── Config-independent helpers ──────────────────────────────────────────────
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  // Traffic source — cached per session so internal navigation keeps the origin
  function deriveSource() {
    var cached = sessionStorage.getItem('golfi_source');
    if (cached) return cached;
    var ref = (document.referrer || '').toLowerCase();
    var src;
    if (!ref) src = 'direct';
    else if (ref.indexOf('google') !== -1) src = 'google';
    else if (ref.indexOf('bing') !== -1) src = 'bing';
    else if (ref.indexOf('facebook') !== -1 || ref.indexOf('instagram') !== -1) src = 'social';
    else src = 'referral';
    try { sessionStorage.setItem('golfi_source', src); } catch (e) {}
    return src;
  }

  // ─── Persistent chat history ────────────────────────────────────────────────
  var chatHistory = JSON.parse(localStorage.getItem('golfi_ch') || '[]');
  function saveHistory() {
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    localStorage.setItem('golfi_ch', JSON.stringify(chatHistory));
  }

  // ─── Page context (config-independent) ───────────────────────────────────────
  var pagePath       = window.location.pathname;
  var isPropertyPage = /property-details/.test(pagePath);
  var isSearchPage   = /sidebar-grid/.test(pagePath);

  var trafficSource = deriveSource();
  var landingPage = sessionStorage.getItem('golfi_landing');
  if (!landingPage) {
    landingPage = window.location.pathname;
    try { sessionStorage.setItem('golfi_landing', landingPage); } catch (e) {}
  }

  // ─── Config loading / merge ──────────────────────────────────────────────────
  // Resolve with the raw /api/config payload, or null on timeout / error.
  function loadConfig() {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(v) { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } }
      var timer = setTimeout(function () { finish(null); }, CONFIG_TIMEOUT_MS);
      fetch(API_BASE + '/config', { headers: { Accept: 'application/json' } })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (cfg) { finish(cfg); })
        .catch(function () { finish(null); });
    });
  }

  // Overlay the fetched config on top of DEFAULTS, tolerating any missing pieces.
  function mergeConfig(raw) {
    raw = raw || {};
    var w = raw.widget || {};
    var h = raw.hooks  || {};

    function hookCfg(name) {
      var d = DEFAULTS.hooks[name] || {};
      var c = h[name] || {};
      return {
        enabled:        c.enabled !== false,   // default on unless explicitly disabled
        threshold:      (typeof c.threshold === 'number') ? c.threshold : d.threshold,
        scoreThreshold: (typeof c.scoreThreshold === 'number') ? c.scoreThreshold : d.scoreThreshold,
        headline:       c.headline || d.headline,
        sub:            c.sub      || d.sub,
        button:         c.button   || d.button
      };
    }

    function color(v, fallback) {
      return (typeof v === 'string' && v.trim()) ? v.trim() : fallback;
    }

    // Non-empty string wins; blank/absent falls back to the brand default.
    function text(v, fallback) {
      return (typeof v === 'string' && v.trim()) ? v : fallback;
    }

    // A string value may legitimately be empty (e.g. blank consent = hide line,
    // blank avatar = use initial). Only fall back when the field is absent.
    function optText(v, fallback) {
      return (typeof v === 'string') ? v.trim() : fallback;
    }

    // Keep only well-formed quick-reply entries; a supplied [] means "no chips".
    function quickReplies(v) {
      if (!Array.isArray(v)) return DEFAULTS.widget.quickReplies;
      var ok = { navigate: 1, valuation: 1, booking: 1, message: 1, agent: 1 };
      return v.filter(function (q) {
        return q && typeof q.label === 'string' && q.label.trim() && ok[q.action];
      }).map(function (q) {
        return {
          label:  q.label.trim(),
          action: q.action,
          value:  typeof q.value === 'string' ? q.value : ''
        };
      });
    }

    return {
      red:      color(w.primaryColor, DEFAULT_RED),
      navy:     color(w.accentColor,  DEFAULT_NAVY),
      enabled:  w.enabled !== false,             // hide only when explicitly disabled
      title:    raw.title    || w.title    || DEFAULTS.widget.title,
      subtitle: raw.subtitle || w.subtitle || DEFAULTS.widget.subtitle,
      greeting: raw.greeting || DEFAULTS.greeting,
      phone:    optText(raw.phone, ''),
      // Persona
      personaName:   text(w.personaName, DEFAULTS.widget.personaName),
      personaRole:   text(w.personaRole, DEFAULTS.widget.personaRole),
      personaAvatar: optText(w.personaAvatar, DEFAULTS.widget.personaAvatar),
      showOnlineDot: w.showOnlineDot !== false,
      launcherPrompt: optText(w.launcherPrompt, DEFAULTS.widget.launcherPrompt),
      consentText:   optText(w.consentText, DEFAULTS.widget.consentText),
      quickReplies:  quickReplies(w.quickReplies),
      hooks: {
        propertySave:   hookCfg('propertySave'),
        exitIntent:     hookCfg('exitIntent'),
        searchAlert:    hookCfg('searchAlert'),
        returnVisitor:  hookCfg('returnVisitor'),
        booking:        hookCfg('booking'),
        smartRecapture: hookCfg('smartRecapture')
      }
    };
  }

  function whenReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  // Fetch config first (never blocks longer than CONFIG_TIMEOUT_MS), then render.
  loadConfig().then(function (raw) {
    var cfg = mergeConfig(raw);
    whenReady(function () { build(cfg); });
  });

  // ─── Build everything once config is resolved ────────────────────────────────
  function build(cfg) {
    // Owner switched the widget off — render nothing.
    if (!cfg.enabled) return;

    var red  = cfg.red;
    var navy = cfg.navy;
    var hooks = cfg.hooks;

    // ─── Inject CSS ────────────────────────────────────────────────────────────
    var style = document.createElement('style');
    style.textContent = [
      '#ga-btn{position:fixed;bottom:24px;right:24px;width:64px;height:64px;border-radius:50%;background:' + red + ';border:3px solid #fff;cursor:pointer;z-index:99999;box-shadow:0 6px 22px rgba(0,0,0,.30);padding:0;overflow:visible;transition:transform .2s}',
      '#ga-btn:hover{transform:scale(1.08)}',
      '#ga-btn img{width:100%;height:100%;border-radius:50%;object-fit:cover;object-position:center 22%;display:block}',
      '#ga-btn svg{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}',
      '#ga-btn-dot{position:absolute;bottom:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#22c55e;border:2.5px solid #fff}',
      '#ga-badge{position:absolute;top:-3px;right:-3px;background:#fff;color:' + red + ';font-size:11px;font-weight:700;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;display:none}',
      '#ga-panel{position:fixed;bottom:96px;right:24px;width:340px;height:500px;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.22);z-index:99999;display:none;flex-direction:column;background:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '#ga-panel.open{display:flex}',
      '#ga-head{background:' + navy + ';padding:16px 18px;display:flex;align-items:center;gap:12px}',
      '#ga-head-avatar{width:40px;height:40px;border-radius:50%;background:' + red + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative}',
      '#ga-head-avatar img{width:40px;height:40px;border-radius:50%;object-fit:cover;object-position:center 22%;display:block}',
      '#ga-head-avatar .ga-avatar-initial{color:#fff;font-weight:700;font-size:17px;line-height:1;font-family:inherit}',
      '.ga-persona-dot{position:absolute;bottom:0;right:0;width:11px;height:11px;border-radius:50%;background:#22c55e;border:2px solid ' + navy + ';box-sizing:border-box}',
      '#ga-head-info{flex:1}',
      '#ga-head-name{color:#fff;font-weight:700;font-size:14px;line-height:1.2}',
      '#ga-head-sub{color:rgba(255,255,255,.65);font-size:12px}',
      '#ga-close{background:none;border:none;cursor:pointer;color:rgba(255,255,255,.7);font-size:20px;padding:4px;line-height:1}',
      '#ga-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px}',
      '.ga-msg{max-width:82%;padding:10px 14px;border-radius:14px;font-size:13px;line-height:1.55}',
      '.ga-msg.bot{background:#f0f2f5;color:#1a1a2e;border-bottom-left-radius:4px;align-self:flex-start}',
      '.ga-msg.usr{background:' + red + ';color:#fff;border-bottom-right-radius:4px;align-self:flex-end}',
      '.ga-consent{font-size:11px;color:#9aa0ab;text-align:center;line-height:1.4;padding:0 6px 4px;align-self:stretch}',
      '.ga-consent a{color:' + red + ';text-decoration:underline}',
      '.ga-qr{display:flex;flex-wrap:wrap;gap:8px;align-self:stretch;margin-top:2px}',
      '.ga-qr-chip{background:#fff;color:' + navy + ';border:1.5px solid ' + navy + ';border-radius:16px;padding:7px 13px;font-size:12.5px;font-weight:600;cursor:pointer;font-family:inherit;line-height:1.2;transition:background .15s,color .15s,border-color .15s}',
      '.ga-qr-chip:hover{background:' + red + ';color:#fff;border-color:' + red + '}',
      '.ga-qr-chip:disabled{opacity:.5;cursor:default;background:#fff;color:' + navy + ';border-color:' + navy + '}',
      '#ga-qr-bar{display:none;flex-wrap:wrap;gap:8px;padding:12px 14px 4px;border-top:1px solid #eee}',
      '#ga-qr-bar.show{display:flex}',
      '.ga-typing{display:flex;gap:4px;padding:10px 14px;background:#f0f2f5;border-radius:14px;border-bottom-left-radius:4px;align-self:flex-start;width:44px}',
      '.ga-typing span{width:6px;height:6px;border-radius:50%;background:#aaa;animation:ga-bounce 1.2s infinite}',
      '.ga-typing span:nth-child(2){animation-delay:.2s}',
      '.ga-typing span:nth-child(3){animation-delay:.4s}',
      '@keyframes ga-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}',
      '#ga-form{padding:12px 14px;border-top:1px solid #eee;display:flex;gap:8px}',
      '#ga-input{flex:1;border:1.5px solid #e0e3e8;border-radius:22px;padding:9px 14px;font-size:13px;outline:none;font-family:inherit;transition:border-color .2s}',
      '#ga-input:focus{border-color:' + red + '}',
      '#ga-send{background:' + red + ';border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s}',
      '#ga-send:hover{opacity:.85}',
      /* exit intent modal */
      '#ga-exit{position:fixed;inset:0;z-index:999999;display:none;align-items:center;justify-content:center}',
      '#ga-exit.show{display:flex}',
      '#ga-exit-bg{position:absolute;inset:0;background:rgba(0,0,0,.5)}',
      '#ga-exit-box{position:relative;background:#fff;border-radius:16px;padding:36px 32px;max-width:420px;width:90%;z-index:1;box-shadow:0 12px 48px rgba(0,0,0,.2)}',
      '#ga-exit-close{position:absolute;top:14px;right:18px;background:none;border:none;font-size:22px;cursor:pointer;color:#888;line-height:1}',
      '#ga-exit-eyebrow{display:inline-block;background:' + red + ';color:#fff;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;padding:4px 12px;border-radius:4px;margin-bottom:14px}',
      '#ga-exit-box h3{color:' + navy + ';font-size:22px;font-weight:800;margin:0 0 8px}',
      '#ga-exit-box p{color:#666;font-size:14px;margin:0 0 20px;line-height:1.6}',
      '.ga-field{margin-bottom:12px}',
      '.ga-field input{width:100%;box-sizing:border-box;border:1.5px solid #dde0e8;border-radius:8px;padding:11px 14px;font-size:14px;outline:none;font-family:inherit;transition:border-color .2s}',
      '.ga-field input:focus{border-color:' + red + '}',
      '.ga-submit{width:100%;background:' + red + ';color:#fff;border:none;border-radius:8px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;transition:opacity .2s;font-family:inherit}',
      '.ga-submit:hover{opacity:.88}',
      '.ga-field select{width:100%;box-sizing:border-box;border:1.5px solid #dde0e8;border-radius:8px;padding:11px 14px;font-size:14px;outline:none;font-family:inherit;background:#fff;color:' + navy + ';transition:border-color .2s}',
      '.ga-field select:focus{border-color:' + red + '}',
      '.ga-field-row{display:flex;gap:10px}',
      '.ga-field-row .ga-field{flex:1}',
      '.ga-step{display:none}',
      '.ga-step.active{display:block}',
      '.ga-steps{display:flex;gap:6px;margin:0 0 16px}',
      '.ga-steps i{height:4px;flex:1;border-radius:2px;background:#e6e9ef;transition:background .25s}',
      '.ga-steps i.on{background:' + red + '}',
      '.ga-back{background:none;border:none;color:#9aa0ab;font-size:13px;cursor:pointer;margin-top:10px;font-family:inherit}',
      '.ga-back:hover{color:' + navy + '}',
      '.ga-hint{font-size:12px;color:#9aa0ab;margin:6px 0 0}',
      '#ga-exit-success{text-align:center;padding:6px 0}',
      '#ga-exit-success .ga-check{width:52px;height:52px;line-height:52px;margin:0 auto 6px;border-radius:50%;background:#e9f9ef;color:#22c55e;font-size:28px;font-weight:700}',
      '#ga-hv-tab{position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:99997;background:' + red + ';color:#fff;border:none;border-radius:0 12px 12px 0;padding:16px 9px;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-weight:700;font-size:12.5px;letter-spacing:.4px;writing-mode:vertical-rl;text-orientation:mixed;box-shadow:2px 3px 14px rgba(0,0,0,.28);display:flex;align-items:center;gap:8px;transition:padding .2s,background .2s}',
      '#ga-hv-tab:hover{padding-left:15px;background:#bf0016}',
      '#ga-hv-tab svg{transform:rotate(90deg);flex-shrink:0}',
      '@media(max-width:480px){#ga-hv-tab{writing-mode:horizontal-tb;top:auto;bottom:92px;transform:none;border-radius:0 24px 24px 0;padding:10px 15px;font-size:12px}#ga-hv-tab svg{transform:none}}',
      /* save banner */
      '#ga-save-bar{background:' + navy + ';color:#fff;padding:12px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:fixed;top:0;left:0;right:0;z-index:99998;transform:translateY(-100%);transition:transform .35s;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px}',
      '#ga-save-bar.show{transform:translateY(0)}',
      '#ga-save-bar span{flex:1}',
      '#ga-save-email{border:none;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;width:200px}',
      '#ga-save-btn{background:' + red + ';color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}',
      '#ga-save-x{background:none;border:none;color:rgba(255,255,255,.6);font-size:18px;cursor:pointer;margin-left:4px}',
      /* search alert */
      '#ga-search-bar{background:#fff4f5;border:1.5px solid ' + red + ';border-radius:10px;padding:14px 18px;margin:16px 0;display:none;align-items:center;gap:12px;flex-wrap:wrap;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px}',
      '#ga-search-bar.show{display:flex}',
      '#ga-search-bar span{flex:1;color:' + navy + ';font-weight:600}',
      '#ga-search-email{border:1.5px solid #dde0e8;border-radius:6px;padding:8px 12px;font-size:13px;outline:none;width:180px}',
      '#ga-search-btn{background:' + red + ';color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer}',
      /* return visitor banner */
      '#ga-return-bar{background:' + navy + ';color:#fff;padding:10px 20px;display:flex;align-items:center;gap:14px;position:fixed;bottom:0;left:0;right:0;z-index:99998;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;transform:translateY(100%);transition:transform .35s}',
      '#ga-return-bar.show{transform:translateY(0)}',
      '#ga-return-bar span{flex:1}',
      '#ga-return-chat{background:' + red + ';color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer}',
      '#ga-return-x{background:none;border:none;color:rgba(255,255,255,.6);font-size:18px;cursor:pointer}',
      /* booking modal */
      '#ga-book{position:fixed;inset:0;z-index:999999;display:none;align-items:center;justify-content:center}',
      '#ga-book.show{display:flex}',
      '#ga-book-bg{position:absolute;inset:0;background:rgba(0,0,0,.5)}',
      '#ga-book-box{position:relative;background:#fff;border-radius:16px;padding:32px;max-width:400px;width:90%;z-index:1;box-shadow:0 12px 48px rgba(0,0,0,.2);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '#ga-book-close{position:absolute;top:14px;right:18px;background:none;border:none;font-size:22px;cursor:pointer;color:#888}',
      '#ga-book-box h3{color:' + navy + ';font-size:20px;font-weight:800;margin:0 0 6px}',
      '#ga-book-box p{color:#666;font-size:13px;margin:0 0 18px}',
      /* success toast */
      '#ga-toast{position:fixed;bottom:96px;right:24px;background:' + navy + ';color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;z-index:999999;opacity:0;transition:opacity .3s;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:280px}',
      '#ga-bubble{position:fixed;right:24px;bottom:100px;max-width:190px;background:#fff;color:' + navy + ';padding:11px 30px 11px 14px;border-radius:14px;border-bottom-right-radius:4px;box-shadow:0 8px 26px rgba(0,0,0,.20);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13.5px;font-weight:600;line-height:1.35;z-index:99999;cursor:pointer;opacity:0;transform:translateY(8px) scale(.96);transform-origin:bottom right;transition:opacity .3s,transform .3s;pointer-events:none}',
      '#ga-bubble.show{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}',
      '#ga-bubble:after{content:"";position:absolute;right:22px;bottom:-7px;border:7px solid transparent;border-top-color:#fff;border-bottom:0}',
      '#ga-bubble-x{position:absolute;top:5px;right:7px;width:18px;height:18px;border:none;background:none;color:#9aa0ab;font-size:15px;line-height:1;cursor:pointer;padding:0}',
      '#ga-bubble-x:hover{color:' + navy + '}',
      /* mobile */
      '@media(max-width:480px){#ga-panel{width:100%;right:0;bottom:0;height:70vh;border-bottom-left-radius:0;border-bottom-right-radius:0}#ga-btn{bottom:16px;right:16px}}',
      '@media(max-width:480px){#ga-bubble{right:84px;bottom:24px;max-width:150px}}',
    ].join('');
    document.head.appendChild(style);

    // ─── Build widget DOM ───────────────────────────────────────────────────────
    var btn = document.createElement('button');
    btn.id = 'ga-btn';
    btn.setAttribute('aria-label', 'Chat with ' + (cfg.personaName || 'us'));
    var launcherInner = cfg.personaAvatar
      ? '<img src="' + esc(cfg.personaAvatar) + '" alt="' + esc(cfg.personaName) + '"/>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" fill="none" viewBox="0 0 24 24"><path fill="#fff" d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Zm-2 12H6v-2h12v2Zm0-3H6V9h12v2Zm0-3H6V6h12v2Z"/></svg>';
    btn.innerHTML = launcherInner + (cfg.showOnlineDot ? '<span id="ga-btn-dot"></span>' : '') + '<span id="ga-badge">1</span>';

    // Persona avatar: an image if configured, else a branded circle with the initial.
    var personaInitial = esc((((cfg.personaName || 'G').trim().charAt(0)) || 'G').toUpperCase());
    var avatarInner = cfg.personaAvatar
      ? '<img src="' + esc(cfg.personaAvatar) + '" alt="' + esc(cfg.personaName) + '"/>'
      : '<span class="ga-avatar-initial">' + personaInitial + '</span>';
    var onlineDot = cfg.showOnlineDot ? '<span class="ga-persona-dot" title="Online"></span>' : '';

    var panel = document.createElement('div');
    panel.id = 'ga-panel';
    panel.innerHTML = [
      '<div id="ga-head">',
      '  <div id="ga-head-avatar">' + avatarInner + onlineDot + '</div>',
      '  <div id="ga-head-info"><div id="ga-head-name">' + esc(cfg.personaName) + '</div><div id="ga-head-sub">' + esc(cfg.personaRole) + '</div></div>',
      '  <button id="ga-close" aria-label="Close">&#x2715;</button>',
      '</div>',
      '<div id="ga-messages"></div>',
      '<div id="ga-qr-bar"></div>',
      '<div id="ga-form">',
      '  <input id="ga-input" type="text" placeholder="Ask about properties\u2026" autocomplete="off"/>',
      '  <button id="ga-send" aria-label="Send"><svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path fill="#fff" d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>',
      '</div>',
    ].join('');

    var toast = document.createElement('div');
    toast.id = 'ga-toast';

    document.body.appendChild(btn);
    document.body.appendChild(panel);
    document.body.appendChild(toast);

    // Launcher greeting bubble ("How can I help?")
    var bubble = document.createElement('div');
    bubble.id = 'ga-bubble';
    bubble.innerHTML = esc(cfg.launcherPrompt || 'How can I help?') + '<button id="ga-bubble-x" aria-label="Dismiss">\u2715</button>';
    document.body.appendChild(bubble);

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
    var agentPending   = false;   // 'agent' quick-reply asked for contact; capture the next reply
    var quickRepliesEl = null;    // active quick-reply chip row, if any
    var qrBarEl = panel.querySelector('#ga-qr-bar');

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

    // ─── Consent line + intent quick-replies ──────────────────────────────────
    function renderConsent() {
      if (!cfg.consentText) return;                       // blank = owner hid the line
      if (messagesEl.querySelector('#ga-consent')) return; // only ever once
      var c = document.createElement('div');
      c.id = 'ga-consent';
      c.className = 'ga-consent';
      c.textContent = cfg.consentText;
      messagesEl.insertBefore(c, messagesEl.firstChild);
    }

    function hideQuickReplies() {
      if (qrBarEl) { qrBarEl.innerHTML = ''; qrBarEl.classList.remove('show'); }
      quickRepliesEl = null;
    }

    function renderQuickReplies() {
      hideQuickReplies();
      // Fresh conversations only — never resurface once the visitor has spoken.
      if (chatHistory.some(function (m) { return m.role === 'user'; })) return;
      var replies = cfg.quickReplies || [];
      if (!replies.length || !qrBarEl) return;
      replies.forEach(function (q) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'ga-qr-chip';
        chip.textContent = q.label;
        chip.addEventListener('click', function () { handleQuickReply(q); });
        qrBarEl.appendChild(chip);
      });
      qrBarEl.classList.add('show');   // pinned above the input, always visible
      quickRepliesEl = qrBarEl;
    }

    function handleQuickReply(q) {
      switch (q.action) {
        case 'navigate':
          hideQuickReplies();
          if (q.value) window.location.href = q.value;   // relative paths allowed
          break;
        case 'valuation': {
          var vm = document.getElementById('ga-exit') || buildExitModal();
          setTimeout(function () { vm.classList.add('show'); }, 50);
          break;
        }
        case 'booking': {
          var open = document.getElementById('ga-book');
          if (open) open.remove();
          var bm = buildBookModal(document.title);
          setTimeout(function () { bm.classList.add('show'); }, 50);
          break;
        }
        case 'message':
          inputEl.value = q.value || q.label;
          sendMessage();   // routes through /api/chat, renders a user bubble, hides chips
          break;
        case 'agent': {
          hideQuickReplies();
          var msg = 'Absolutely \u2014 I\u2019ll connect you with a Golfi agent. What\u2019s your name and the best number to reach you?';
          if (cfg.phone) msg += ' Or call us now at ' + cfg.phone + '.';
          addMsg('assistant', msg);
          chatHistory.push({ role: 'assistant', content: msg });
          saveHistory();
          agentPending = true;
          inputEl.focus();
          break;
        }
      }
    }

    function openPanel() {
      panel.classList.add('open');
      hideBubble();
      badge.style.display = 'none';
      inputEl.focus();
      if (!messagesEl.children.length) {
        renderConsent();
        // Load history or show greeting
        if (chatHistory.length) {
          chatHistory.forEach(function (m) { addMsg(m.role === 'user' ? 'user' : 'assistant', m.content); });
        } else {
          addMsg('assistant', cfg.greeting);
          renderQuickReplies();
        }
      }
    }

    function closePanel() { panel.classList.remove('open'); }

    btn.addEventListener('click', function () {
      panel.classList.contains('open') ? closePanel() : openPanel();
    });
    closeEl.addEventListener('click', closePanel);

    // ─── Launcher greeting bubble control ────────────────────────────────────────
    function hideBubble() { if (bubble) bubble.classList.remove('show'); }
    function showBubble() {
      if (!bubble || panel.classList.contains('open')) return;
      if (localStorage.getItem('golfi_bubble_x')) return;   // permanently dismissed
      if (chatHistory.length) return;                        // returning chatters skip the nudge
      bubble.classList.add('show');
    }
    bubble.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'ga-bubble-x') return;
      hideBubble();
      openPanel();
    });
    var bubbleX = document.getElementById('ga-bubble-x');
    if (bubbleX) bubbleX.addEventListener('click', function (e) {
      e.stopPropagation();
      hideBubble();
      try { localStorage.setItem('golfi_bubble_x', '1'); } catch (_) {}
    });
    setTimeout(showBubble, 2600);

    function sendMessage() {
      var text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = '';
      hideQuickReplies();                       // first real message retires the chips
      addMsg('user', text);
      chatHistory.push({ role: 'user', content: text });
      saveHistory();

      // 'Talk to an agent' handoff — capture the contact details just provided.
      if (agentPending) {
        var phoneMatch = text.match(/(\+?\d[\d\s().\-]{7,}\d)/);
        if (phoneMatch) {
          var phone = phoneMatch[0].replace(/[^\d+]/g, '');
          var name  = text.replace(phoneMatch[0], '')
                          .replace(/[^A-Za-z\u00C0-\u024F '.\-]/g, ' ')
                          .replace(/\s+/g, ' ').trim();
          captureLead({
            name: name || undefined,
            phone: phone,
            type: 'chat',
            source: 'speak_agent',
            data: { message: text }
          });
          agentPending = false;
          showToast('\u2713 Thanks! A Golfi agent will reach out shortly.');
        }
      }

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

    // ─── Phase 2: Visitor Intelligence ──────────────────────────────────────────
    var heartbeatTimer = null;
    var pageStart = Date.now();

    // Process every /api/event response: track score + trigger smart re-capture
    function handleEventResponse(res) {
      if (!res) return res;
      if (typeof res.score === 'number') lastScore = res.score;
      if (res.captureType === 'smart_recapture' && hooks.smartRecapture.enabled) {
        triggerRecaptureBar(res.topProperty);
      }
      return res;
    }

    function sendEvent(type, data) {
      return api('/event', { sessionId: sid, type: type, data: data || {} })
        .then(function (res) { return handleEventResponse(res); })
        .catch(function () { return {}; });
    }

    // Fire-and-forget beacon for unload-safe events (survives page teardown)
    function beacon(type, data) {
      try {
        var payload = JSON.stringify({ sessionId: sid, type: type, data: data || {} });
        if (navigator.sendBeacon) {
          navigator.sendBeacon(API_BASE + '/event', new Blob([payload], { type: 'application/json' }));
        } else {
          fetch(API_BASE + '/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true
          }).catch(function () {});
        }
      } catch (e) {}
    }

    // Heartbeat — keep the visitor in the 'live' window while the tab is visible
    function startHeartbeat() {
      if (heartbeatTimer) return;
      heartbeatTimer = setInterval(function () {
        if (document.visibilityState === 'visible') sendEvent('heartbeat', { url: window.location.pathname });
      }, 30000);
    }

    function stopHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // Time on page — flush accumulated seconds on hide/unload, no double counting
    function flushPageTime() {
      if (pageStart == null) return;
      var seconds = Math.round((Date.now() - pageStart) / 1000);
      pageStart = Date.now();
      if (seconds < 1) return;
      beacon('page_time', { url: window.location.pathname, seconds: seconds });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') {
        flushPageTime();
        stopHeartbeat();
      } else {
        pageStart = Date.now();
        startHeartbeat();
      }
    });
    window.addEventListener('beforeunload', flushPageTime);
    window.addEventListener('pagehide', flushPageTime);

    if (document.visibilityState === 'visible') startHeartbeat();

    // Smart re-capture — tailored slide-in bar reusing the save-bar styling
    function anyPopupOpen() {
      return !!document.querySelector('#ga-save-bar.show, #ga-search-bar.show, #ga-return-bar.show, #ga-exit.show, #ga-book.show');
    }

    function triggerRecaptureBar(topProperty) {
      if (capturedEmail || localStorage.getItem('golfi_email')) return;
      if (sessionStorage.getItem('golfi_recapture')) return;
      if (anyPopupOpen()) return;
      try { sessionStorage.setItem('golfi_recapture', '1'); } catch (e) {}

      var label = (topProperty && (topProperty.title || topProperty.address)) || 'this property';
      var bar = document.createElement('div');
      bar.id = 'ga-save-bar';
      bar.innerHTML = [
        '<span>\uD83D\uDD14 Still interested in ' + esc(label) + '? Get price-drop alerts.</span>',
        '<input id="ga-save-email" type="email" placeholder="Your email\u2026"/>',
        '<button id="ga-save-btn">Save</button>',
        '<button id="ga-save-x" aria-label="Dismiss">&#x2715;</button>',
      ].join('');
      document.body.appendChild(bar);
      setTimeout(function () { bar.classList.add('show'); }, 300);

      bar.querySelector('#ga-save-x').addEventListener('click', function () { bar.classList.remove('show'); });
      bar.querySelector('#ga-save-btn').addEventListener('click', function () {
        var email = bar.querySelector('#ga-save-email').value.trim();
        if (!email || email.indexOf('@') === -1) return;
        captureLead({ email: email, type: 'property_save', source: 'smart_recapture', data: { property: topProperty || null } });
        bar.classList.remove('show');
        showToast('\u2713 Saved! We\'ll alert you to any price drops.');
      });
    }

    // ─── Hook 1: Property Save Bar ──────────────────────────────────────────────
    function triggerSaveBar() {
      if (!hooks.propertySave.enabled) return;
      if (hookShown['property_save'] || capturedEmail) return;
      if (!isPropertyPage) return;
      hookShown['property_save'] = true;

      var bar = document.createElement('div');
      bar.id = 'ga-save-bar';
      bar.innerHTML = [
        '<span>' + esc(hooks.propertySave.headline) + '</span>',
        '<input id="ga-save-email" type="email" placeholder="Your email\u2026"/>',
        '<button id="ga-save-btn">' + esc(hooks.propertySave.button) + '</button>',
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
        showToast('\u2713 Saved! We\'ll alert you to any price changes.');
      });
    }

    // ─── Hook 3: Search Alert Bar ───────────────────────────────────────────────
    function triggerSearchBar() {
      if (!hooks.searchAlert.enabled) return;
      if (hookShown['search_alert'] || capturedEmail || !isSearchPage) return;
      hookShown['search_alert'] = true;

      var bar = document.createElement('div');
      bar.id = 'ga-search-bar';
      bar.innerHTML = [
        '<span>' + esc(hooks.searchAlert.headline) + '</span>',
        '<input id="ga-search-email" type="email" placeholder="Your email\u2026"/>',
        '<button id="ga-search-btn">' + esc(hooks.searchAlert.button) + '</button>',
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
        showToast('\u2713 Done! We\'ll send matching listings to your inbox.');
      });
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
        '  <h3>' + esc(hooks.exitIntent.headline) + '</h3>',
        '  <p>' + esc(hooks.exitIntent.sub) + '</p>',
        '  <div class="ga-steps"><i class="on"></i><i></i><i></i></div>',
        '  <div class="ga-step active" data-step="1">',
        '    <div class="ga-field"><input id="ga-val-addr" type="text" placeholder="Property address\u2026" autocomplete="off"/></div>',
        '    <p class="ga-hint">Start with your address — it takes about 20 seconds.</p>',
        '    <button class="ga-submit" data-next="2" style="margin-top:14px">Continue \u2192</button>',
        '  </div>',
        '  <div class="ga-step" data-step="2">',
        '    <div class="ga-field"><select id="ga-val-type"><option value="">Property type\u2026</option><option>House</option><option>Condo / Apartment</option><option>Townhouse</option><option>Semi-detached</option><option>Multi-family</option><option>Land</option></select></div>',
        '    <div class="ga-field-row">',
        '      <div class="ga-field"><select id="ga-val-beds"><option value="">Beds</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5+</option></select></div>',
        '      <div class="ga-field"><select id="ga-val-baths"><option value="">Baths</option><option>1</option><option>2</option><option>3</option><option>4+</option></select></div>',
        '    </div>',
        '    <button class="ga-submit" data-next="3" style="margin-top:6px">Continue \u2192</button>',
        '    <button class="ga-back" data-back="1">\u2190 Back</button>',
        '  </div>',
        '  <div class="ga-step" data-step="3">',
        '    <div class="ga-field"><input id="ga-val-name" type="text" placeholder="Your name\u2026"/></div>',
        '    <div class="ga-field"><input id="ga-val-email" type="email" placeholder="Your email\u2026"/></div>',
        '    <div class="ga-field"><input id="ga-val-phone" type="tel" placeholder="Phone (so Gina can send your report)\u2026"/></div>',
        '    <button class="ga-submit" id="ga-val-submit">' + esc(hooks.exitIntent.button) + '</button>',
        '    <button class="ga-back" data-back="2">\u2190 Back</button>',
        '  </div>',
        '  <div class="ga-step" data-step="done">',
        '    <div id="ga-exit-success"><div class="ga-check">\u2713</div><h3 style="margin:8px 0 6px">You\u2019re all set!</h3><p style="margin:0">Gina will personally prepare your home valuation and send it over shortly. Keep an eye on your inbox.</p></div>',
        '  </div>',
        '</div>',
      ].join('');
      document.body.appendChild(el);

      function go(step) {
        var n = parseInt(step, 10) || 3;
        el.querySelectorAll('.ga-step').forEach(function (s) {
          s.classList.toggle('active', s.getAttribute('data-step') === String(step));
        });
        el.querySelectorAll('.ga-steps i').forEach(function (d, i) { d.classList.toggle('on', i < n); });
      }
      function close() { el.classList.remove('show'); }

      el.querySelector('#ga-exit-bg').addEventListener('click', close);
      el.querySelector('#ga-exit-close').addEventListener('click', close);
      el.addEventListener('click', function (e) {
        var t = e.target.closest('[data-next],[data-back]');
        if (!t) return;
        if (t.hasAttribute('data-next')) {
          if (t.getAttribute('data-next') === '2') {
            var a = el.querySelector('#ga-val-addr');
            if (!a.value.trim()) { a.focus(); return; }
          }
          go(t.getAttribute('data-next'));
        } else {
          go(t.getAttribute('data-back'));
        }
      });
      el.querySelector('#ga-val-submit').addEventListener('click', function () {
        var addr  = el.querySelector('#ga-val-addr').value.trim();
        var name  = el.querySelector('#ga-val-name').value.trim();
        var email = el.querySelector('#ga-val-email').value.trim();
        var phone = el.querySelector('#ga-val-phone').value.trim();
        if (!email || !email.includes('@')) { el.querySelector('#ga-val-email').focus(); return; }
        captureLead({
          name: name, email: email, phone: phone, type: 'valuation',
          data: {
            address: addr,
            propertyType: el.querySelector('#ga-val-type').value,
            beds: el.querySelector('#ga-val-beds').value,
            baths: el.querySelector('#ga-val-baths').value,
          },
          source: 'valuation_tool',
        });
        try { localStorage.setItem('golfi_hv_done', '1'); } catch (_) {}
        go('done');
      });
      return el;
    }

    // ─── Hook 5: Book a Viewing ──────────────────────────────────────────────────
    function buildBookModal(propertyTitle) {
      var el = document.createElement('div');
      el.id = 'ga-book';
      el.innerHTML = [
        '<div id="ga-book-bg"></div>',
        '<div id="ga-book-box">',
        '  <button id="ga-book-close" aria-label="Close">&#x2715;</button>',
        '  <h3>' + esc(hooks.booking.headline) + '</h3>',
        '  <p>' + esc(propertyTitle || hooks.booking.sub) + '</p>',
        '  <div class="ga-field"><input id="ga-bk-name" type="text" placeholder="Your name\u2026"/></div>',
        '  <div class="ga-field"><input id="ga-bk-phone" type="tel" placeholder="Phone number\u2026"/></div>',
        '  <div class="ga-field"><input id="ga-bk-email" type="email" placeholder="Email\u2026"/></div>',
        '  <div class="ga-field"><input id="ga-bk-time" type="text" placeholder="Preferred date & time\u2026"/></div>',
        '  <button class="ga-submit" id="ga-bk-submit">' + esc(hooks.booking.button) + '</button>',
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
        showToast('\u2713 Viewing request sent! We\'ll confirm shortly.');
      });
      return el;
    }

    // ─── Event Tracking ─────────────────────────────────────────────────────────
    // Session start — once per browser session, sent before the first page_view
    if (!sessionStorage.getItem('golfi_session_started')) {
      try { sessionStorage.setItem('golfi_session_started', '1'); } catch (e) {}
      sendEvent('session_start', { trafficSource: trafficSource, landingPage: landingPage });
    }

    // Page view (richer payload: traffic source + landing page)
    sendEvent('page_view', {
      url: window.location.pathname,
      title: document.title,
      referrer: document.referrer,
      trafficSource: trafficSource,
      landingPage: landingPage
    });

    // Property view tracking
    if (isPropertyPage) {
      var propId = pagePath.replace(/\//g, '').replace('.html', '');
      propertyViews[propId] = (propertyViews[propId] || 0) + 1;
      localStorage.setItem('golfi_pv', JSON.stringify(propertyViews));
      sendEvent('property_view', { propertyId: propId, title: document.title }).then(function (res) {
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
          sendEvent('search', { url: window.location.href }).then(function (res) {
            if (res && res.shouldCaptureLead && !hookShown['search_alert']) triggerSearchBar();
          });
          if (searchCount >= hooks.searchAlert.threshold && !hookShown['search_alert']) triggerSearchBar();
        });
      }
    }

    // Hook 1 auto-trigger: after N total property views (config threshold)
    if (isPropertyPage && hooks.propertySave.enabled) {
      var totalViews = Object.values(propertyViews).reduce(function (a, b) { return a + b; }, 0);
      if (totalViews >= hooks.propertySave.threshold) setTimeout(triggerSaveBar, 4000);
    }

    // ─── Home-Value tool: sticky tab (always) + reliable auto-popup ──────────────
    var openValuation = function () {
      var vm = document.getElementById('ga-exit') || buildExitModal();
      setTimeout(function () { vm.classList.add('show'); }, 30);
    };

    // Always-available entry point: sticky "What's My Home Worth?" tab on every page.
    if (hooks.exitIntent.enabled) {
      var hvTab = document.createElement('button');
      hvTab.id = 'ga-hv-tab';
      hvTab.type = 'button';
      hvTab.setAttribute('aria-label', 'Find out what your home is worth');
      hvTab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M12 3 2 12h3v8h6v-5h2v5h6v-8h3L12 3Z"/></svg><span>What\u2019s My Home Worth?</span>';
      hvTab.addEventListener('click', openValuation);
      document.body.appendChild(hvTab);
    }

    // Auto-popup: fires on the FIRST of dwell-time / scroll-depth / exit-intent,
    // once per cooldown, never after capture. Time + scroll cover mobile (no mouseleave).
    var HV_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
    var hvRecentlyShown = function () {
      var t = parseInt(localStorage.getItem('golfi_hv_seen') || '0', 10);
      return t && (Date.now() - t) < HV_COOLDOWN_MS;
    };
    if (hooks.exitIntent.enabled && !capturedEmail
        && !localStorage.getItem('golfi_hv_done') && !hvRecentlyShown()) {
      var hvFired = false, hvTimer = null;
      var hvCleanup = function () {
        clearTimeout(hvTimer);
        window.removeEventListener('scroll', hvScroll);
        document.removeEventListener('mouseleave', hvLeave);
      };
      var hvTrigger = function () {
        if (hvFired || exitShown || capturedEmail) return;
        hvFired = true; exitShown = true;
        try { localStorage.setItem('golfi_hv_seen', String(Date.now())); } catch (_) {}
        hvCleanup();
        openValuation();
      };
      var hvScroll = function () {
        var sc = window.scrollY || document.documentElement.scrollTop;
        var h = document.documentElement.scrollHeight - window.innerHeight;
        if (h > 0 && (sc / h) >= 0.5) hvTrigger();
      };
      var hvLeave = function (e) { if (e.clientY <= 10) hvTrigger(); };
      hvTimer = setTimeout(hvTrigger, 30000);
      window.addEventListener('scroll', hvScroll, { passive: true });
      document.addEventListener('mouseleave', hvLeave);
    }

    // Hook 4 wiring: return visitor banner
    if (hooks.returnVisitor.enabled && sessionCount >= 2 && !capturedEmail && !sessionStorage.getItem('ga_rv_shown')) {
      sessionStorage.setItem('ga_rv_shown', '1');
      setTimeout(function () {
        var bar = document.createElement('div');
        bar.id = 'ga-return-bar';
        bar.innerHTML = [
          '<span>' + esc(hooks.returnVisitor.headline) + '</span>',
          '<button id="ga-return-chat">' + esc(hooks.returnVisitor.button) + '</button>',
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

    // Hook 5 wiring: intercept all "Book a Viewing" links/buttons
    if (hooks.booking.enabled) {
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
    }

    // ─── Expose public API ───────────────────────────────────────────────────────
    window.GolfiAgent = {
      open:   openPanel,
      close:  closePanel,
      lead:   captureLead,
      sessionId: sid,
      get score() { return lastScore; }
    };
  }

}());
