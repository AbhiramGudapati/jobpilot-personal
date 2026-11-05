# JobPilot Personal v1.3 — Complete interview calendar + simpler interface

## What changed

- **Show every interview separately on the same calendar day.** Calendar tiles display the number of interviews rather than only a single title. The selected date lists all appointments in time order.
- **See unconfirmed interview invitations before approving them.** High-confidence calendar invitations remain automatically imported; date/time extracted from a regular email appears on the calendar as *Needs confirmation*. Date-only invitations appear as *Time to confirm*, never an invented 9 AM appointment.
- **Review from the calendar.** Tap a tentative interview to jump to its Yahoo message, confirm its time or save it as an event. An edited suggestion is marked reviewed automatically, without creating an extra duplicate.
- **Cleaner Home screen.** Upcoming interviews are displayed as separate rows with times and status; other tasks and action items have their own small sections.
- **Simpler mobile navigation.** Home, Calendar, Jobs, Review. Settings is available from the gear icon.
- **Broader Yahoo scanner coverage.** Search interview-specific subjects back further and include Archive when available. Recognize numeric dates (such as `11/06/2026 10:30 AM CT`) and date-only invitations. Prior pending messages receive improved date extraction after the next scan, without undoing previous approvals.
- **Preserves existing data.** Uses the existing v2 local database format and same private key. No resets or Yahoo credential changes.

## What to do on iPhone

1. Open the existing Home Screen JobPilot icon and close/reopen once to load v1.3.
2. Go to **Review** and tap **Check now** after the new Yahoo workflow completes.
3. Select **Calendar → November 6**. Two separate interview invitations will appear if they are in the encrypted feed and their dates are recognized. A yellow **Needs confirmation** item must be reviewed before it becomes a saved event.
4. If an invitation is still missing, use the **+ Add event** button and enter the confirmed time. This avoids missing an appointment while checking the original email.

## Constraints

- The calendar cannot prove every Yahoo email has been imported. The scanner uses subject/date heuristics and a bounded mailbox search, so forwarded messages, unusual formats, or messages in other custom folders can still be missed.
- Text-only invitations are **not silently treated as confirmed** or eligible for automatic reminders until reviewed.
- Application/calendar data remains stored on your device. Keep a private backup before clearing browser data or switching phones.
- Closed-app push notifications still require separate Cloudflare setup; no push settings or credentials were changed in this release.

## Tests

- Parser regression tests: text-date parsing, older interview detection, archive folder fallback, and AES encryption.
- Browser regression: two separate November 6 interviews, review-to-calendar, no duplicates after repeated sync, date-only preview requiring time input, local persistence.
- Existing local browser smoke: jobs, stage changes, follow-ups, event editing, ICS/CSV exports.
- Key persistence and Forget this device browser checks.
- Existing push implementation remains unchanged.
