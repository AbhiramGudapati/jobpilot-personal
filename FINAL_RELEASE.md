# JobPilot Personal v1.0 — Free website release

**This is the publishable website and background automation source, not a live deployment.** It works as a standalone, offline-capable personal planner once served over HTTPS. Yahoo sync and iPhone push require the account owner to connect and authorize their own services. There is no paid AI model, calendar subscription, App Store account, or Vercel subscription.

## Ready in the website

- iPhone Home Screen installable PWA, responsive dark/light themes, offline app shell
- Dashboard with active applications, upcoming interviews, action items, suggestion count, next meeting, and application pipeline
- Built-in monthly calendar, day agenda, event editing and deletion, duration and overlap warnings
- Applications with role, company, recruiter, status, stage-change history, priority, application date, source, notes, job posting URL
- One-tap follow-up scheduler, task complete/reopen and move-to-tomorrow actions
- Export all scheduled entries as `.ics`, export applications as CSV, JSON backup/restore
- Online/offline indicator; iPhone Add-to-Home-Screen guide; stale Yahoo scan warning
- Yahoo read-only IMAP scanner with encrypted feed and human approval for uncertain changes, clear ICS invitations imported automatically
- Cloudflare Worker source for real encrypted Web Push with 24h/1h/15m reminders, device subscription, test and revoke controls
- Local stage edits saved on the phone; Yahoo credentials are not sent to the web browser

## What still requires account setup

- Create `jobpilot-personal` **public GitHub repo**, upload these files and enable GitHub Pages using the GitHub Actions deployment source.
- To enable Yahoo, generate a Yahoo app password (if your account permits it), then add `YAHOO_EMAIL`, `YAHOO_APP_PASSWORD`, and `JOBPILOT_SYNC_KEY` **as GitHub Actions secrets**. Do not commit them or paste them into chat.
- For Lock Screen push, deploy the included Cloudflare Worker and D1 database to your own free Cloudflare account, supply VAPID keys/API token, then subscribe from the installed iPhone Home Screen site. See `push-api/SETUP.md`.
- Live Yahoo and live iPhone notification delivery are **not verified** until connected to those accounts and tested on the device.

## Reliability and privacy boundaries

- Scheduled email checks and push delivery are best effort, **not exact-time alarms**. Keep regular Yahoo or phone alerts for critical interviews.
- Manual records live in the current browser's unencrypted local storage; they do **not** automatically sync between devices. Export a private JSON backup to change devices.
- CSV/ICS exports contain personal information; store privately. The JSON backup is not encrypted.
- The public GitHub Pages deployment contains source code and encrypted Yahoo feed data only; the sync key remains in private secrets/device storage.
- Cloudflare free quotas and Yahoo's IMAP/app-password availability can change. No automatic paid upgrades are required by this code.

## Verification completed

- Yahoo Python tests: 8 passed.
- Cloudflare Worker tests: 5 passed, including cryptographic payload, authentication and CORS origin tests.
- Mobile Chromium DOM smoke test: application add/update, high-priority filter, stage history, follow-up event creation, calendar editing, CSV/ICS downloads, and no uncaught JavaScript errors.
- Actual Yahoo login, GitHub Pages deploy, iPhone Lock Screen delivery, and Cloudflare account quota usage still require real connected services.

Read `START_HERE.txt` for the shortest setup path and `README.md` for detail.