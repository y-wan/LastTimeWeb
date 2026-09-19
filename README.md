English | [简体中文](README.zh-CN.md)

# Last Time

Last Time is an offline-first, installable React PWA for remembering when you last did something. It stores data locally in IndexedDB and can optionally sync an app-private JSON document through Microsoft Graph's OneDrive App Folder.

## Use the app

Open the live PWA at **[https://lasttimeweb.feliciameow.workers.dev/](https://lasttimeweb.feliciameow.workers.dev/)**.

### Install on iPhone or iPad

1. Open the exact live URL in Safari.
2. Tap **Share**, then **Add to Home Screen**.
3. Launch Last Time from the installed Home Screen icon.
4. When the app shows **New version available**, choose **Update now**. The app waits for the new Service Worker to take control before reloading and shows a retryable error instead of hanging if activation times out.

### Install on Android

1. Open the live URL in Chrome or Edge.
2. Choose **Install app** or **Add to Home screen**.
3. Launch Last Time from the installed app icon.

### Optional cross-device sync

Data stays in this device's IndexedDB while signed out. To synchronize devices, sign in with the same personal or organizational Microsoft account on each device. The app uses only the account's private OneDrive App Folder and the delegated `Files.ReadWrite.AppFolder` permission; it does not request access to the rest of OneDrive. An organizational tenant may require administrator consent.

Sync runs while the app is open: at startup, foreground resume, local changes/imports, manual retry, and network restoration. Reliable closed-app/background sync is not claimed or required.

### Migrate from Last Time Tracker for iOS

Export a CSV from [Last Time Tracker for iOS](https://apps.apple.com/app/id534982023), then open **Settings → Data → Import CSV** in this app. In the original legacy format, `Event` identifies the item and a generic `Note` on a row with `Timestamp` or `Date`/`Time` is treated as that individual history record's note.

If you need to replace a previous malformed or duplicate import:

1. Close Last Time on every other device.
2. On one device, sign in and go online.
3. Open **Settings → Data → Clear all data**, complete both confirmations, and wait for the OneDrive deletion sync to succeed.
4. Import the CSV and sync again.
5. Reopen the other devices only after that sync completes.

This permanently removes existing item/history data but keeps settings and Microsoft sign-in. The app is local-first, has no application backend, and includes no analytics. OneDrive sync is optional.

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
npm run test:layout
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

On launch, foreground resume, and periodic checks while open, the installed PWA checks for a newer service worker. When one is waiting, the app shows a localized **New version available** banner. **Update now** asks the waiting worker to activate and reloads only after `controllerchange`; **Later** dismisses it for the current run, without interrupting an open editor or silently reloading. Activation is bounded: if iOS does not switch workers in time, progress clears and the banner offers a localized retry instead of remaining stuck.

## Import and export

Settings supports:

- Existing iOS CSV columns `Event`, `Note`, `Date`, `Time`, and `Timestamp`.
- Enriched portable columns `Event`, `Event Note`, `Icon`, `Color`, `Event Created`, `Occurrence`, and `Occurrence Note`.
- Common legacy aliases including `Name`/`title`, `createdAt`, `eventId`, `occurrenceId`, `occurredAt`, and occurrence timestamps.

Exports use the enriched portable format and preserve event notes, icon, color, event creation time, occurrence time, and occurrence notes. Future occurrence timestamps are ignored during import and blocked in the editor.

For legacy iOS rows containing an occurrence timestamp or `Date`/`Time`, a generic `Note` column is treated as the occurrence note. Event-level notes use explicit aliases such as `Event Note` or `eventNote`. Rows without an explicit `eventId` are grouped by trimmed event name, preventing one event from being duplicated merely because each occurrence has a different note.

If an older iOS CSV created duplicate same-name events, update to this version, open **Settings → Data → Clear all data**, complete both confirmation steps while signed in and online, wait for the successful OneDrive sync, then import the CSV again and sync before reopening other devices. Clearing keeps app settings and Microsoft sign-in, but permanently tombstones all event/history records locally and in OneDrive. Future occurrence timestamps are ignored during import and blocked in the editor.

## Sync behavior

Events and occurrences use stable UUIDs and ISO `updatedAt` values. Deletions are retained as tombstones. Merging is by UUID and chooses the latest update; equal timestamps prefer deletion, then use a canonical property-order-independent record comparison. The same occurrence UUID is never duplicated, while separate repeated occurrences remain separate records.

OneDrive uploads use the DriveItem ETag with `If-Match` (or `If-None-Match` when creating the file). A stale writer re-reads local and remote data, merges, and retries up to three times instead of overwriting a newer file. Local mutations and sync operations share a Web Lock where supported, with an in-process fallback, so a stale sync snapshot cannot overwrite a queued mutation. Conflict ordering still depends on device-generated wall-clock `updatedAt` values, so substantial clock skew can make an older real-world edit appear newer.

## Acknowledgements

Last Time is inspired by [Last Time Tracker for iOS](https://apps.apple.com/app/id534982023) (`上次 - 跟踪您的重要事项` in the Chinese App Store) by [Sarun Wongpatcharapakorn](https://sarunw.com/). Visit the original product's [official website](https://lasttimeapp.com/) or [App Store listing](https://apps.apple.com/app/id534982023). Thank you to its creator for the thoughtful, simple way to remember when things last happened.

If you only use iPhone and iPad and do not need cross-platform sync with Android, we encourage you to support and use the [original Last Time Tracker](https://apps.apple.com/app/id534982023).

This repository is an independent, unofficial implementation and is not endorsed by or affiliated with the original developer. It was created to bring this history-first workflow to an installable web app shared across iOS and Android devices and to add OneDrive sync—cross-platform and synchronization capabilities not provided by the referenced iOS app in this workflow. No source code or visual assets from that app are included.

## AI-assisted development

This project was developed with substantial assistance from [GitHub Copilot](https://github.com/features/copilot), primarily using the GPT-5.6 Sol model. AI assistance contributed to architecture, implementation, testing, documentation, and UI validation. Product direction and final acceptance remained human-directed. This project is not sponsored or endorsed by GitHub.

## License

The original code in this repository is available under the [MIT License](LICENSE), copyright © 2026 y-wan. Google Material Symbols remain available under their Apache-2.0 license. The acknowledgement of Last Time Tracker is nominative credit for product inspiration only and does not grant rights to that app's code, branding, or assets.

## Platform notes and licenses

- Daily reminders and app-lock features are intentionally excluded: Last Time is a historical record, not a task/habit app, and browser background scheduling is not treated as reliable.
- Event images are not yet supported because portable/offline binary storage and OneDrive merge semantics need a deliberate design; the PWA does not create device-only images that silently fail to sync.
- Icons are bundled, tree-shaken Google Material Symbols Rounded SVGs from `@material-symbols/svg-400`, licensed under Apache-2.0. No remote icon font is loaded, so icons remain available offline.
