// Floating panel listing endpoints currently rate-limited, with a live Retry-After countdown,
// plus a diagnosis line when ChatGPT shows its conversation load error, and the optional
// auto reload once the wait is over.
// Relies on helpers from common.js.
(() => {
  // ChatGPT's conversation load error (message id chatgptConversations.loadError). The search,
  // the change filter and the whole-line check below all use this one list. The current English
  // text is "Could not load this ChatGPT conversation"; "Unable to load conversation" is older.
  const ERROR_PHRASES = ['대화를 불러올 수 없습니다', 'Could not load this ChatGPT conversation', 'Unable to load conversation'];
  // Matched as a whole short line, not as a substring of prose.
  const ERROR_LINE = /^(이 )?ChatGPT 대화를 불러올 수 없습니다\.?$|^Could not load this ChatGPT conversation\.?$|^Unable to load conversation\b.{0,60}$/;
  const ERROR_XPATH = `//text()[${ERROR_PHRASES.map(p => `contains(., '${p}')`).join(' or ')}]`;
  const ERROR_TEXT = new RegExp(ERROR_PHRASES.join('|'));
  // Places where the error text can appear as content rather than as ChatGPT's error UI.
  const CONTENT_AREAS = '[data-message-author-role], article, [contenteditable], textarea, pre, code, .markdown';
  const COMPOSER = '#prompt-textarea';
  // Auto reload fires this long after Retry-After has passed, never before.
  const RELOAD_GRACE_MS = 1000;
  // When the error shows up after the wait already passed, give the user a moment to cancel.
  const RELOAD_NOTICE_MS = 3000;
  let entries = {};
  let events = [];
  let errorSince = 0;
  // Same-document (SPA) navigation: observations from before it belong to another conversation.
  let convId = conversationIdFromPath(location.pathname);
  let since = 0;
  // Closing only hides the panel for this page view; the state itself is kept,
  // so a reload or a newer 429 brings it back.
  let hiddenAt = 0;
  let tickTimer = 0;
  let observer = null;
  // Auto reload is opt-in (popup setting). Cancelling or firing it ends it for this page view.
  let autoReload = false;
  let reloadCancelled = false;
  let reloadSent = false;
  let reloadRefused = '';
  // Reloads this tab already had in the window (from the background), for the backoff.
  let recentReloads = 0;
  // Not before this time, after the background reported a newer or longer limit.
  let notBefore = 0;
  // Conversation-load 429s seen before this page loaded (from the background's history).
  let recent429 = [];

  const host = document.createElement('div');
  host.id = 'retry-after-monitor';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      [hidden] { display: none !important; }
      .panel { position: fixed; right: 16px; bottom: 96px; z-index: 2147483647; box-sizing: border-box;
        width: 284px; max-width: calc(100vw - 32px); padding: 8px 12px 12px;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans KR", "Malgun Gothic", sans-serif; font-size: 13px; line-height: 1.45; color: #eef4f2; color-scheme: dark;
        word-break: keep-all; overflow-wrap: break-word;
        background: #1a2022; border: 1px solid rgba(255,255,255,.09); border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0,0,0,.32); }
      .head { display: flex; align-items: center; justify-content: space-between; margin-right: -6px; }
      .title { font-size: 12px; font-weight: 600; color: #9fb3ae; }
      button { font: inherit; color: inherit; cursor: pointer; }
      button:focus-visible { outline: 2px solid #5fd3b5; outline-offset: 1px; }
      .close { display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
        border: 0; border-radius: 7px; background: none; color: #9fb3ae; }
      .close:hover { background: rgba(255,255,255,.08); color: #fff; }
      .row { padding-top: 6px; }
      .line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
      .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .t { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
      .bar { height: 3px; margin-top: 5px; overflow: hidden; border-radius: 2px; background: rgba(255,255,255,.09); }
      .fill { height: 100%; background: currentColor; transform-origin: left; }
      .wait { color: #ffa385; } .ready { color: #5fd3b5; } .unknown { color: #f1cf73; }
      .wait .label, .ready .label, .unknown .label { color: #eef4f2; }
      .unknown .bar { display: none; }
      .note { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.09); }
      /* No divider when nothing is listed above the note. */
      .rows:empty + .note, .rows:empty + .note[hidden] + .note { margin-top: 4px; padding-top: 0; border-top: 0; }
      .note small { display: block; margin-top: 2px; overflow-wrap: anywhere; font-size: 12px; color: #9fb3ae; }
      .reload { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .reload-text { font-variant-numeric: tabular-nums; }
      .cancel { flex: none; padding: 3px 10px; border: 0; border-radius: 7px; background: rgba(255,255,255,.1); }
      .cancel:hover { background: rgba(255,255,255,.16); }
    </style>
    <div class="panel" role="region" aria-label="Cooldown" hidden>
      <div class="head">
        <span class="title">Cooldown</span>
        <button class="close" type="button">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="rows"></div>
      <div class="note diag" role="status" hidden></div>
      <div class="note reload" hidden><span class="reload-text"></span><button class="cancel" type="button"></button></div>
    </div>`;
  const panel = root.querySelector('.panel');
  const rows = root.querySelector('.rows');
  const diag = root.querySelector('.diag');
  const reload = root.querySelector('.reload');
  const reloadText = root.querySelector('.reload-text');
  const cancel = root.querySelector('.cancel');
  const close = root.querySelector('.close');
  close.onclick = () => {
    hiddenAt = Date.now();
    render();
  };
  cancel.onclick = () => {
    reloadCancelled = true;
    render();
  };
  document.documentElement.appendChild(host);

  // Text that doesn't change with state; reapplied when the language setting changes.
  function applyLanguage(r) {
    if (r?.messages) setMessages(r.messages);
    root.host.lang = r?.language || DEFAULT_LANGUAGE;
    close.title = i18n('panelClose');
    close.setAttribute('aria-label', i18n('panelClose'));
    cancel.textContent = i18n('reloadCancel');
    diagShown = '';
  }

  // After the extension is reloaded or updated, this script is orphaned: chrome.runtime
  // calls throw "Extension context invalidated". Remove ourselves instead of erroring forever.
  function teardown() {
    clearInterval(tickTimer);
    observer?.disconnect();
    host.remove();
  }
  function send(msg, cb) {
    if (!chrome.runtime?.id) { teardown(); return; }
    try {
      chrome.runtime.sendMessage(msg, r => {
        // Read lastError so a missing receiver doesn't log "Unchecked runtime.lastError".
        if (chrome.runtime.lastError) return cb?.(undefined);
        cb?.(r);
      });
    } catch {
      teardown();
    }
  }

  // ChatGPT's error UI: the line stands alone, is visible, is outside any message or input,
  // and sits in a small block together with a button (its "Retry").
  function isErrorUi(textNode) {
    const el = textNode.parentElement;
    if (!el || !ERROR_LINE.test(textNode.textContent.trim())) return false;
    // Without these options checkVisibility() ignores visibility:hidden and opacity:0.
    if (el.closest(CONTENT_AREAS) || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    for (let a = el.parentElement, d = 0; a && d < 4; a = a.parentElement, d++) {
      if (a.textContent.length > 200) break;
      if (a.querySelector('button')) return true;
    }
    return false;
  }
  // The text node of the error UI currently shown, so later checks don't have to search again.
  let errorNode = null;
  function errorVisible() {
    if (errorNode?.isConnected && isErrorUi(errorNode)) return true;
    errorNode = null;
    const found = document.evaluate(ERROR_XPATH, document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < found.snapshotLength; i++) {
      if (isErrorUi(found.snapshotItem(i))) { errorNode = found.snapshotItem(i); return true; }
    }
    return false;
  }
  // Cheap recheck of the error already found: still in the page, still visible, still the error UI.
  // Catches it being hidden by CSS, which the observer doesn't watch.
  const errorStillShown = () => !!errorNode?.isConnected && isErrorUi(errorNode);
  // Whether a DOM change could have brought the error text in. Streaming replies change the DOM
  // constantly, and searching the whole page each time is costly on long chats.
  const mentionsError = r => r.type === 'characterData'
    ? ERROR_TEXT.test(r.target.data)
    : [...r.addedNodes].some(n => ERROR_TEXT.test(n.textContent || ''));
  // A reload would throw away text the user has typed but not sent.
  function draftPending() {
    const c = document.querySelector(COMPOSER);
    return !!c && (c.value ?? c.textContent).trim().length > 0;
  }

  const nameOf = (method, url) => {
    const key = endpointName(method, url);
    return key ? i18n(key) : (method === 'GET' ? '' : method + ' ') + shortenPath(endpointOf(url));
  };

  // The latest conversation-load 429 for this chat from before this page loaded, as a line,
  // so a reload doesn't hide that the limit was hit moments ago.
  function earlierLimit(now) {
    const r = recent429.filter(h => convId && h.url.includes(convId) && h.at < (performance.timeOrigin || now)).sort((a, b) => b.at - a.at)[0];
    if (!r) return null;
    const wait = r.until != null ? formatWait(Math.max(0, Math.round((r.until - r.at) / 1000))) : '?';
    return i18n('diagRecent429', formatWait(Math.max(0, Math.round((now - r.at) / 1000))), wait);
  }

  function describe(d, now) {
    const e = d.event;
    const where = e ? `${e.method} ${shortenPath(e.url)}` : '';
    switch (d.kind) {
      // ChatGPT blocks its own Retry until the same time the countdown shows.
      case 'waiting': return [i18n('diagWaiting'), i18n('diagWaitingDetail')];
      case 'elapsed': return [i18n('diagElapsed'), i18n('diagElapsedDetail', e.raw, where)];
      case 'nowait': return [i18n('diagNoWait'), i18n('diagNoWaitDetail', where)];
      case 'notRequested': return [i18n('diagNotRequested'), i18n('diagNotRequestedDetail', e.error), earlierLimit(now)];
      case 'neterr': return e.afterHeaders != null
        ? [i18n('diagNetErrAfterHeaders', e.error), i18n('diagNetErrAfterHeadersDetail', where, e.afterHeaders), earlierLimit(now)]
        : [i18n('diagNetErr', e.error), where, earlierLimit(now)];
      case 'ok': return [i18n('diagOk'), `${where} · ${e.status}`, earlierLimit(now)];
      default: return [i18n('diagNone'), i18n('diagNoneDetail'), earlierLimit(now)];
    }
  }

  let diagShown = '';
  function renderDiagnosis(d, now) {
    if (!errorSince) { diag.hidden = true; diagShown = ''; return false; }
    const lines = describe(d, now).filter(Boolean);
    // Rebuild only on change, so screen readers announce it once and tooltips don't flicker.
    // The "ago" in the earlier-limit line changes every second, so it isn't part of the key.
    const keyText = lines.slice(0, 2).join('\n') + (lines.length > 2 ? '\n+' : '');
    if (diagShown !== keyText) {
      diagShown = keyText;
      const head = document.createElement('div');
      head.textContent = lines[0];
      const details = lines.slice(1).map(text => {
        const detail = document.createElement('small');
        detail.textContent = text;
        return detail;
      });
      if (d.event && details[0]) details[0].title = d.event.url;
      diag.replaceChildren(head, ...details);
    } else if (lines.length > 2) {
      const last = diag.lastElementChild;
      if (last && last.textContent !== lines[2]) last.textContent = lines[2];
    }
    diag.hidden = false;
    return true;
  }

  // When to reload, or null. Only for the load error caused by a conversation-load 429
  // with a known wait, and only once that wait is over.
  function reloadAt(d) {
    if (!autoReload || reloadCancelled || !errorSince) return null;
    if (d.kind !== 'waiting' && d.kind !== 'elapsed') return null;
    // The notice delay is only for an error that first showed up after the wait had already passed.
    const base = errorSince >= d.event.until ? errorSince + RELOAD_NOTICE_MS : d.event.until + RELOAD_GRACE_MS;
    // The server can keep refusing after its own wait, so each further reload of this tab waits longer.
    const backoff = RELOAD_BACKOFF_MS[Math.min(recentReloads, RELOAD_BACKOFF_MS.length - 1)];
    return Math.max(base + backoff, notBefore);
  }

  function renderReload(d, now) {
    let text = null;
    let cancellable = true;
    if (reloadRefused) {
      // Keep an unverified refusal latched to prevent repeat attempts, without a notice.
      text = reloadRefused === 'unverified' ? null
        : reloadRefused === 'limit' ? i18n('reloadLimited', RELOAD_LIMIT, RELOAD_WINDOW_MS / 60000)
        : i18n('reloadFailed');
      cancellable = false;
    } else if (reloadSent) {
      text = i18n('reloadNow');
      cancellable = false;
    } else {
      const at = reloadAt(d);
      if (at != null) {
        if (at > now) text = i18n('reloadIn', formatWait(Math.ceil((at - now) / 1000)));
        else if (draftPending()) text = i18n('reloadPausedDraft');
        // Last look right before asking: the error must still be on screen and the URL still
        // this conversation (an in-page navigation may not have touched the DOM yet).
        else if (!errorStillShown() || conversationIdFromPath(location.pathname) !== convId) scheduleCheck(0);
        else {
          reloadSent = true;
          text = i18n('reloadNow');
          cancellable = false;
          send({ type: 'reloadTab', convId }, r => {
            if (r?.ok) return;
            reloadSent = false;
            // The background saw a newer or longer limit: wait for it, then decide again.
            if (r?.reason === 'waiting' && r.until) notBefore = r.until + RELOAD_GRACE_MS;
            else if (r?.reason === 'disabled') autoReload = false;
            else reloadRefused = ['limit', 'unverified'].includes(r?.reason) ? r.reason : 'error';
            render();
          });
        }
      }
    }
    reload.hidden = text == null;
    if (text == null) return false;
    if (reloadText.textContent !== text) reloadText.textContent = text;
    cancel.hidden = !cancellable;
    return true;
  }

  // Rows are kept per entry and updated in place every tick.
  const rowEls = new Map();
  function rowFor(e) {
    let r = rowEls.get(e.key);
    if (!r) {
      const el = document.createElement('div');
      el.className = 'row';
      el.innerHTML = '<div class="line"><span class="label"></span><span class="t"></span></div><div class="bar"><div class="fill"></div></div>';
      r = { el, label: el.querySelector('.label'), t: el.querySelector('.t'), fill: el.querySelector('.fill') };
      rowEls.set(e.key, r);
    }
    return r;
  }
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

  function render() {
    const now = Date.now();
    // Every tick: an in-page navigation can change the URL before any DOM change, and the
    // error can be hidden by CSS without one. Both are cheap to look at.
    syncConversation();
    if (errorSince && !errorStillShown()) scheduleCheck(0);
    // Expired entries are removed by the background worker; just stop showing them.
    const list = Object.values(entries).filter(e => staleAt(e) > now)
      // Longest wait first; entries without a known wait go last.
      .sort((a, b) => (b.until ?? -Infinity) - (a.until ?? -Infinity));

    const els = list.map(e => {
      const r = rowFor(e);
      let state, time, left = 0;
      if (e.until == null) {
        state = 'unknown';
        time = i18n('rowNoHeader');
      } else {
        left = Math.max(0, e.until - now);
        state = left > 0 ? 'wait' : 'ready';
        time = left > 0 ? formatWait(Math.ceil(left / 1000)) : i18n('rowReady');
      }
      r.el.className = `row ${state}`;
      setText(r.label, nameOf(e.method, e.path));
      setText(r.t, time);
      const title = `${e.method} ${e.path}\nRetry-After: ${e.raw ?? i18n('rowTooltipNoHeader')}` +
        (e.rawHistory != null ? `\nx-oai-history-initial-retry-after: ${e.rawHistory}` : '') +
        `\n${i18n('rowTooltipReceived', new Date(e.at).toLocaleTimeString())}`;
      if (r.el.title !== title) r.el.title = title;
      const span = e.until != null ? e.until - e.at : 0;
      // The bar drains while waiting and fills up once retrying is allowed.
      r.fill.style.transform = `scaleX(${state === 'ready' ? 1 : span > 0 ? (left / span).toFixed(4) : 0})`;
      return r.el;
    });
    const keep = new Set(list.map(e => e.key));
    for (const k of rowEls.keys()) if (!keep.has(k)) rowEls.delete(k);
    if (els.length !== rows.children.length || els.some((el, i) => rows.children[i] !== el)) rows.replaceChildren(...els);

    const d = errorSince ? diagnose(events, { convId, since, now }) : { kind: 'none' };
    const diagnosed = renderDiagnosis(d, now);
    const reloading = renderReload(d, now);
    panel.hidden = !(list.some(e => e.at > hiddenAt) || ((diagnosed || reloading) && errorSince > hiddenAt));
  }

  // Same-document navigation is noticed on the next DOM change, which ChatGPT always makes.
  function syncConversation() {
    const id = conversationIdFromPath(location.pathname);
    if (id === convId) return;
    convId = id;
    // Small slack: the new conversation's first response can land just before this runs.
    // Older events naming the previous conversation are excluded by id anyway.
    since = Date.now() - 1000;
  }

  let checkTimer = 0;
  // Error text that arrived hidden (e.g. while fading in) is rechecked a few times.
  let pendingChecks = 0;
  function check() {
    checkTimer = 0;
    syncConversation();
    const shown = errorVisible();
    if (!shown && pendingChecks > 0) { pendingChecks--; checkTimer = setTimeout(check, 500); }
    if (shown === !!errorSince) return;
    errorSince = shown ? Date.now() : 0;
    render();
  }
  function scheduleCheck(delay) {
    if (!checkTimer) checkTimer = setTimeout(check, delay);
  }
  observer = new MutationObserver(records => {
    syncConversation();
    // While the error is shown, any change may remove it; otherwise only changes carrying its text matter.
    const mentioned = !errorSince && records.some(mentionsError);
    if (mentioned) pendingChecks = 4;
    if (errorSince || mentioned) scheduleCheck(250);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'update') { entries = msg.entries; render(); }
    if (msg.type === 'event') { events = [...events, msg.event]; render(); }
  });
  try {
    chrome.storage.local.get('autoReload').then(r => { autoReload = r.autoReload === true; render(); }, () => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.autoReload) { autoReload = changes.autoReload.newValue === true; render(); }
      if (changes.language) send({ type: 'messages' }, r => { applyLanguage(r); render(); });
    });
  } catch {
    teardown();
  }
  // Load the UI language first so nothing is ever shown in the wrong one.
  send({ type: 'messages' }, m => {
    applyLanguage(m);
    send({ type: 'get' }, r => {
      entries = r?.entries || {};
      events = r?.events || [];
      recent429 = r?.recent429 || [];
      recentReloads = r?.recentReloads || 0;
      check();
      render();
    });
  });
  tickTimer = setInterval(() => { if (Object.keys(entries).length || errorSince) render(); }, 250);
})();
