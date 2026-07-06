# Custom Feature Docs (migrated from pake2)

This directory archives customization docs migrated from the old `pake2` fork (based on upstream V3.9.1). Status of each item against the current codebase:

| Doc | Status |
| --- | --- |
| `IP_DISPLAY.md` | Implemented via `--inject`. Script lives at `scripts/inject/ip_display.js`. No source changes needed. |
| App token (`--app-token`) | Implemented in the main CLI. See `docs/cli-usage.md` / `docs/cli-usage_CN.md`. |
| `DEVICE_AUTH.md` | Design doc only. Client-side hardware fingerprinting was never implemented (in pake2 either). |
| `AUTH_SERVER.md` / `worker.ts` | Server-side auth service (Cloudflare Workers + D1). Standalone, deploy separately. |
| `AUTH_STRATEGIES.md` | Design doc for auth failure/offline policies. Not implemented. |
| `CUSTOM_HEADERS.md` | Design doc only. No client implementation existed in pake2. |

## IP display usage

The script shows the current exit IP in the bottom-left corner (multi-source lookup with IPv6 fallback, click-to-copy, manual refresh button, auto-refresh every 5 minutes).

Low-interference behavior (rewritten from the pake2 version, which could block page buttons and loop requests):

- Collapses to a small dot after 5s idle; hover to expand. The click-blocking footprint over the page is ~20px when idle.
- Double-click the widget to hide it until the next page load.
- First lookup waits for the page `load` event + 1.5s, so it never competes with page loading.
- Failed lookups retry at most 4 times with backoff (10s → 80s), then stop; pages with strict CSP no longer cause endless request/console loops. The refresh button always retries.
- Copying never steals focus from page inputs; runs only in the top frame; re-mounts itself if an SPA re-renders `<body>`.

```bash
pake https://example.com --name MyApp --inject scripts/inject/ip_display.js
```

Combine with app token:

```bash
pake https://example.com --name MyApp \
  --app-token abc123 \
  --inject scripts/inject/ip_display.js
```

Note: `IP_DISPLAY.md` was written for pake2 where the script was injected unconditionally and describes the position as bottom-right; the actual position is bottom-left, and in this repo injection is opt-in via `--inject`.
