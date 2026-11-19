# How to Run & Set Up — SPADA UPNYK Assignment Scanner

> 🌐 **Language:** **English** | [Bahasa Indonesia](HOW_TO_RUN.id.md)  
> 📘 **Project Overview:** [README.md](README.md) | [README.id.md](README.id.md)

---

## For Students — Install from ZIP (3 Steps, No Node.js & No Google Cloud Console)

> Make sure you are using **Google Chrome** signed in to a Chrome profile. You do **not** need Node.js, you do **not** need to open Google Cloud Console, and you will **never** need to enter a manual `refresh token`.

### Step 1: Download & Extract the ZIP
1. Download the latest `spada-calendar-extension-unpacked-v*.zip` from [GitHub Releases](https://github.com/CodebyCola/spada-calendar-sync/releases).
2. Right-click the ZIP file → **Extract All...** into a permanent folder (for example, `Documents/spada-calendar-extension`).
   - **Important:** Do not delete this extracted folder — Chrome loads the unpacked extension directly from it.

### Step 2: Load into Google Chrome (*Load Unpacked*)
1. Open `chrome://extensions` in Google Chrome.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the extracted folder (the folder directly containing `manifest.json`).

### Step 3: Complete the Auto-Opening 3-Step Setup Guide
Once loaded, Chrome **automatically opens the Setup Guide tab**:
1. **Sign in to SPADA UPNYK:** Click **Buka SPADA ↗**, log in with your student account as usual, then click **Cek Sesi SPADA**.
2. **Connect Google Calendar:** Click **Hubungkan Google** and choose your own Google account.
   - *Note:* If Google shows *"Google hasn't verified this app"*, click **Advanced** → **Go to SPADA UPNYK Assignment Scanner** to continue. Your events are synced strictly to **your own** Google Calendar.
3. **First Sync:** Click **Scan & Sync Pertama**. All active assignment deadlines are synced to your Google Calendar with H-1 day and H-3 hour popup reminders.
4. Click the puzzle icon (🧩) in Chrome's top-right toolbar and **Pin** the extension for quick access.

---

## For Developers — Build & Prepare Unpacked Package (One-Time Setup)

### Prerequisites
- **Node.js >= 22** and **npm**
- **Google Chrome** (for testing `chrome.identity.getAuthToken`)

Unpacked distribution settings live in `config/unpacked-oauth.json` (gitignored; see [config/unpacked-oauth.example.json](config/unpacked-oauth.example.json)) so your public key and OAuth Client ID are not reused by forks of a public repository. **Back up `config/unpacked-oauth.json` if you switch machines.**

### 1. Clone & Generate a Stable Extension ID (One-Time)
```bash
git clone https://github.com/CodebyCola/spada-calendar-sync.git
cd spada-calendar-sync
npm install
npm run setup:unpacked
```
This generates an RSA-2048 SPKI DER *public key* (the private key is discarded in memory and never written to disk) and derives a deterministic 32-character **Stable Extension ID** that stays identical across every student's computer.

### 2. Create 1 Chrome Extension OAuth Client ID in Google Cloud Console (One-Time)
1. Open [Google Cloud Console](https://console.cloud.google.com/), enable **Google Calendar API**, and configure your **OAuth consent screen**.
2. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - **Application type:** **Chrome Extension**
   - **Item ID:** paste the **Stable Extension ID** printed in Step 1.
3. Save the `Client ID` into your local config:
   ```bash
   npm run setup:unpacked -- --client-id <CLIENT_ID_FROM_GOOGLE>
   ```
   *(Re-running `npm run setup:unpacked` is safe and idempotent — it never rotates an existing key. Pass `--reset-key` only if you intentionally want a new Extension ID, which also resets `clientId` back to a placeholder.)*

### 3. Build & Package the Student ZIP
```bash
npm run package:unpacked
```
This builds into an isolated temporary staging directory, enforces strict RSA-2048 SPKI and non-placeholder OAuth validation, and outputs:
- `release/spada-calendar-extension-unpacked-v<version>.zip`

*(For quick local Load Unpacked testing into `dist/` before adding your real `Client ID`, run `npm run build:unpacked`.)*

### 4. Mandatory Fresh-Profile Release Acceptance Check
Before uploading `release/spada-calendar-extension-unpacked-v<version>.zip` to GitHub Releases:
1. Extract the final ZIP into a clean folder outside this repository.
2. Open a **fresh Google Chrome profile** → `chrome://extensions` → enable **Developer mode** → **Load unpacked** the extracted folder.
3. Confirm the **Extension ID** shown in `chrome://extensions` **exactly matches** `extensionId` in `config/unpacked-oauth.json` and Google Cloud Console.
4. Walk through the auto-opening Onboarding steps 1–3, including **Connect Google** using an eligible student account, and verify assignment events appear in that student's Google Calendar.

---

## Development, Test & Build Commands

```bash
npm test                 # Run all unit & integration tests (Vitest)
npm run typecheck        # Run strict TypeScript check (tsc --noEmit)
npm run build            # Build Chrome Web Store target into dist/ (no "key" field)
npm run build:unpacked   # Build Unpacked target into dist/ (injects key + clientId from config/unpacked-oauth.json)
npm run package          # Package Store ZIP (allows placeholder client_id with warning)
npm run package:strict   # Package Store ZIP (strict: rejects placeholder or unpacked client_id)
npm run package:unpacked # Package Unpacked ZIP for students (always strict OAuth + RSA-2048 SPKI key)
```

---

## Publishing to the Chrome Web Store

1. [public/manifest.json](public/manifest.json) is reserved **exclusively for the Chrome Web Store** (no `"key"` field). Once Chrome Web Store assigns your permanent **Store Item ID**, create a dedicated Chrome Extension OAuth Client ID for that Store Item ID and set it in `public/manifest.json` (never reuse the unpacked Client ID from `config/unpacked-oauth.json`).
2. Review store listing metadata, permission justifications, and privacy disclosures in [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).
3. Run verification and produce the clean Store archive:
   ```bash
   npm test && npm run typecheck && npm run package:strict
   ```
   Output: `release/spada-calendar-extension-v<version>.zip`.
4. Before publishing to Production, install the Store build (unlisted/testing) and verify **Connect Google** succeeds end-to-end from the Store installation.
