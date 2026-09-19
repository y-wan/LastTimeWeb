# Last Time

Last Time is an offline-first, installable React PWA for remembering when you last did something. It stores data locally in IndexedDB and can optionally sync an app-private JSON document through Microsoft Graph's OneDrive App Folder.

## Run locally

Requires Node.js 20 or newer.

```powershell
npm install
npm run dev
```

Production checks:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

## OneDrive setup

No client secret is used or needed. Create a **Single-page application** registration in Microsoft Entra admin center:

1. Register an app and choose the supported account type you want. `Accounts in any organizational directory and personal Microsoft accounts` works for both work and personal OneDrive.
2. Under **Authentication**, add a **Single-page application** redirect URI matching the exact deployed app URL, including its trailing slash:
   - Local Vite: `http://localhost:5173/`
   - Cloudflare Workers: the root `https://lasttimeweb.<account-subdomain>.workers.dev/` URL shown after deployment, including the trailing slash, or the exact custom-domain root URL
3. Under **API permissions**, add Microsoft Graph delegated permission `Files.ReadWrite.AppFolder`. Admin consent is normally not required for personal use.
4. Copy the Application (client) ID into `.env.local`:

```text
VITE_MS_CLIENT_ID=00000000-0000-0000-0000-000000000000
# Optional; defaults to the multi-tenant/personal "common" authority
VITE_MS_AUTHORITY=https://login.microsoftonline.com/common
```

The app signs in with MSAL Browser, requests only `Files.ReadWrite.AppFolder`, and reads/writes `last-time-data.json` under Graph `/me/drive/special/approot`. Sync runs on startup, foreground resume, local changes, manual request, and network restoration. Errors remain visible in the UI.

MSAL always uses the deployment origin root as its redirect URI. For example, a deployment at `https://lasttimeweb.example.workers.dev` must have exactly `https://lasttimeweb.example.workers.dev/` registered as an SPA redirect URI; do not register a route or omit the trailing slash.

## Deploy

The repository is configured for Cloudflare Workers Static Assets. `wrangler.jsonc` publishes only `dist/` and uses `single-page-application` not-found handling, so client-side routes fall back to `index.html`. There is no Worker server script; static asset requests retain the free-tier asset-only behavior.

In the Cloudflare **Workers Builds** setup for project `lasttimeweb`, use:

```text
Build command: npm run build
Deploy command: npx wrangler deploy
```

For a local command-line deployment:

```powershell
npm run build
npx wrangler deploy
```

Do not put `VITE_MS_CLIENT_ID` in `wrangler.jsonc`. Configure it as a Cloudflare build variable so Vite can embed the public application ID during the build. After the first deployment, add the exact HTTPS deployment URL as an SPA redirect URI in Microsoft Entra before enabling OneDrive.

## Install

- **iPhone/iPad:** open the HTTPS site in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open the site in Chrome/Edge and choose **Install app** or **Add to Home screen**.
- **Desktop:** use the install icon in the browser address bar.

The service worker caches the app shell after the first successful load. Events, history, import/export, and pending sync data continue to work offline.

## Import and export

Settings supports:

- Existing iOS CSV columns `Event`, `Note`, `Date`, `Time`, and `Timestamp`.
- Enriched portable columns `Event`, `Event Note`, `Icon`, `Color`, `Event Created`, `Occurrence`, and `Occurrence Note`.
- Common Android-style aliases including `Name`/`title`, `createdAt`, `eventId`, `occurrenceId`, `occurredAt`, and occurrence timestamps.

Exports use the enriched portable format and preserve event notes, icon, color, event creation time, occurrence time, and occurrence notes. Future occurrence timestamps are ignored during import and blocked in the editor.

## Sync behavior

Events and occurrences use stable UUIDs and ISO `updatedAt` values. Deletions are retained as tombstones. Merging is by UUID, chooses the latest update, and uses a deterministic serialized-record tie breaker when timestamps are equal. This prevents the same occurrence from being duplicated when two clients sync.
