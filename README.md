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

1. Register an app with **Accounts in any organizational directory and personal Microsoft accounts** as the supported account type (`AzureADandPersonalMicrosoftAccount`).
2. Under **Authentication**, add a **Single-page application** redirect URI matching the exact deployed app URL, including its trailing slash:
   - Local Vite: `http://localhost:5173/`
   - Cloudflare Workers: the root `https://lasttimeweb.<account-subdomain>.workers.dev/` URL shown after deployment, including the trailing slash, or the exact custom-domain root URL
3. Under **API permissions**, add Microsoft Graph delegated permission `Files.ReadWrite.AppFolder`. Admin consent is normally not required for personal use.
4. Copy the Application (client) ID into `.env.local`:

```text
VITE_MS_CLIENT_ID=00000000-0000-0000-0000-000000000000
```

The app pins MSAL Browser to `https://login.microsoftonline.com/common`, matching the organizational-and-personal account audience. It requests only the delegated `Files.ReadWrite.AppFolder` permission and reads/writes `last-time-data.json` under Graph `/me/drive/special/approot`. Organizational tenants may require user or administrator consent according to tenant policy; do not add broader Graph permissions. Sync runs on startup, foreground resume, local changes, manual request, and network restoration. Errors remain visible in the UI.

MSAL always uses the deployment origin root as its redirect URI. For example, a deployment at `https://lasttimeweb.example.workers.dev` must have exactly `https://lasttimeweb.example.workers.dev/` registered as an SPA redirect URI; do not register a route or omit the trailing slash.

Authentication guidance:

- A `userAudience` error mentioning `/common` means the Entra registration is using the wrong supported account type. Select **Accounts in any organizational directory and personal Microsoft accounts**.
- Personal Microsoft accounts can normally grant user consent for `Files.ReadWrite.AppFolder`.
- A work/school account may show **admin approval required** or `AADSTS65001` when its tenant restricts user consent or unverified apps. A tenant administrator must approve the existing delegated permission, or the user can choose a personal Microsoft account. Changing to `/consumers` or requesting broader Graph permissions is not the fix.

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

On launch, foreground resume, and periodic checks while open, the installed PWA checks for a newer service worker. When one is waiting, the app shows a localized **New version available** banner. **Update now** activates it and reloads; **Later** dismisses it for the current run, without interrupting an open editor or silently reloading.

## Import and export

Settings supports:

- Existing iOS CSV columns `Event`, `Note`, `Date`, `Time`, and `Timestamp`.
- Enriched portable columns `Event`, `Event Note`, `Icon`, `Color`, `Event Created`, `Occurrence`, and `Occurrence Note`.
- Common Android-style aliases including `Name`/`title`, `createdAt`, `eventId`, `occurrenceId`, `occurredAt`, and occurrence timestamps.

Exports use the enriched portable format and preserve event notes, icon, color, event creation time, occurrence time, and occurrence notes. Future occurrence timestamps are ignored during import and blocked in the editor.

## Sync behavior

Events and occurrences use stable UUIDs and ISO `updatedAt` values. Deletions are retained as tombstones. Merging is by UUID and chooses the latest update; equal timestamps prefer deletion, then use a canonical property-order-independent record comparison. The same occurrence UUID is never duplicated, while separate repeated occurrences remain separate records.

OneDrive uploads use the DriveItem ETag with `If-Match` (or `If-None-Match` when creating the file). A stale writer re-reads local and remote data, merges, and retries up to three times instead of overwriting a newer file. Local mutations and sync operations share a Web Lock where supported, with an in-process fallback, so a stale sync snapshot cannot overwrite a queued mutation. Conflict ordering still depends on device-generated wall-clock `updatedAt` values, so substantial clock skew can make an older real-world edit appear newer.
