# JobPilot Personal v1.5 — Unique interviews, not email counts

## Fix

Yahoo can send multiple recruitment messages about one appointment. The previous calendar could show each message as another interview. The updated calendar groups confirmations by an exact calendar UID or by matching company, role, and scheduled start time. A date-only message for an already scheduled slot is not counted as another appointment.

The system does **not** combine different start times, different companies, or clearly different roles. If messages have conflicting meeting links and no shared calendar UID, they are kept separate for review. A high-confidence reschedule with the same calendar UID updates the existing appointment.

- Future and same-day interview counts reflect unique appointments, not message count.
- Newly received repeat confirmations move to the Review history as **Related email — already counted** when their matching time is confirmed.
- Older duplicate imported events are hidden from scheduling and reminders, but remain in your local backup with their source IDs.
- On the calendar, tap **Keep separately** to restore a duplicate that was incorrectly grouped. Manual/user-edited events are never silently combined.
- Full Yahoo email review history remains accessible. Different interview times on the same day stay visible as distinct events.
- Your saved Yahoo key, application pipeline, notes, backups, and push-notification code remain unchanged; Cloudflare push setup is still optional and not activated.

## Verified

17 scanner/browser tests and 5 push-service regression tests passed, including duplicate email confirmations, distinct times/roles/companies, high-confidence reschedules, legacy duplicates, restore grouping, and the two-different-interviews-on-November-6 scenario.

## Limitations

No automatic system can reliably determine from every free-form email whether two different times represent a reschedule or two separate rounds. JobPilot prioritizes keeping different timed interviews visible and requiring review rather than guessing. If an email has no reliable date/time, review it before scheduling. The comparison is performed in your iPhone's local planner; no decrypted email is committed to GitHub.