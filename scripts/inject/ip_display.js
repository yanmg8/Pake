// IP Display - Show exit IP address in the bottom-left corner.
// Designed to be low-interference:
// - Collapses to a small dot when idle so it barely covers the page
// - Delays the first lookup until the page has finished loading
// - Caps failed retries with backoff (no endless loops under strict CSP)
// - Never steals focus from the page when copying
// - Double-click hides it until the next page load
(function () {
  'use strict';

  // Only run in the top frame, and only once per page.
  if (window.top !== window.self) return;
  if (document.getElementById('pake-ip-display')) return;

  const IDLE_COLLAPSE_MS = 5000;
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const MAX_AUTO_RETRIES = 4;
  const RETRY_BACKOFF_MS = [10000, 20000, 40000, 80000];

  let collapseTimer = null;
  let retryCount = 0;
  let lastIp = '';
  let hiddenByUser = false;

  // --- DOM -----------------------------------------------------------------

  const ipContainer = document.createElement('div');
  ipContainer.id = 'pake-ip-display';
  ipContainer.style.cssText = `
    position: fixed;
    bottom: 10px;
    left: 10px;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    border-radius: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 12px;
    line-height: 1;
    z-index: 999999;
    backdrop-filter: blur(10px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    user-select: none;
    transition: opacity 0.3s ease, padding 0.3s ease;
    overflow: hidden;
    white-space: nowrap;
  `;

  ipContainer.innerHTML = `
    <div id="pake-ip-row" style="display: flex; align-items: center; gap: 8px; padding: 6px 10px;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex: none;">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>
      <span id="pake-ip-text" style="cursor: pointer; user-select: text;">Loading...</span>
      <button id="pake-ip-refresh" type="button" style="
        background: transparent;
        border: none;
        color: #fff;
        cursor: pointer;
        padding: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
        opacity: 0.7;
      " title="Refresh IP (double-click widget to hide)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"></polyline>
          <polyline points="1 20 1 14 7 14"></polyline>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
        </svg>
      </button>
    </div>
  `;

  const rowEl = () => ipContainer.querySelector('#pake-ip-row');
  const textEl = () => ipContainer.querySelector('#pake-ip-text');
  const refreshEl = () => ipContainer.querySelector('#pake-ip-refresh');

  // --- Collapse / expand ----------------------------------------------------
  // When idle the widget shrinks to a small dot, so the click-blocking
  // footprint over the page is only ~20px instead of the whole pill.

  function collapse() {
    const row = rowEl();
    if (!row) return;
    row.querySelectorAll('#pake-ip-text, #pake-ip-refresh').forEach((el) => {
      el.style.display = 'none';
    });
    row.style.padding = '4px';
    ipContainer.style.opacity = '0.4';
  }

  function expand() {
    const row = rowEl();
    if (!row) return;
    row.querySelectorAll('#pake-ip-text, #pake-ip-refresh').forEach((el) => {
      el.style.display = '';
    });
    row.style.padding = '6px 10px';
    ipContainer.style.opacity = '1';
    scheduleCollapse();
  }

  function scheduleCollapse() {
    if (collapseTimer) clearTimeout(collapseTimer);
    collapseTimer = setTimeout(collapse, IDLE_COLLAPSE_MS);
  }

  ipContainer.addEventListener('mouseenter', expand);
  ipContainer.addEventListener('mouseleave', scheduleCollapse);

  // Double-click hides the widget until the next page load.
  ipContainer.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    hiddenByUser = true;
    if (collapseTimer) clearTimeout(collapseTimer);
    ipContainer.remove();
  });

  // --- Copy ----------------------------------------------------------------

  function showCopyFeedback(message, color) {
    const el = textEl();
    if (!el) return;
    const originalText = el.textContent;
    el.textContent = message;
    el.style.color = color || '#4ade80';
    setTimeout(() => {
      el.textContent = originalText;
      el.style.color = '#fff';
    }, 1500);
  }

  // Fallback copy that restores the page's focus afterwards.
  function fallbackCopy(text) {
    const previousFocus = document.activeElement;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText =
      'position: fixed; top: 0; left: 0; opacity: 0; pointer-events: none;';
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (_err) {
      ok = false;
    }
    textarea.remove();
    if (
      previousFocus &&
      previousFocus !== document.body &&
      typeof previousFocus.focus === 'function'
    ) {
      previousFocus.focus({ preventScroll: true });
    }
    showCopyFeedback(ok ? 'Copied!' : 'Copy failed', ok ? '#4ade80' : '#ff6b6b');
  }

  function copyIp() {
    if (!lastIp) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(lastIp)
        .then(() => showCopyFeedback('Copied!'))
        .catch(() => fallbackCopy(lastIp));
    } else {
      fallbackCopy(lastIp);
    }
  }

  // --- IP lookup -------------------------------------------------------------

  async function fetchIP() {
    const ipServices = [
      { url: 'https://api.ipify.org?format=json', parser: (d) => d.ip },
      { url: 'https://api.ip.sb/ip', parser: (d) => d.trim() },
      { url: 'https://ifconfig.me/ip', parser: (d) => d.trim() },
      { url: 'https://icanhazip.com', parser: (d) => d.trim() },
      { url: 'https://api.myip.com', parser: (d) => d.ip },
      { url: 'https://api64.ipify.org?format=json', parser: (d) => d.ip },
    ];

    for (const service of ipServices) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(service.url, {
          method: 'GET',
          cache: 'no-cache',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!response.ok) continue;

        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
          ? await response.json()
          : await response.text();
        const ip = service.parser(data);

        const isIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip);
        const isIPv6 = /^[0-9a-fA-F:]+$/.test(ip) && ip.includes(':');
        if (isIPv4 || isIPv6) {
          return { ip, type: isIPv6 ? 'IPv6' : 'IPv4' };
        }
      } catch (_error) {
        // Try the next service; a single console.warn happens in updateIP.
      }
    }
    throw new Error('All IP services failed');
  }

  async function updateIP(isManual) {
    const el = textEl();
    if (!el) return;

    try {
      const result = await fetchIP();
      lastIp = result.ip;
      retryCount = 0;
      el.textContent =
        result.type === 'IPv6' ? `${result.ip} (v6)` : result.ip;
      el.style.color = '#fff';
    } catch (_error) {
      el.textContent = 'Error';
      el.style.color = '#ff6b6b';
      // Cap automatic retries with backoff so strict-CSP pages (where every
      // lookup is blocked) don't get an endless request/console-noise loop.
      // The manual refresh button always works and resets the counter.
      if (isManual) retryCount = 0;
      if (retryCount < MAX_AUTO_RETRIES) {
        const delay = RETRY_BACKOFF_MS[retryCount] || 80000;
        retryCount += 1;
        setTimeout(() => updateIP(false), delay);
      } else {
        console.warn(
          '[Pake IP] IP lookup failed repeatedly (network or page CSP). Use the refresh button to retry.',
        );
      }
    }
  }

  // --- Init ------------------------------------------------------------------

  function mount() {
    if (!document.body || document.getElementById('pake-ip-display')) return;
    document.body.appendChild(ipContainer);

    textEl().addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyIp();
    });

    const refreshBtn = refreshEl();
    refreshBtn.addEventListener('mouseenter', () => {
      refreshBtn.style.background = 'rgba(255, 255, 255, 0.1)';
      refreshBtn.style.opacity = '1';
    });
    refreshBtn.addEventListener('mouseleave', () => {
      refreshBtn.style.background = 'transparent';
      refreshBtn.style.opacity = '0.7';
    });
    refreshBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const el = textEl();
      if (el && el.textContent !== 'Refreshing...') {
        el.textContent = 'Refreshing...';
        el.style.color = '#fff';
        updateIP(true);
      }
    });

    scheduleCollapse();

    // Delay the first lookup until the page itself has finished loading so
    // the widget never competes with the page's own requests.
    const startLookup = () => setTimeout(() => updateIP(false), 1500);
    if (document.readyState === 'complete') {
      startLookup();
    } else {
      window.addEventListener('load', startLookup, { once: true });
    }

    // Periodic refresh; also re-mount if an SPA re-rendered <body> and
    // removed the widget.
    setInterval(() => {
      if (hiddenByUser) return;
      if (!ipContainer.isConnected) {
        if (document.body) document.body.appendChild(ipContainer);
        return;
      }
      updateIP(false);
    }, REFRESH_INTERVAL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
