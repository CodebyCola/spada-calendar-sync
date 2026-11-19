# SPADA UPNYK Assignment Scanner

Language: **English** | [Bahasa Indonesia](README.id.md)  
Setup and Execution Guide: [HOW_TO_RUN.md](HOW_TO_RUN.md) | [HOW_TO_RUN.id.md](HOW_TO_RUN.id.md)

A Manifest V3 Google Chrome extension that scans assignments across all active courses on **SPADA Wimaya UPN "Veteran" Yogyakarta** (`spada.upnyk.ac.id`) — including assignments omitted from Moodle's built-in calendar and `.ics` feed — tracks submission status, and synchronizes deadlines to the user's personal Google Calendar.

The extension shares event metadata compatibility with the companion CLI tool `spada_calendar_sync`, allowing both tools to run without creating duplicate calendar entries.

---

## Core Capabilities

- **Full Course Assignment Scanning:** Fetches active courses and parses each course's `/mod/assign/index.php` table, including empty start-of-semester dashboards without false authentication errors.
- **Submission Status Tracking:** Separates pending and submitted assignments and displays the pending count on the toolbar badge.
- **Guided First-Run Onboarding:** Opens a three-step setup checklist automatically on initial installation to verify SPADA authentication, connect Google Calendar, and run the first synchronization.
- **Service-Aware Error Diagnostics:** Classifies SPADA session errors, SPADA HTTP 403 access errors, Google Calendar rate limits, OAuth consent issues, and unsupported browsers into actionable remediation steps.
- **Idempotent Google Calendar Sync:** Writes deadlines in `Asia/Jakarta` (WIB) with 24-hour and 3-hour popup reminders, updating existing events automatically upon submission.
- **Local-Only Architecture:** Executes entirely within the browser using the user's existing SPADA session. No backend server is used, no SPADA credentials are collected, and no manual refresh token configuration is required.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Extension Platform | Chrome Extensions Manifest V3 (Service Worker, Content Script, Popup, Options, Onboarding) |
| Language | TypeScript 5.6 (`strict`, ESM) |
| User Interface | Vanilla HTML5, CSS3, standard DOM APIs (zero runtime UI dependencies) |
| Bundler & Scripts | esbuild 0.24, Node.js (>= 22) |
| Testing | Vitest 2.1 |
| Integrations | Chrome Identity API (`chrome.identity`), Google Calendar REST API v3, SPADA Moodle HTML |

---

## Documentation

- **End-User Installation (ZIP, no Node.js or Google Cloud Console required):** [HOW_TO_RUN.md](HOW_TO_RUN.md#end-user-installation-load-unpacked-zip)
- **Developer Setup, Packaging, and Release Verification:** [HOW_TO_RUN.md](HOW_TO_RUN.md#developer-setup-and-packaging)
- **Chrome Web Store Listing Metadata:** [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)
- **Privacy Policy:** [PRIVACY.md](PRIVACY.md)

---

## Project Structure

```text
├── config/
│   └── unpacked-oauth.example.json   # Local unpacked OAuth config template (real config is gitignored)
├── public/
│   ├── manifest.json                 # Chrome Web Store MV3 manifest (no "key" field)
│   └── icons/                        # Extension icons (16px, 48px, 128px)
├── scripts/
│   ├── setup-unpacked.mjs            # Generates RSA-2048 SPKI public key and stable Extension ID
│   ├── unpacked-manifest.mjs         # RSA-2048 SPKI validator and dual-target manifest composer
│   ├── validate-manifest.mjs         # Store and Unpacked manifest validation rules
│   ├── build.mjs                     # esbuild dual-target bundler (store / unpacked)
│   └── package.mjs                   # Isolated-staging ZIP packager
├── src/
│   ├── background/                   # Service worker, SPADA scanner, lifecycle and session guards
│   ├── calendar/                     # Google Calendar REST API v3 client
│   ├── content/                      # SPADA active-course DOM observer
│   ├── onboarding/                   # Three-step onboarding wizard
│   ├── options/                      # Settings and Extension ID management page
│   ├── parsers/                      # SPADA Moodle HTML, date, and status parsers
│   ├── popup/                        # Toolbar popup interface
│   ├── setup/                        # Setup readiness evaluation and error diagnostics
│   ├── shared/                       # Serialized chrome.storage.local state layer
│   └── sync/                         # Event formatter and diff planner
└── tests/                            # Vitest unit and integration test suite
```

---

## Permissions and Data Access

| Permission / Host | Purpose |
|---|---|
| `storage` | Persists scanned assignment summaries, sync state, and user settings locally. |
| `alarms` | Schedules periodic background scans every 3 hours while Chrome is running. |
| `identity` | Acquires a Google OAuth 2.0 access token via Chrome sign-in (`calendar.events` scope). |
| `https://spada.upnyk.ac.id/*` | Reads active course links and `/mod/assign/index.php` tables using the active SPADA session. |
| `https://www.googleapis.com/*` | Lists, creates, and updates synced assignment events on the user's Google Calendar. |

For full disclosure details, refer to [PRIVACY.md](PRIVACY.md).

---

## License

This project is licensed under the **MIT License** — Copyright (c) 2026 Nicolaus Narindra Lianto. See [LICENSE](LICENSE) for full license terms.
