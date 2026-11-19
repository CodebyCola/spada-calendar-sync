# How to Run and Set Up

Language: **English** | [Bahasa Indonesia](HOW_TO_RUN.id.md)  
Project Overview: [README.md](README.md) | [README.id.md](README.id.md)

---

## End-User Installation (Load Unpacked ZIP)

Requirements: **Google Chrome** signed in to a Chrome profile. Node.js, Google Cloud Console access, and manual refresh tokens are not required.

### 1. Download and Extract the Release Archive
1. Download the latest `spada-calendar-extension-unpacked-v*.zip` archive from [GitHub Releases](https://github.com/CodebyCola/spada-calendar-sync/releases).
2. Extract the archive into a permanent local directory (for example, `Documents/spada-calendar-extension`).
   - Do not delete this directory after installation; Chrome loads the extension directly from disk.

### 2. Load the Extension in Chrome
1. Navigate to `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** in the upper-right corner.
3. Select **Load unpacked** and choose the extracted directory containing `manifest.json`.

### 3. Complete Initial Setup
After installation, Chrome opens the three-step Setup Guide automatically:
1. **Verify SPADA Session:** Open `https://spada.upnyk.ac.id/my/`, sign in with your student account, and click **Cek Sesi SPADA**.
2. **Connect Google Calendar:** Click **Hubungkan Google** and select your Google account.
   - If Google displays an unverified-app warning (*"Google hasn't verified this app"*), select **Advanced** -> **Go to SPADA UPNYK Assignment Scanner**. Events are created strictly in your own Google Calendar.
3. **Run Initial Sync:** Click **Scan & Sync Pertama** to publish active deadlines with 24-hour and 3-hour popup reminders.
4. Pin the extension from the Chrome toolbar extensions menu for quick access.

---

## Developer Setup and Packaging

### Prerequisites
- Node.js `>= 22` and npm
- Google Chrome (required for `chrome.identity.getAuthToken`)

Local unpacked OAuth configuration is stored in `config/unpacked-oauth.json` (gitignored; template available at [config/unpacked-oauth.example.json](config/unpacked-oauth.example.json)) to prevent forks from reusing your OAuth client quota. Keep a backup of `config/unpacked-oauth.json` when migrating machines.

### 1. Clone and Initialize Stable Extension ID (One-Time)
```bash
git clone https://github.com/CodebyCola/spada-calendar-sync.git
cd spada-calendar-sync
npm install
npm run setup:unpacked
```
This command generates an RSA-2048 SPKI DER public key (the private key is discarded in memory and never written to disk) and calculates a deterministic 32-character Extension ID consistent across all installations.

### 2. Register OAuth Client ID and Scopes in Google Cloud Console (One-Time)
1. Open [Google Cloud Console](https://console.cloud.google.com/), enable **Google Calendar API**, and configure the **OAuth consent screen / Data Access** with both scopes:
   - `https://www.googleapis.com/auth/calendar.events` (required for syncing assignment events)
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (optional, requested in Options when loading the writable calendar picker)
   Verify whether Google OAuth app verification is required for your audience before rollout.
2. Navigate to **APIs & Services -> Credentials -> Create Credentials -> OAuth client ID**.
   - **Application type:** Chrome Extension
   - **Item ID:** paste the Extension ID output from Step 1.
3. Persist the Client ID into your local unpacked configuration:
   ```bash
   npm run setup:unpacked -- --client-id <CLIENT_ID_FROM_GOOGLE>
   ```
   Re-running `npm run setup:unpacked` preserves the existing key. Pass `--reset-key` only when intentionally rotating the Extension ID (this also resets `clientId` back to a placeholder).

### 3. Build and Package Unpacked ZIP
```bash
npm run package:unpacked
```
Packaging builds into an isolated temporary staging directory, enforces strict RSA-2048 SPKI and non-placeholder OAuth validation, and writes `release/spada-calendar-extension-unpacked-v<version>.zip`.

For quick local development builds into `dist/` prior to setting a real `clientId`, run `npm run build:unpacked`.

### 4. Unpacked Release Acceptance Checklist
Before publishing `release/spada-calendar-extension-unpacked-v<version>.zip` to GitHub Releases:
1. Extract the final ZIP into a clean directory outside the repository.
2. Test on a **fresh Google Chrome profile**: enable **Developer mode**, load the extracted directory, confirm the Extension ID matches `config/unpacked-oauth.json` and Google Cloud Console, complete onboarding Steps 1-3, customize filters/reminders/colors in Options, authorize the calendar list picker, and verify events appear on the chosen calendar.
3. Test an **in-place upgrade from v1.0.0** (same Extension ID): confirm v1 preferences migrate cleanly, confirm event sync continues working with the existing `calendar.events` grant even if calendar-list access is declined, then grant calendar-list access in Options, switch destination calendar, and confirm new events sync to the newly chosen calendar while old events remain untouched.

---

## Commands

| Command | Description |
|---|---|
| `npm test` | Run the Vitest unit and integration test suite. |
| `npm run typecheck` | Run strict TypeScript checking (`tsc --noEmit`). |
| `npm run build` | Build the Chrome Web Store target into `dist/` (strips `"key"`). |
| `npm run build:unpacked` | Build the Unpacked target into `dist/` using `config/unpacked-oauth.json`. |
| `npm run setup:unpacked` | Initialize or update `config/unpacked-oauth.json` (`--client-id`, `--reset-key`). |
| `npm run package` | Package a Store ZIP (warns on placeholder `client_id`). |
| `npm run package:strict` | Package a Store ZIP strictly (rejects placeholder or unpacked `client_id`). |
| `npm run package:unpacked` | Package an Unpacked student ZIP (always enforces strict OAuth and RSA-2048 SPKI key). |

---

## Chrome Web Store Release

1. [public/manifest.json](public/manifest.json) is reserved exclusively for Chrome Web Store builds (without a `"key"` field). Register a dedicated Chrome Extension OAuth Client ID for the assigned Store Item ID and configure it in `public/manifest.json` (do not reuse the unpacked Client ID).
2. Review store listing metadata and permission justifications in [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).
3. Validate and package the release archive:
   ```bash
   npm test && npm run typecheck && npm run package:strict
   ```
   Output: `release/spada-calendar-extension-v<version>.zip`.
4. Before releasing to Production, install the Store build (unlisted/testing) and verify Google Calendar sign-in end-to-end.
