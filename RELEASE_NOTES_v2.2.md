# JobPilot v2.2 — verified mobile layout and cache refresh

- Replaced the oversized first-interview hero with consistent compact cards.
- Both the interview title and time use explicit grid areas; no overlapping text.
- Bottom navigation has a fixed 72px height; content gets bottom padding.
- Assets have versioned URLs, and the service worker updates with network revalidation to reduce stale Home Screen appearances.
- The app reloads once when a new service worker takes control.
- No changes to the Yahoo parser, encrypted feed, appointments, localStorage schema, notification service, or secrets.

Verified in a headless Chromium mobile viewport at widths 320, 375, 390 and 430 px; no horizontal overflow or title/time overlap. Safari on the user's actual iPhone requires a follow-up visual confirmation.
