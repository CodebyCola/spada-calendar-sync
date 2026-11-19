# Chrome Web Store Listing — SPADA UPNYK Assignment Scanner

> Last Updated: 2026-11-19

## Store Listing

**Extension Name** [REQUIRED — matches `manifest.json` `"name"`]
SPADA UPNYK Assignment Scanner

**Short Description** [REQUIRED — 113/132 chars, matches `manifest.json` `"description"`]
Pindai semua tugas SPADA Wimaya UPNYK (termasuk yang tidak masuk kalender Moodle) dan sinkronkan ke Google Calendar.

**Detailed Description** [REQUIRED — plain text ready to paste into Chrome Developer Dashboard]
```text
Never miss an assignment deadline on SPADA Wimaya UPN "Veteran" Yogyakarta (unofficial student helper tool).

Many course assignments on SPADA UPNYK do not appear in Moodle's built-in calendar or upcoming timeline, causing students to miss deadlines unless they open every course page manually. SPADA UPNYK Assignment Scanner solves this by scanning all of your active courses while you are signed into SPADA and organizing every assignment in one clean list.

FEATURES
• Complete Assignment Detection — Scans all active courses to catch assignments that are missing from Moodle's built-in calendar.
• Submission Status Tracking — Clearly separates pending tasks from submitted assignments and displays a pending task counter on the toolbar icon.
• Google Calendar Sync — Sends assignment deadlines to your Google Calendar in Asia/Jakarta (WIB) time with H-1 day and H-3 hour popup reminders.
• Duplicate Prevention — Automatically updates existing calendar events when you submit an assignment (marking it as completed) without creating duplicates.
• Guided First-Run Setup — Opens a 3-step onboarding checklist on fresh install with clear error diagnostics so students can verify SPADA sign-in and connect Google Calendar in under a minute.
• Automatic Periodic Refresh — Checks for new assignments while you browse SPADA or on a 3-hour schedule while Chrome is open.

HOW TO USE
1. After installing, follow the 3-step Setup Guide that opens automatically (or open it anytime from the extension popup/Options).
2. Sign in to https://spada.upnyk.ac.id in Chrome and verify your SPADA session.
3. Click "Hubungkan Google" and "Scan & Sync Pertama" to add deadlines to your Google Calendar automatically.

PRIVACY
All scanning runs locally in your browser using your existing SPADA session. Your SPADA username and password are never accessed, stored, or sent to any server. You can clear all local extension data anytime from the Options page.

PERMISSIONS
• "Read and change your data on spada.upnyk.ac.id" — Needed to read your active course list and assignment index pages on SPADA UPNYK.
• "googleapis.com" — Needed to create and update assignment events on your Google Calendar when you connect your Google account.
• "storage" & "alarms" — Needed to save your sync settings, display cached tasks immediately, and schedule periodic scans.
• "identity" — Needed to sign in with Google and authorize Google Calendar access.

SUPPORT
Questions, bug reports, or suggestions: <YOUR_CONTACT_EMAIL> or https://github.com/CodebyCola/spada-calendar-sync

Version 1.0.0 — Initial release with active-course assignment scanning, submission status tracking, and Google Calendar sync.
```

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Scan active SPADA UPNYK course pages for assignment deadlines and submission status, and sync them to Google Calendar.

**Primary Language** [REQUIRED]
Indonesian

**Privacy Policy URL** [REQUIRED before submission]
Host `docs/privacy.html` (or `PRIVACY.md`) publicly via GitHub Pages (e.g., `https://<username>.github.io/<repo>/privacy.html`) after replacing `<YOUR_CONTACT_EMAIL>`, then paste that live URL into the Chrome Developer Dashboard.

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `public/icons/icon-128.png` |
| Small Promo Tile [RECOMMENDED] | 440×280 PNG | ✅ Ready | `store-assets/promo-small-440x280.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Capture after Load Unpacked | Popup showing scanned SPADA assignments over `spada.upnyk.ac.id` |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Capture after sync | Synced assignment events inside Google Calendar |

---

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | Stores scanned assignment summaries, last scan timestamps, and user sync preferences (target calendar ID and past-due filter settings) locally in the browser so the popup opens instantaneously. |
| `alarms` | permissions | Schedules periodic assignment checks every 3 hours while the browser is running so new or updated assignment deadlines are caught automatically. |
| `identity` | permissions | Requests a Google OAuth 2.0 access token via Chrome sign-in so the user can authorize creating and updating assignment events on their personal Google Calendar. |
| `https://spada.upnyk.ac.id/*` | host_permissions | Reads the signed-in user's active course links and `/mod/assign/index.php` assignment tables on SPADA UPNYK to extract assignment titles, deadlines, and submission statuses. |
| `https://www.googleapis.com/*` | host_permissions | Calls the Google Calendar REST API v3 directly from the user's browser to list, create, and update synced assignment events on the user's selected calendar. |

---

## Privacy & Data Use (CWS Dashboard Disclosure)

**Does the extension collect user data?** Yes (processes website content from `spada.upnyk.ac.id` locally and transmits synced assignment metadata directly to the user's Google Calendar via `googleapis.com`; no developer-owned backend server exists).

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|---|---|---|---|---|
| Personally identifiable info | No | No | - | No |
| Health info | No | No | - | No |
| Financial info | No | No | - | No |
| Authentication info | Google OAuth token (`identity`) | Only to `googleapis.com` | Authorize Google Calendar event sync | No |
| Personal communications | No | No | - | No |
| Location | No | No | - | No |
| Web history | No | No | - | No |
| User activity | No | No | - | No |
| Website content | Assignment titles, due dates, links, submission statuses from `spada.upnyk.ac.id` | Only to user's own Google Calendar (`googleapis.com`) | Display pending assignments and create calendar reminders | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used or transferred for purposes unrelated to the item's single purpose
- [x] Data is NOT used or transferred to determine creditworthiness or for lending purposes

---

## Pre-Publish Submission Checklist

1. Replace `<YOUR_CONTACT_EMAIL>` in `PRIVACY.md`, `docs/privacy.html`, and `CHROMEWEBSTORE.md`, then publish `docs/privacy.html` (e.g. via GitHub Pages).
2. Capture at least 1 real `1280×800` screenshot of the extension popup over SPADA in Chrome.
3. Update `public/manifest.json` `oauth2.client_id` with your dedicated **Chrome Web Store Item ID** OAuth Client ID (do NOT reuse the local unpacked Client ID from `config/unpacked-oauth.json`, and ensure no `"key"` field is in `manifest.json`).
4. Run `npm test && npm run typecheck && npm run package:strict` to produce `release/spada-calendar-extension-v1.0.0.zip`.
5. Upload `release/spada-calendar-extension-v1.0.0.zip` in the Chrome Developer Dashboard; install the Store build (unlisted/testing) and **verify Google Sign-in ("Hubungkan Google") succeeds from the Store installation** before publishing to Production (and publish your Google Cloud OAuth Consent Screen to **Production** so all UPNYK students can sign in).
