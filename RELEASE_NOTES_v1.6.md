# JobPilot v1.6 — accurate interview counts and email dates

The November 6 email example “Friday, Nov. 6 at 2 p.m.” was previously ignored by the date parser. The new scanner recognizes it and extracts 2 PM America/Chicago with the ERP Workstream Analyst role. Employer organization is inferred from a known organizational email domain, never from a person's display name. Calendar imports from explicit text confirmations show a verify-time-zone note; uncertain messages are review-only.

The calendar now counts only saved appointments. Pending email suggestions appear as **Possible, not counted** and are kept separate from scheduled events. SMG and Scotts Miracle-Gro are treated as employer aliases for matching, while different roles remain distinct for review.

Existing pending email records can be improved by new scanner output without duplicate appointments. The Yahoo encryption key and manually saved data are not reset. Push setup is unchanged.

Verified locally against 20 scanner + browser regression tests including a three-email November 6 case. This is not live-mailbox access; the real account is tested only when GitHub's Yahoo scanner runs successfully and JobPilot loads its new encrypted feed.
