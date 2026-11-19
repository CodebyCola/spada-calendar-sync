# SPADA UPNYK Assignment Scanner (Chrome Extension MV3)

> 🌐 **Language:** **English** | [Bahasa Indonesia](README.id.md)  
> 🚀 **Setup & Usage Guide:** [HOW_TO_RUN.md](HOW_TO_RUN.md) | [HOW_TO_RUN.id.md](HOW_TO_RUN.id.md)

A Manifest V3 Google Chrome Extension that scans **every assignment** across all active courses on **SPADA Wimaya UPN "Veteran" Yogyakarta** (`spada.upnyk.ac.id`) — **including assignments missing from Moodle's built-in calendar / `.ics` feed** — tracks submission status (`✅ Submitted` vs `⏳ Pending`), and syncs deadlines directly to your personal **Google Calendar**.

The extension also automatically recognizes calendar events created by the companion CLI project `spada_calendar_sync`, so both tools can be used side by side without creating duplicate events.

---

## Key Features

- **Complete Assignment Detection:** Scans every active course's assignment index on SPADA UPNYK, catching tasks omitted from Moodle's built-in calendar (and handles empty start-of-semester/KRS dashboards gracefully).
- **Submission Status & Toolbar Badge:** Separates pending tasks from submitted assignments and displays a live pending counter badge on the extension icon.
- **3-Step Guided Onboarding:** Automatically opens a first-run setup checklist on fresh install to verify your SPADA session, connect Google Calendar in one click, and run your first sync.
- **Actionable Error Diagnostics:** Distinguishes SPADA session expiry, SPADA HTTP 403 access errors, Google Calendar rate limits, OAuth consent errors, and unsupported browsers into clear troubleshooting steps.
- **Duplicate-Free Google Calendar Sync:** Creates deadline events in WIB (`Asia/Jakarta`) with H-1 day and H-3 hour popup reminders, and automatically updates events when you submit an assignment.
- **Privacy First:** Runs 100% locally in your browser using your existing SPADA session. There is no developer backend server, no SPADA password collection, and no manual `refresh token` setup.

---

## Quick Links

- **Students (3-step ZIP install — no Node.js & no Google Cloud Console):** [HOW_TO_RUN.md — For Students](HOW_TO_RUN.md#for-students--install-from-zip-3-steps-no-nodejs--no-google-cloud-console)
- **Developers (Unpacked build, OAuth setup & packaging):** [HOW_TO_RUN.md — For Developers](HOW_TO_RUN.md#for-developers--build--prepare-unpacked-package-one-time-setup)
- **Chrome Web Store Listing & Release Notes:** [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)
- **Privacy Policy:** [PRIVACY.md](PRIVACY.md)

---

## Project Structure

```text
├── config/
│   └── unpacked-oauth.example.json   # Template for local unpacked OAuth config (real config is gitignored)
├── public/
│   ├── manifest.json                 # Chrome Web Store MV3 manifest (no "key" field)
│   └── icons/                        # 16px, 48px, 128px extension icons
├── scripts/
│   ├── setup-unpacked.mjs            # Generates stable RSA-2048 public key + Extension ID config
│   ├── unpacked-manifest.mjs         # Strict RSA-2048 SPKI validation & dual-target manifest composer
│   ├── validate-manifest.mjs         # Store & Unpacked manifest validator
│   ├── build.mjs                     # esbuild dual-target bundler (store / unpacked)
│   └── package.mjs                   # Isolated-staging ZIP packager
├── src/
│   ├── background/                   # Service worker, SPADA scanner, install lifecycle & session guards
│   ├── calendar/                     # Google Calendar REST API v3 client
│   ├── content/                      # SPADA active-course observer content script
│   ├── onboarding/                   # Auto-opening 3-step guided setup wizard
│   ├── options/                      # Extension settings & Extension ID copy panel
│   ├── parsers/                      # SPADA Moodle HTML & date/status parsers
│   ├── popup/                        # Toolbar popup UI
│   ├── setup/                        # Setup readiness state machine & error diagnostics
│   ├── shared/                       # Serialized chrome.storage.local state store
│   └── sync/                         # Event formatter & duplicate-free diff planner
└── tests/                            # Vitest unit & integration test suite
```

---

## Permissions & Privacy

| Permission / Host | Purpose |
|---|---|
| `storage` | Persists cached assignments, sync status, and user preferences locally in Chrome. |
| `alarms` | Runs periodic background assignment checks every 3 hours while Chrome is open. |
| `identity` | Requests a Google OAuth 2.0 token via Chrome sign-in (`calendar.events` scope only). |
| `https://spada.upnyk.ac.id/*` | Reads active course links and `/mod/assign/index.php` pages using your existing SPADA session. |
| `https://www.googleapis.com/*` | Lists, creates, and updates assignment events directly on your Google Calendar. |

See [PRIVACY.md](PRIVACY.md) for the complete privacy policy.

---

## License

Licensed under the terms in [LICENSE](LICENSE).
