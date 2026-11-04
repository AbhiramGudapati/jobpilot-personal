# JobPilot Personal v1.2 — Consolidated release

The v1.2 release preserves existing local application data and Yahoo/GitHub credentials.

## Included and verified

- Mobile Home Screen PWA, dark/light mode and offline shell.
- Local calendar, upcoming interviews, follow-ups, durations, conflict warnings and ICS export.
- Job stages, priorities, recruiter details, search/filters, stage history, CSV export and JSON backup/restore.
- Yahoo encrypted scanning and review queue; automatic high-confidence calendar invitation import, uncertain changes requiring approval, and duplicate prevention.
- One-time saved Yahoo encryption key on a trusted device, retained between launches, with explicit Forget this device and automatic check on open.
- Push notification client and server code. The Cloudflare Worker must be deployed separately, and iPhone permission must be granted.
- Standard GitHub Pages and Yahoo scheduled/manual deployment workflows. No new encryption key is needed to update the website.

## Privacy and limitations

- The source repo and encrypted Yahoo feed are public; keep the decryption key secret.
- Calendar/application records are stored in browser storage on the device. Make a private backup before switching phones or clearing browser data.
- Closed-app push is NOT activated by GitHub Pages deployment alone.
- Email scans and push delivery are best effort, not exact-time guarantees.

## Verification

- 8 scanner tests passed.
- 5 push-service tests passed.
- Mobile browser test for application tracking, stage history, calendar event editing, CSV and ICS export passed without script errors.
- One-time key persistence, encrypted inbox import, legacy-session migration, and Forget this device browser test passed.
