# JobPilot Personal — FREE real iPhone push notifications

This adds true Web Push (iOS 16.4+ Home Screen PWA): notifications can appear on your Lock Screen **while JobPilot is closed**. No Apple Developer Program, paid push provider, API subscription, or external AI service is needed. You still must create your own free Cloudflare account and deploy the backend. Delivery timing is *best effort*, not an alarm-clock guarantee. Apple Focus, notification settings, network availability, free-tier quotas and server outages can delay/block delivery.

## 1. Publish JobPilot to GitHub Pages

Use the main README to create a public `jobpilot-personal` repository and deploy the static site. The site must load on HTTPS. If using `AbhiramGudapati.github.io`, the origin is `https://abhiramgudapati.github.io`, even if the URL has `/jobpilot-personal/` after it. The Worker CORS configuration has been prefilled for this origin; change it if you use another username or custom domain.

## 2. Create your free Cloudflare account

Visit https://dash.cloudflare.com/ and choose **Workers Free**. A credit card is not required for ordinary Workers Free usage in most eligible regions, but requirements can vary. Never choose a paid upgrade for this project. Workers Free and D1 Free have usage quotas; after hitting them, requests may fail rather than continuing indefinitely.

You can use a Windows computer terminal with Node.js or GitHub Codespaces in your browser (subject to free Codespaces allowances) to run the following.

## 3. Initialize the Worker

From the repository root:

```bash
cd push-api
npm install
npx wrangler login
npx wrangler d1 create jobpilot-push
```

The last command prints a UUID for `database_id`. Open `push-api/wrangler.toml` and replace:

```
database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

with the UUID from Cloudflare. Confirm the `ALLOWED_ORIGIN` setting matches the **origin** of your JobPilot site (no pathname). Then create the tables:

```bash
npx wrangler d1 execute jobpilot-push --remote --file schema.sql
```

## 4. Generate and store your private push keys

Run once:

```bash
npm run keys
```

The output contains 3 long secret values plus a VAPID subject placeholder. Set all four with these commands (each prompts you to paste the correct value):

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put PUSH_API_TOKEN
npx wrangler secret put VAPID_SUBJECT
```

For VAPID_SUBJECT enter `mailto:YOUR-EMAIL@example.com` using an actual address you control. This is **not** the Yahoo login password; it simply identifies the push sender to push services.

**Keep `VAPID_PRIVATE_KEY` and `PUSH_API_TOKEN` private.** Never put them in a public repository, screenshot, or chat. Preserve these values securely. Rotating VAPID keys requires re-subscribing devices.

## 5. Deploy

```bash
npx wrangler deploy
```

Cloudflare returns a URL similar to `https://jobpilot-personal-push.ACCOUNT.workers.dev`.

Open `https://jobpilot-personal-push.ACCOUNT.workers.dev/health` in a browser. It should return `{"ok":true,"service":"JobPilot reminders"}`. Opening `/config` should return `configured:true` and the public VAPID key. This is only an API, not a replacement for your website.

## 6. Enable on your iPhone

1. In **Safari**, open the published JobPilot Pages website. Tap **Share → Add to Home Screen**.
2. Launch the **JobPilot Home Screen icon** (not a normal Safari tab).
3. Go to **Settings → Cloud push notifications**.
4. Paste your Cloudflare Worker HTTPS URL and `PUSH_API_TOKEN` from step 4. Never enter `VAPID_PRIVATE_KEY` here.
5. Tap **Enable push on this device**, then tap **Allow** when iOS asks.
6. Tap **Send test**. The test should appear on the Lock Screen / Notification Center (the Worker accepts one test per 30 seconds). Lock the phone to confirm delivery.
7. Enter a sample interview within the next 1–2 days and tap **Sync reminders** to send its generic schedule timestamps to the Worker.

The app automatically syncs reminders after you add, edit or delete calendar events and on reopening the website. The server stores only anonymous event IDs, event types and UTC timestamps (plus the browser push subscription). It does not store company names, meeting URLs, recruiter email bodies or notes.

## 7. Connect Yahoo scanner for fully background-scheduled interview reminders

Once the GitHub Yahoo scanner is enabled, add **two optional repository Actions secrets**:

- `JOBPILOT_PUSH_URL`: same Worker HTTPS URL.
- `JOBPILOT_PUSH_TOKEN`: same `PUSH_API_TOKEN` used with Cloudflare.

The Yahoo scanner now uploads generic 24h/1h/15min schedules for **high-confidence ICS/calendar interview invitations only**. This works even if you never reopen JobPilot, after you've subscribed your iPhone. Cancellation/rescheduling of a matching calendar UID updates the server after the next successful scan.

Free GitHub scheduled workflows are best effort and may be delayed; text-only dates (medium confidence) are intentionally **not** automatically pushed until reviewed in JobPilot. If there is no valid Yahoo app-password/IMAP access, Yahoo tracking cannot operate.

## Important limits

- iPhone: requires iOS 16.4+ and Add to Home Screen, user permission, HTTPS, active subscription.
- Cloudflare Cron runs every minute but can have occasional delays. Push delivery is not guaranteed to the exact second.
- Background push cannot work before the Worker URL/token have been configured and the phone subscribes.
- Your calendar entries currently live in browser local storage; use JobPilot backup/restore when changing phones.
- Notification sounds depend on iOS notification settings; custom audio cannot reliably be forced by a PWA in the background.
- The backend is a single-user personal system; treat the API token as your password. Never commit it to GitHub.

## Local tests

```bash
cd push-api
npm test
python -m pytest -q ../worker/test_yahoo_scan.py
```

These tests validate cryptographic encoding, JWT signing, endpoint validation, authentication checks and Yahoo parsing. They do not substitute for live deployment and a test push to your iPhone.