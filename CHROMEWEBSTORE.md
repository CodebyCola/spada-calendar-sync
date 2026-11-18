# Chrome Web Store Listing — SPADA UPNYK Assignment Scanner

> Last Updated: 2026-11-18

## Store Listing

**Extension Name**
SPADA UPNYK Assignment Scanner

**Short Description**
Scan all active SPADA UPNYK course assignments (including ones missing from Moodle calendar) and sync deadlines to Google Calendar.

**Detailed Description**
Never miss an assignment deadline on SPADA Wimaya UPN "Veteran" Yogyakarta again.

Many course assignments on SPADA UPNYK do not appear in Moodle's built-in calendar or upcoming timeline, causing students to miss deadlines unless they open every course page manually. SPADA UPNYK Assignment Scanner solves this by scanning all of your active semester courses whenever you are signed into SPADA and organizing every assignment in one clean popup.

Key Features:
Scans all active courses to detect every assignment, including hidden assignments absent from Moodle's calendar
Shows live submission status (Submitted vs. Pending) with a badge counter for pending tasks
Syncs assignment deadlines directly to your Google Calendar with Asia/Jakarta (WIB) time and H-1 day / H-3 hour reminders
Automatically marks completed assignments in your calendar and avoids creating duplicate events

How to Use:
1. Sign in to https://spada.upnyk.ac.id in your browser.
2. Click the extension icon and press "Scan SPADA" to view all pending assignments across your active courses.
3. Connect your Google account once to sync deadlines to Google Calendar automatically.

Privacy Note:
All course scanning happens locally in your browser using your existing SPADA session. Your SPADA login credentials are never read, stored, or sent to any third-party server. Data is only sent to Google Calendar when you connect your Google account.

**Category**
Productivity

**Single Purpose**
Scan active SPADA UPNYK courses for assignment deadlines and submission status, and sync them to Google Calendar.

**Primary Language**
Indonesian

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon | 128×128 PNG | ✅ Ready | `public/icons/icon-128.png` |
| Screenshot 1 | 1280×800 or 640×400 | ⬜ Not created | Popup assignment list over SPADA page |
| Screenshot 2 | 1280×800 or 640×400 | ⬜ Not created | Synced Google Calendar events |

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | Stores scanned assignment summaries, last scan timestamps, and user sync preferences (such as target calendar ID and past-due filters) locally in the browser so the popup loads instantly. |
| `alarms` | permissions | Schedules periodic background assignment scans every 3 hours while the browser is running so new deadlines are detected automatically. |
| `identity` | permissions | Obtains an OAuth 2.0 access token via Google sign-in so the user can authorize adding and updating assignment events on their personal Google Calendar. |
| `https://spada.upnyk.ac.id/*` | host_permissions | Reads the logged-in user's active course list and assignment index pages (`/mod/assign/index.php`) on SPADA UPNYK to extract assignment titles, due dates, and submission statuses. |
| `https://www.googleapis.com/*` | host_permissions | Calls the Google Calendar REST API v3 to list, create, and update synced assignment events on the user's selected Google Calendar. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes (only website content from the user's active SPADA courses and Google Calendar event metadata stored directly in the user's browser and Google Calendar; no developer backend server exists).

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|---|---|---|---|---|
| Personally identifiable info | No | No | - | No |
| Health info | No | No | - | No |
| Financial info | No | No | - | No |
| Authentication info | Google OAuth token via `chrome.identity` | Only to `googleapis.com` | Google Calendar sync | No |
| Personal communications | No | No | - | No |
| Location | No | No | - | No |
| Web history | No | No | - | No |
| User activity | No | No | - | No |
| Website content | Assignment titles, due dates, submission status from `spada.upnyk.ac.id` | Only to user's own Google Calendar (`googleapis.com`) | Display pending tasks and create calendar reminders | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used or transferred for purposes unrelated to the item's single purpose
- [x] Data is NOT used or transferred to determine creditworthiness or for lending purposes
