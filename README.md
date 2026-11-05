# JobPilot Personal — a genuinely free, self-hosted interview planner

**Status:** Working static PWA and tested Yahoo-to-encrypted-feed integration. The Yahoo integration can only begin running after the account owner completes the GitHub/Yahoo secrets setup. Do **not** consider background notifications guaranteed.

No Vercel, external calendar, paid AI API, custom domain, or App Store publishing required. Optional closed-app push uses a separate Cloudflare Workers Free + D1 deployment. The website uses GitHub Pages (free for a **public** repository), and GitHub Actions runs scheduled mail scans (standard runners in public repositories are free, subject to platform limits and acceptable-use policy). Source code is public; sensitive Yahoo feed payloads are **AES-256-GCM encrypted**, and the encryption key and Yahoo app password must be kept in GitHub Actions secrets. Manual planner records are kept on the device.

## v1.0 final polish

This release adds application **priority, source, application date and stage-change history**, one-tap follow-up scheduling, **event duration and conflict warnings**, completed task reopening and one-day snooze, calendar `.ics` export, application CSV export, connection status, Home Screen install guide, and stale Yahoo scan warnings. It fixes date/time editing of existing events and enables the Cloudflare API in the website's Content Security Policy. Check `FINAL_RELEASE.md` for tested features and remaining account-setup steps.

## What works

- Installable iPhone website (Safari > Share > Add to Home Screen), responsive desktop interface, dark and light themes, offline UI shell.
- Personal calendar with month grid, time zones displayed in your device's local time, events and meeting links.
- Application pipeline: add/edit/delete applications, change stages, search and filter, recruiter details, and notes.
- Interview tracking, follow-ups, deadlines, upcoming schedule and task completion.
- Device-local JSON backup and restore.
- Yahoo IMAP scanner via GitHub Actions: parses recent recruitment messages, calendar invites (.ics), interview details, meeting URLs, offers, rejections, and application acknowledgements.
- Encrypted publishing: Yahoo mailbox is accessed **only by the GitHub Actions worker**. Feed JSON is encrypted with a **random 256-bit secret** before being deployed to GitHub Pages. No mail data or ciphertext is committed to your source repository. It is decrypted in the browser using WebCrypto after you unlock the app with the matching secret.
- Automatic import for **future, high-confidence interview calendar attachments**. Other inferred updates wait in the approval queue. Repeated message IDs are deduplicated; ICS reschedules with matching UID can update unedited events.
- In-app alerts while open; optional **true closed-app iPhone push** through Cloudflare Worker and D1 after setup (with best-effort timing).
- Sample message button for safe testing without a Yahoo connection.

## Set up on GitHub: 4 practical steps

1. Visit **https://github.com/new** and create a **PUBLIC** repository called `jobpilot-personal`. On GitHub Free, Pages for a private repository is not included. Do not publish your personal backups or any decrypted Yahoo messages.
2. Upload the **contents inside this folder** into the repository root (not a nested folder): `index.html`, `style.css`, `app.js`, `push-client.js`, `sw.js`, `icon.svg`, `apple-touch-icon.png`, `manifest.webmanifest`, `worker/`, and `.github/workflows/`.
   - GitHub's browser uploader may be easier on a computer because the hidden `.github` directory must also be included. With the GitHub connector connected to ChatGPT, the code files can also be uploaded after you have created the empty repo. The website and **both** workflows must be in the same repository.
3. Under **Settings > Pages**, select **GitHub Actions** as the Build and deployment source. A workflow named **Publish JobPilot website** deploys the static site from `main` automatically. If needed, run it once from Actions > Publish JobPilot website > Run workflow. Your URL should then be `https://YOURUSERNAME.github.io/jobpilot-personal/`. Wait for GitHub to finish publishing.
4. For a new account only: open **Settings > Advanced Yahoo settings > Generate a new key**, copy it and save it privately, then update `JOBPILOT_SYNC_KEY` in GitHub. **If Yahoo was already connected, do not generate a new key.** Instead paste the existing key once under **Settings > Yahoo connection > Save on this iPhone**.

### Connect Yahoo securely

1. Sign in to **https://login.yahoo.com/account/security** and look for **External connections > Create app password**. Generate a **new app-specific password** for JobPilot. Yahoo controls eligibility and may not offer app passwords for every account. Never use your normal Yahoo login password as a substitute.
2. In your GitHub repository, open **Settings > Secrets and variables > Actions > New repository secret**. Create precisely these 3 repository secrets:

   | Secret name | Secret value |
   |---|---|
   | `YAHOO_EMAIL` | Your full Yahoo email address |
   | `YAHOO_APP_PASSWORD` | The Yahoo-generated **app password** |
   | `JOBPILOT_SYNC_KEY` | The exact **64-hex-character key** from the website |

3. You do **not** need to grant the workflow write access to your repository. The scanner deploys encrypted feed directly to GitHub Pages using the normal Pages deployment permissions.
4. Go to **Actions > Scan Yahoo and publish encrypted JobPilot feed > Run workflow**. If it completes successfully, it **deploys the updated encrypted feed to the live site** without committing it to your source repository. It contains ciphertext, not readable Yahoo mail.
5. Return to the website, use **Yahoo Inbox > Check now**, and approve suggested changes. It automatically checks a new feed when opened if you have already unlocked it. The GitHub Actions workflow is scheduled approximately every 30 minutes (11 and 41 minutes past the hour), but GitHub may delay, suspend, or drop scheduled runs.

**No credentials are ever required in this chat.** Do not send me your passwords or sync key.

## Use without Yahoo

The site works immediately for **manual** applications, interview dates, calendar notes, schedule, follow-ups, and backup. In **Yahoo Review**, tap **Try sample email** to test approval handling. The sample is clearly labeled. If Yahoo blocks app-password access, you can continue with all manual planning features; automatic Yahoo monitoring cannot run until Yahoo provides working supported access.

## Offline & privacy

- The website can load its cached interface offline after its initial HTTPS install. Changes to manually managed records work offline; Yahoo scanning and feed synchronization require a connection.
- **The Pages repository must be public on GitHub Free**, but no readable Yahoo data, private recruiter information, or local notes should ever be committed there. The deployed `feed.json` is encrypted; its size and update timing remain visible. Someone with your sync key can decrypt any copies of the encrypted feed they have saved.
- The website saves approved events, job records, and the email review list to browser `localStorage`, **unencrypted**. Anyone with access to your unlocked phone/browser profile might view it. Export a JSON backup before clearing website data or switching devices. The backup itself is not encrypted.
- The 64-hex-character sync key is stored on this trusted device in browser **localStorage** when you tap **Save on this iPhone**, and is not included in JSON backups. This avoids repeated prompts, but someone with access to this browser profile can use it. Select **Advanced Yahoo settings → Forget this device** to clear the saved key. Revoking a leaked key requires replacing the GitHub secret and republishing the feed; older downloaded ciphertext encrypted with that key remains vulnerable.
- The workflow uses read-only IMAP mailbox access (`select(..., readonly=True)` and `BODY.PEEK[]`); it doesn't delete, label, or send emails.
- Optional closed-app push **is implemented** under `push-api/`, but must be deployed to a Cloudflare Workers Free account, linked in Settings, and subscribed on iPhone. The backend sends encrypted generic reminders, not email contents. Delivery can be delayed by connectivity, notification settings, and service limits; for critical interviews also keep Yahoo email notifications enabled.
- This is a personal single-device planner, not a multi-user SaaS service. Manual edits aren't synchronized between different phones or browsers. Use backup/export to move between devices.
- Extracting dates, time zones, companies, and stages from free-form emails is imperfect. Review uncertain suggestions, especially rescheduled or cancelled interviews. Your email remains the source of truth.

## Architecture

```text
GitHub Pages (public code and deployed ciphertext only)
  index.html + app.js + push-client.js + style.css + sw.js
    └─ device-local applications, events, review statuses
    └─ decrypts feed.json with key stored only on user's phone

GitHub Actions (scheduled server-side scanner)
  Secrets: Yahoo email + app password + random 256-bit sync key
    └─ IMAP read-only mailbox access
    └─ extract recruitment metadata / ICS invites
    └─ AES-256-GCM encrypt → deploy temporary feed.json ciphertext directly to Pages
    └─ optionally PUT anonymous verified ICS reminder times to Cloudflare

Cloudflare Workers Free + D1 (optional)
  HTTPS API authenticated by a 32+ character token
    └─ save each device's Web Push subscription
    └─ save anonymous UTC reminder schedules
    └─ every-minute Cron: encrypted VAPID Web Push to iPhone Home Screen
```

## Development & tests

```bash
python -m pip install -r worker/requirements.txt pytest
python -m pytest worker/test_yahoo_scan.py -q
python -m http.server 8080
```

Visit `http://localhost:8080`. On an iPhone, use your GitHub Pages **HTTPS** URL instead. The browser UI uses no npm packages, no paid APIs, no third-party CSS, and no external fonts.

**Current constraints:** Requires your own GitHub repo, Yahoo account and Yahoo app-password eligibility; the live Yahoo link cannot be tested without authorized credentials. Google/Apple Calendar integration is deliberately **not** used. Closed-app push requires the separate Cloudflare setup and live device subscription. Scheduled Actions are best-effort, so never assume instant or guaranteed alerts.

## Update: real iPhone push notifications (optional free Cloudflare service)

**New in this build:** `push-client.js`, the service worker push handler, and `push-api/` implement real encrypted Web Push, scheduled from a free Cloudflare Worker + D1 database. Push can reach the Home Screen web app while closed. It schedules generic 24-hour, 1-hour, and 15-minute reminders, and has a Send test button in Settings.

See **`push-api/SETUP.md`** for exact zero-cost setup commands, security notes, and iPhone steps. A Cloudflare Workers Free account is required and you must deploy the Worker. GitHub Pages by itself cannot send closed-app push notifications. If Yahoo scanning is enabled, adding `JOBPILOT_PUSH_URL` and `JOBPILOT_PUSH_TOKEN` GitHub Actions secrets makes it schedule push reminders for high-confidence ICS invites even before you reopen the site. Do not post private keys or tokens here or in GitHub source files.

The old in-app alert toggle remains available for use while the website is open. Use **Settings → Cloud push notifications** to enable true background alerts. Notification receipt depends on Apple's permission, Focus, network availability and service limits; no free service guarantees delivery to the exact second.


## v1.1: one-time Yahoo key setup on your private iPhone

The Home Screen web app now remembers your **existing** 64-character Yahoo encryption key automatically when you tap **Save on this iPhone**, and migrates previous session-only unlocks where the session is still available. It syncs on opening and when you return after 10+ minutes. Settings shows a simple Yahoo-connected status instead of a password field. **Advanced Yahoo settings** contains options to replace, generate or forget the key. Do not regenerate if your existing GitHub scanner works.

**Privacy trade-off:** To avoid asking repeatedly, this version saves the key in that device's browser localStorage. Other scripts running under the same website origin and someone with access to its browser profile could use it. Use only on a private device, keep iPhone passcode protection on, and select **Forget this device** if necessary. It is not uploaded to GitHub or included in backups. Clearing website data, using another device, or certain Safari storage-reset conditions may still require one new unlock.

## Current release: v1.3 — Calendar coverage and minimal mobile UI

The built-in calendar now shows multiple appointments per date and highlights Yahoo interview suggestions that have not yet been confirmed. Review tentative entries in **Calendar** or **Review** before they become saved appointments. Date-only suggestions never invent a start time. The Yahoo scanner also handles numeric dates and searches relevant older interview subjects and the Archive folder when available.

Mobile navigation is now **Home, Calendar, Jobs, Review**, with **Settings** in the header gear. Your previously saved Yahoo encryption key, applications, and calendar events carry forward without reconfiguration. The separate Cloudflare push service is not activated by this website update. See `RELEASE_NOTES_v1.3.md` for details and limitations.
