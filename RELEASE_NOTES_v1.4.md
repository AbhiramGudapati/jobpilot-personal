# JobPilot Personal v1.4 — Fewer missed interviews, clearer Yahoo refresh

This update keeps the v1.3 two-interview calendar fix and adds:

- One-tap **Add interview** on Calendar and **Missing one?** on Home. Requires the actual date and time before saving; never fabricates an interview time.
- **Go to next interview** on Calendar, jumping to the next upcoming saved or pending dated interview.
- Every detected interview in Yahoo Review (even when the date could not be extracted) now offers **Set interview time** so it can be saved with the correct time.
- **Load latest** is explicitly described as loading the last encrypted scan result; it does not trigger Yahoo live. A link to GitHub Actions starts a fresh mailbox scan when needed.
- Shows the last **background Yahoo scan time** separately from the website refresh. Better guidance when scans are delayed.
- Updated offline cache version so the Home Screen site picks up new code.

No paid services, external calendar, key rotation, or Cloudflare push deployment. Existing local applications, events, review history, and saved key remain unchanged.
