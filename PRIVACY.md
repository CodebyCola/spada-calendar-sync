# Privacy Policy for SPADA UPNYK Assignment Scanner

Last updated: 2026-11-19

**SPADA UPNYK Assignment Scanner** is an unofficial student productivity tool designed to scan active course assignment pages on `https://spada.upnyk.ac.id/` and synchronize assignment deadlines to your personal Google Calendar.

## 1. What Data Is Accessed and Processed

1. **Course & Assignment Content (`spada.upnyk.ac.id`):**
   When you are signed into SPADA UPNYK and initiate a scan (manually or via scheduled background checks), the extension reads your active course list and assignment index pages (`/mod/assign/index.php`) to extract course names, assignment titles, due dates, assignment URLs, and submission statuses (`Submitted` / `Pending`).
2. **User Preferences & Scan Cache:**
   Your sync preferences (selected Google Calendar ID, time and status filters, excluded course IDs, reminder presets, and event colors) and the latest scanned assignment list are saved locally in your browser (`chrome.storage.local`).
3. **Google OAuth Access Tokens & Writable Calendar List:**
   - When you click **Connect Google** / **Hubungkan Google** or run synchronization, the extension requests an OAuth 2.0 token scoped to `https://www.googleapis.com/auth/calendar.events` via Chrome's built-in identity service to create and update assignment events on your chosen Google Calendar.
   - Optionally, when you choose to load your writable calendars in Options, the extension requests `https://www.googleapis.com/auth/calendar.calendarlist.readonly` to read your writable calendar names and IDs on-device solely for displaying the calendar selector dropdown. Only the calendar ID you save is stored locally; OAuth tokens are never stored in extension storage or sent to any third party.

**What we do NOT access:** The extension never reads, stores, or transmits your SPADA username, password, or unrelated browsing history outside `spada.upnyk.ac.id`.

## 2. How Data Is Stored and Transmitted

- **Local Browser Storage:** Scanned assignment summaries and preferences (including your selected target calendar ID) remain stored locally on your device (`chrome.storage.local`) and are never transmitted to any developer-operated server.
- **Google Calendar API (`www.googleapis.com`):** Only when you connect your Google account and trigger calendar synchronization, formatted assignment titles, deadlines, reminders, event color choices, SPADA links, and sync identifiers are sent directly from your browser to Google's official Calendar API (`https://www.googleapis.com/calendar/v3/`) to create or update events on your selected Google Calendar. When authorized in Options, writable calendar names and IDs are read directly from Google's CalendarList API on-device solely for selecting your destination calendar.

## 3. Third-Party Services and Data Sharing

- We do **not** operate any backend server, analytics service, or telemetry tracker.
- We do **not** sell, rent, or share your data with any third parties.
- Google Calendar synchronization is governed by [Google's Privacy Policy](https://policies.google.com/privacy).

## 4. Data Retention and User Controls

- Locally cached assignments and settings remain on your device until you clear them or uninstall the extension.
- You can delete all locally stored scan data and settings at any time by clicking **Hapus Data Lokal** on the extension's **Options / Pengaturan** page.
- You can revoke Google Calendar access at any time by clicking **Putuskan** inside the extension popup or via your [Google Account Permissions](https://myaccount.google.com/permissions).

## 5. Changes to This Policy

If our data practices change in future versions, this policy will be updated with a revised date and reflected in the extension release notes.

## 6. Contact

For privacy questions or support, please contact `<YOUR_CONTACT_EMAIL>` or open an issue on the project's GitHub repository (https://github.com/CodebyCola/spada-calendar-sync).
