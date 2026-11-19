# Desain Fitur: Kemudahan Setup Ekstensi (Mode Unpacked + Guided Onboarding)

> Tanggal: 2026-11-19  
> Status: Approved (2026-11-19)  
> Repo: `spada_calendar_extension`

---

## 1. Latar Belakang & Tujuan (*Intent & Why*)

Saat ini memasang `spada_calendar_extension` di luar Chrome Web Store (*Load Unpacked*) terlalu membingungkan baik bagi pengembang maupun mahasiswa UPNYK lainnya:

1. **Extension ID berubah-ubah di tiap laptop/folder** karena `public/manifest.json` belum memiliki field `"key"`. Akibatnya `oauth2.client_id` milik pengembang tidak cocok di laptop mahasiswa lain, sehingga setiap pengguna terpaksa membuka Google Cloud Console, mengedit file kode `public/manifest.json`, dan menjalankan `npm install && npm run build`.
2. **Pengembang sendiri kesulitan mengetahui letak konfigurasi** (`"key"` dan `oauth2.client_id`) serta membedakan paket *Load Unpacked* (untuk dibagikan gratis ke teman) vs paket *Chrome Web Store* (tanpa `"key"`).
3. **Tidak ada alur onboarding untuk mahasiswa baru**: setelah *Load Unpacked*, tidak ada panduan yang terbuka otomatis, dan error teknis dari SPADA atau Chrome Identity API tampil mentah tanpa langkah perbaikan yang mudah dipahami.

**Tujuan utama:** Memangkas alur setup menjadi sangat sederhana sehingga:
- **Mahasiswa** sama sekali tidak perlu membuka Google Cloud Console, tidak perlu menginstal Node.js/terminal, dan tidak pernah mengisi `refresh token` manual — cukup ekstrak ZIP → *Load Unpacked* di Chrome → ikuti 3 langkah di halaman Onboarding yang terbuka otomatis.
- **Pengembang (pembuat)** hanya perlu menjalankan setup Google Cloud Console & helper CLI **sekali saja** untuk menghasilkan paket ZIP *unpacked* siap bagikan, dan mudah merekam video tutorial setup yang singkat.

---

## 2. Ruang Lingkup: Goals, Non-Goals, dan Anti-Goals

### Goals
- **Stable Extension ID untuk paket Unpacked**: menghasilkan dan menyimpan RSA-2048 *public key* di satu lokasi konfigurasi yang jelas (`config/unpacked-oauth.json`), lalu menurunkan Extension ID 32 karakter secara deterministik sehingga identik di semua laptop/folder.
- **Dual-target Build & Packaging**:
  - Target `unpacked` (`npm run build:unpacked` & `npm run package:unpacked`) menyuntikkan `"key"` + `clientId` ke `dist/manifest.json` dan menghasilkan ZIP siap ekstrak di `release/spada-calendar-extension-unpacked-v<version>.zip`.
  - Target `store` (`npm run build`, `npm run package`, `npm run package:strict`) tetap bersih tanpa `"key"` dan kompatibel dengan Chrome Web Store.
- **Developer Setup CLI Helper (`npm run setup:unpacked`)**: menginisialisasi `publicKey` (tanpa menyimpan private key), menghitung Extension ID, mencetak checklist singkat Google Cloud Console, dan menyimpan `clientId` yang valid ke `config/unpacked-oauth.json`.
- **Guided Onboarding Wizard (`onboarding/onboarding.html`)**: otomatis terbuka di tab baru **hanya saat fresh install** (`chrome.runtime.onInstalled` dengan `reason === "install"`), memandu 3 langkah:
  1. Cek login SPADA UPNYK.
  2. Hubungkan Google Calendar (1 klik via `chrome.identity.getAuthToken`, lengkap dengan tips menghadapi layar *"Google hasn't verified this app"*).
  3. Sinkronisasi pertama + tips pin ekstensi & jangan hapus folder ekstrak.
- **Friendly Error Diagnostics**: menerjemahkan error teknis SPADA / Chrome Identity / Google Calendar menjadi judul dan langkah perbaikan berbahasa Indonesia, dipakai bersama di Onboarding dan Popup.
- **Perbaikan UX kecil di Popup & Options**:
  - Tombol buka kembali Panduan Setup dari Popup (ketika setup belum lengkap) dan dari halaman Options.
  - Tombol **Salin ID** di halaman Options + pembaruan teks panduan di Options & `README.md`.

### Non-Goals
- **Tidak** menambah permission baru di `manifest.json` (`permissions` tetap `["storage", "alarms", "identity"]`, `host_permissions` tetap SPADA & `googleapis.com`).
- **Tidak** menambah scope OAuth baru (tetap `https://www.googleapis.com/auth/calendar.events`; fitur dropdown pilih daftar Google Calendar ditunda untuk iterasi berikutnya).
- **Tidak** mengganti autentikasi ke `chrome.identity.launchWebAuthFlow` atau menambah input manual `refresh token`.
- **Tidak** mengubah algoritma ekstraksi tugas/tenggat di `src/parsers/spada-html.ts` maupun formatter/diff event Google Calendar di `src/sync/formatter-and-diff.ts` (hanya menambah helper kecil untuk membedakan dashboard SPADA terautentikasi yang kosong dari halaman login).

### Anti-Goals (Kegagalan Fungsional/Keamanan)
- Tab onboarding terbuka berulang kali saat ekstensi di-reload, di-update, atau Chrome direstart (harus ketat hanya `reason === "install"`).
- RSA *private key* pernah ditulis ke disk atau masuk ke git (hanya *public key* DER base64 yang disimpan).
- Field `"key"` ikut masuk ke paket ZIP Chrome Web Store (`npm run package` / `npm run package:strict`).
- Menjalankan `npm run setup:unpacked` ulang secara tidak sengaja merotasi `publicKey` yang sudah ada (yang akan mengubah Extension ID dan memutus OAuth Client ID yang sudah dibuat).
- Penggunaan `innerHTML` untuk merender pesan error atau data eksternal (wajib `.textContent` untuk mencegah XSS).

---

## 3. Pendekatan yang Dipertimbangkan (*Approaches*)

Kami mempertimbangkan dua lapisan keputusan: model distribusi OAuth, lalu kedalaman fitur setup untuk model terpilih.

### Keputusan Distribusi: Dipilih Opsi 2 (ZIP Unpacked + 1 OAuth Client ID Pengembang)
- **Opsi 1 (Chrome Web Store)**: paling mulus untuk pengguna, tetapi butuh biaya registrasi developer $5 + proses review toko & verifikasi OAuth Google.
- **Opsi 2 (Dipilih — ZIP Unpacked siap pakai + 1 OAuth Client ID milik pengembang + Stable `"key"`)**: 100% gratis, mahasiswa tidak perlu membuka Google Cloud Console atau menginstal Node.js, dan jadwal tetap masuk ke Google Calendar masing-masing mahasiswa karena setiap pengguna login dengan akun Google-nya sendiri via `chrome.identity.getAuthToken`. *Trade-off*: batasan OAuth Consent Screen Google (Testing max 100 email / Production unverified memunculkan layar peringatan *"Google hasn't verified this app"* yang bisa dilewati via *Advanced → Continue*) dan hanya berjalan di Google Chrome.
- **Opsi 3 (Per-user OAuth Client ID lewat UI + `launchWebAuthFlow`)**: bebas batas kuota akun pengembang, tetapi memaksa setiap mahasiswa membuat project Google Cloud Console (~6–8 langkah) dan memiliki token akses yang kedaluwarsa tiap ~1 jam tanpa refresh mulus.

### Keputusan Fitur untuk Opsi 2: Dipilih Pendekatan B
1. **Pendekatan A — Minimal (Build Unpacked Stabil + Checklist di Popup/Options)**: paling cepat, tetapi tidak ada tab panduan yang otomatis muncul setelah mahasiswa selesai *Load Unpacked*.
2. **Pendekatan B — Guided Onboarding Otomatis saat Pertama Install *(Dipilih)***: menggabungkan build/packaging dual-target stabil + developer CLI helper + halaman Onboarding 3 langkah yang terbuka otomatis saat fresh install + modul diagnostik error ramah pengguna. Cocok untuk mahasiswa awam dan mempermudah pembuatan video tutorial.
3. **Pendekatan C — Pendekatan B + Dropdown Pilih Google Calendar**: membutuhkan tambahan scope OAuth (`calendar.calendarlist.readonly`), sehingga memperluas izin sensitif padahal mayoritas mahasiswa cukup memakai kalender `"primary"`. Ditunda untuk pengembangan berikutnya.

---

## 4. Batasan Teknis & Keamanan (*Constraints*)

- **Platform**: Chrome Extension Manifest V3 (TypeScript, esbuild ESM bundle, Vitest, Node.js >= 22).
- **CSP MV3 ketat**: tidak boleh ada inline `<script>` maupun inline event handler di HTML.
- **Tanpa permission baru**: `chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") })` tidak memerlukan permission `"tabs"` dan halaman internal ekstensi tidak perlu didaftarkan di `web_accessible_resources`.
- **Single source of truth untuk state**: kesiapan setup diturunkan langsung dari `StoredExtensionState` (`courses`, `lastScanAt`, `lastScanError`, `googleConnected`, `googleAuthVerified`, `lastSyncAt`, `lastSyncSummary`, `lastSyncError`) + `oauthConfigured` — dengan `googleAuthVerified: boolean` (default `false` untuk state lama sebelum pembaruan) agar instalasi lama dari jalur 0-tugas yang belum terautentikasi dapat direvalidasi secara aman.
- **Format `config/unpacked-oauth.json`**:
  ```json
  {
    "publicKey": "<base64 DER SubjectPublicKeyInfo RSA-2048>",
    "extensionId": "<32 huruf a-p hasil SHA-256 16-byte pertama>",
    "clientId": "<xxx.apps.googleusercontent.com>"
  }
  ```
  - **Kebijakan Git (dipilih pengguna):** `config/unpacked-oauth.json` dimasukkan ke `.gitignore` (file lokal per maintainer agar kuota OAuth pengembang tidak terpakai oleh *fork* di repo publik), disertai template `config/unpacked-oauth.example.json` yang di-commit ke Git. Pengembang menyimpan cadangan `config/unpacked-oauth.json` bila berpindah perangkat, dan membagikan hasil ZIP dari `npm run package:unpacked` ke mahasiswa (mis. via GitHub Releases).
  - **Pemisahan lokasi OAuth Client ID (Store vs Unpacked):**
    - `config/unpacked-oauth.json` (`clientId`) adalah **satu-satunya** tempat konfigurasi OAuth Client ID untuk distribusi *Load Unpacked*.
    - `public/manifest.json` (`oauth2.client_id`) adalah **satu-satunya** tempat konfigurasi OAuth Client ID yang terdaftar pada **Chrome Web Store Item ID** (dan tetap tidak memiliki field `"key"`).
    - Karena `client_id` yang sebelumnya ada di `public/manifest.json` terikat pada Extension ID unpacked lama di laptop pengembang, `public/manifest.json` di-reset ke placeholder `YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com` hingga Store Item ID resmi terdaftar — sehingga `npm run package:strict` tidak bisa lolos diam-diam memakai Client ID unpacked.
    - Sebagai proteksi tambahan saat `npm run package:strict` (target `store`), jika `config/unpacked-oauth.json` tersedia secara lokal dan `public/manifest.json` memakai `client_id` yang sama persis dengan `unpackedConfig.clientId`, validasi menolaknya sebagai error.
    - **Acceptance rilis Chrome Web Store (`CHROMEWEBSTORE.md`):** sebelum rilis publik di Store, pengembang wajib memasang versi Store (unlisted/testing) dan menguji alur *Hubungkan Google* sampai berhasil.
    - **Acceptance rilis ZIP Unpacked Mahasiswa (`README.md`):** sebelum membagikan `release/spada-calendar-extension-unpacked-v<version>.zip` ke mahasiswa, pengembang wajib melakukan uji end-to-end menggunakan file ZIP final tersebut pada **profil Chrome baru (*fresh profile*)**: ekstrak ZIP ke folder bersih → *Load Unpacked* → pastikan Extension ID yang tampil di `chrome://extensions` **identik** dengan `extensionId` di `config/unpacked-oauth.json` dan Google Cloud Console → jalankan Onboarding Langkah 1–3 termasuk **Hubungkan Google** memakai akun mahasiswa yang memenuhi syarat (*eligible*) dan verifikasi event masuk ke kalender akun tersebut.
  - Catatan migrasi lokal: setelah `npm run setup:unpacked` membuat `publicKey` + `extensionId` stabil di `config/unpacked-oauth.json`, pengembang cukup membuat/memperbarui 1 Chrome Extension OAuth Client ID di Google Cloud Console memakai `extensionId` baru tersebut, lalu menyimpannya lewat `npm run setup:unpacked -- --client-id <CLIENT_ID>`.
- **Catatan lingkungan test Windows**: Vitest pada proyek ini menjalankan test secara murni di Node tanpa browser; modul logika domain & build scripts harus dipisahkan bersih dari pemanggilan global `chrome.*` melalui *dependency injection* agar 100% dapat diuji dengan TDD.

---

## 5. Arsitektur Modul & Interface

### 5.1. Modul Manifest & Identitas Unpacked (`scripts/unpacked-manifest.mjs`)
Modul *pure* (tanpa I/O file) yang menangani kalkulasi Extension ID dan komposisi manifest per target:
- `deriveExtensionIdFromPublicKey(publicKeyBase64: string): string`
  - Decode base64 DER public key, hitung SHA-256, ambil 16 byte pertama (32 nibble), petakan tiap nibble `0..15` ke karakter `'a'..'p'` sesuai algoritma Chromium. Lempar error jelas jika input kosong atau bukan base64 valid.
- `validateUnpackedConfig(config: unknown, options?: { strictOAuth?: boolean }): { errors: string[]; warnings: string[]; derivedExtensionId: string | null }`
  - *(Keputusan implementasi — strictness bertingkat)*: Memastikan `publicKey` valid dan `extensionId` cocok dengan hasil `deriveExtensionIdFromPublicKey(publicKey)` (selalu error jika tidak valid/mismatch). Untuk `clientId`: format non-`*.apps.googleusercontent.com` selalu error; nilai placeholder (`YOUR_UNPACKED_CLIENT_ID.apps.googleusercontent.com`) menjadi **warning** saat `strictOAuth: false` (dipakai `npm run build:unpacked` agar developer bisa uji coba *Load Unpacked* lebih awal) dan **error** saat `strictOAuth: true` (dipakai `npm run package:unpacked` agar ZIP rusak tidak pernah terbagikan ke mahasiswa).
- `buildManifestForTarget(baseManifest, options: { target: "store" | "unpacked"; unpackedConfig?: UnpackedConfig; strictOAuth?: boolean })`
  - Jika `target === "store"`: mengembalikan salinan manifest dengan field `"key"` dihapus.
  - Jika `target === "unpacked"`: memvalidasi `unpackedConfig` dengan `strictOAuth` yang diberikan (melempar error jika ada `errors`), lalu mengembalikan salinan manifest dengan `"key": unpackedConfig.publicKey` dan `oauth2.client_id: unpackedConfig.clientId`.

### 5.2. Validasi Manifest (`scripts/validate-manifest.mjs`) & Perbaikan Scanner/Auth (`src/background/scanner.ts`)
- Mempertahankan kompatibilitas penuh `validateManifestForStore(manifest, { strictOAuth })`.
- Menambah opsi `target?: "store" | "unpacked"` (default `"store"`) dan `disallowedClientIds?: string[]`:
  - Pada `target: "store"`: keberadaan `"key"` tetap menjadi warning (seperti sekarang), `strictOAuth` menolak placeholder `client_id`, dan jika `client_id` cocok dengan `disallowedClientIds` (mis. `clientId` milik paket unpacked) maka ditolak sebagai error.
  - Pada `target: "unpacked"`: keberadaan `"key"` **wajib** (error jika tidak ada/tidak valid), dan `client_id` placeholder ditolak sebagai error ketika `strictOAuth: true` (`package:unpacked`) atau warning ketika `strictOAuth: false` (`build:unpacked`).
- **Cek OAuth Runtime (`src/background/scanner.ts`)**:
  - Memperbarui `isOAuthClientConfigured()` (dengan helper *pure* `isConfiguredOAuthClientId(clientId: string)`) agar mengenali baik placeholder `YOUR_CHROME_EXTENSION_CLIENT_ID...` maupun `YOUR_UNPACKED_CLIENT_ID...` (pola `/^YOUR_.*CLIENT_ID/` serta sufiks `.apps.googleusercontent.com`), sehingga build lokal dengan placeholder benar-benar terdeteksi sebagai `oauthConfigured: false`.
- **Jaminan autentikasi Google saat 0 tugas (`src/background/scanner.ts`)**:
  - `syncAssignmentsToGoogleCalendar(...)` **wajib memperoleh token Google OAuth lebih dulu** (`getToken(interactive)` — dapat diinjeksi lewat parameter opsional untuk pengujian) **sebelum** melakukan *early return* ketika `syncable.length === 0`.
  - Dengan demikian, memicu `SYNC_NOW` dari Popup maupun Onboarding dalam keadaan belum terhubung dengan 0 tugas *eligible* tidak pernah menulis `googleConnected: true` atau `lastSyncAt` tanpa autentikasi Google yang benar-benar berhasil.
- **Membedakan sesi SPADA kosong vs belum login (`src/background/scanner.ts` & `src/parsers/spada-html.ts`)**:
  - Menambah helper *pure* `isAuthenticatedSpadaDashboardHtml(html: string)` di `src/parsers/spada-html.ts` (mendeteksi penanda dashboard Moodle terautentikasi seperti `id="nav-drawer"`, `/login/logout.php`, atau `sesskey`, dengan syarat bukan halaman login).
  - Di `scanSpadaWithFetcher`: bila `/my/` tidak terdeteksi sebagai halaman login dan lolos `isAuthenticatedSpadaDashboardHtml(myHtml)`, tetapi `courses.length === 0` (mis. masa awal semester/KRS), fungsi **tidak melempar `AUTH_REQUIRED`** melainkan mengembalikan `{ courses: [], assignments: [] }`. Jika HTML bukan halaman terautentikasi, barulah melempar `AUTH_REQUIRED`.
- **Preservasi konteks error Google Calendar API (`src/calendar/google-calendar-rest.ts`)**:
  - Memperbarui `parseErrorResponse` dan `GoogleCalendarApiError` agar mengurai payload JSON error standar Google Calendar API (`error.errors[0].reason`, `error.message`, fallback ke teks mentah / `statusText`), menyimpan `public readonly reason?: string`, dan memformat `err.message` secara konsisten:
    - `GCAL HTTP <status> [<reason>]: <detail>` (atau `GCAL HTTP <status>: <detail>` bila `reason` tidak ada).
  - Dengan format ini, ketika `service-worker.ts` menyimpan `err.message` ke `lastSyncError`, informasi **layanan (`GCAL`)**, **HTTP status (`403`, `429`, `404`, `5xx`)**, dan **alasan Google (`rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded`, `insufficientPermissions`, dll.)** tidak pernah hilang sebelum sampai ke Popup/Onboarding dan `diagnoseSetupError`.

### 5.3. CLI Setup Helper (`scripts/setup-unpacked.mjs`) & Build/Package Scripts
- Fungsi *pure* yang di-export untuk TDD: `prepareUnpackedConfig(existingConfig, options: { clientId?: string; resetKey?: boolean; generatePublicKey?: () => string })`
  - Jika `existingConfig` sudah punya `publicKey` valid dan `resetKey !== true`, pertahankan `publicKey` lama (idempoten, aman dijalankan berulang kali).
  - Jika belum ada (atau `resetKey === true`), buat RSA-2048 keypair lewat `node:crypto`, ambil **hanya** `publicKey` format SPKI DER base64, buang private key di memori.
  - Hitung ulang `extensionId` dari `publicKey`.
  - *(Keputusan implementasi — anti-footgun rotasi key)*: Jika `options.clientId` diberikan, validasi format `*.apps.googleusercontent.com` sebelum menyimpan. Jika `options.clientId` tidak diberikan:
    - Apabila `resetKey === true`, **reset `clientId`** kembali ke placeholder `YOUR_UNPACKED_CLIENT_ID.apps.googleusercontent.com` (karena `clientId` lama pasti sudah tidak cocok dengan `extensionId` baru, mencegah ZIP rusak terpakai diam-diam).
    - Apabila `resetKey !== true`, pertahankan `existingConfig.clientId` yang ada atau isi placeholder jika belum ada.
- Eksekusi CLI (`npm run setup:unpacked [-- --client-id <id>] [-- --reset-key]`):
  - Membaca/menulis `config/unpacked-oauth.json`.
  - Menampilkan `Extension ID` stabil + checklist langkah Google Cloud Console yang spesifik + perintah selanjutnya (`npm run package:unpacked`).
- Pembaruan `scripts/build.mjs` & `scripts/package.mjs` + `package.json`:
  - `scripts/build.mjs` mendukung `--target=store` (default) dan `--target=unpacked`, menyuntikkan konstanta compile-time `__BUILD_TARGET__` (`"store"` atau `"unpacked"`) melalui esbuild `define`, serta mem-bundle entrypoint baru `onboarding/onboarding` (`src/onboarding/onboarding.ts`, `.html`, `.css`).
  - `scripts/package.mjs` mendukung `--target=unpacked` (output `release/spada-calendar-extension-unpacked-v<version>.zip`, validasi `target: "unpacked", strictOAuth: true`) dan default `--target=store` (output `release/spada-calendar-extension-v<version>.zip`).
  - `scripts/package.mjs` juga memverifikasi file `onboarding/onboarding.html` & `onboarding/onboarding.js` ada di `dist/`.
  - Script baru di `package.json`:
    - `setup:unpacked`: `node scripts/setup-unpacked.mjs`
    - `build:unpacked`: `node scripts/build.mjs --target=unpacked`
    - `package:unpacked`: `node scripts/package.mjs --target=unpacked`

### 5.4. Modul Status Kesiapan & Diagnostik Error (`src/setup/setup-diagnostics.ts`)
Modul *pure* TypeScript yang dipakai bersama oleh Onboarding dan Popup:
- `diagnoseSetupError(rawError: string): SetupErrorDiagnosis`
  - Mengembalikan `{ code, title, hint, rawMessage }` dengan urutan pencocokan **berbasis layanan, status HTTP, dan alasan spesifik terlebih dahulu** (sebelum pola generik, sehingga error SPADA tidak menghasilkan instruksi Google OAuth, rate limit Google Calendar 403 tidak mengirim mahasiswa ulang ke consent OAuth, dan `"OAuth2 request failed: access_denied"` tidak salah dikira mismatch Client ID):
    1. **Layanan SPADA (`SPADA HTTP ...`)**:
       - `SPADA HTTP 401` → `SPADA_AUTH_REQUIRED` (sesi SPADA habis/tidak terautentikasi).
       - `SPADA HTTP 403` → `SPADA_ACCESS_DENIED` (akses halaman SPADA ditolak — cek pendaftaran mata kuliah & sesi SPADA, **bukan** instruksi OAuth Google).
       - `SPADA HTTP <status lainnya>` → `NETWORK_OR_SERVER` (gangguan server SPADA).
    2. **Layanan Google Calendar (`GCAL HTTP ...`)**:
       - `GCAL HTTP 429` atau `GCAL HTTP 403` dengan alasan *rate limit* (`rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded`, `dailyLimitExceeded`, `calendarUsageLimitsExceeded`, atau teks `Rate Limit Exceeded`) → `GCAL_RATE_LIMITED` (*"Batas permintaan Google Calendar sementara tercapai — tunggu beberapa menit lalu coba Sync lagi"*, **bukan** instruksi consent OAuth).
       - `GCAL HTTP 403` lainnya (mis. `insufficientPermissions` / `forbidden`) → `OAUTH_ACCESS_DENIED` (minta putuskan lalu hubungkan ulang Google Calendar agar izin penuh diberikan).
       - `GCAL HTTP 404` → `GCAL_CALENDAR_NOT_FOUND` (Calendar ID tidak ditemukan — cek Pengaturan dan gunakan `primary`).
       - `GCAL HTTP 401` → `OAUTH_CANCELLED` (sesi/token Google perlu diperbarui — klik Hubungkan Google ulang).
       - `GCAL HTTP 5xx` → `NETWORK_OR_SERVER`.
    3. `AUTH_REQUIRED` → `SPADA_AUTH_REQUIRED`.
    4. `OAUTH_NOT_CONFIGURED` → `OAUTH_NOT_CONFIGURED`.
    5. Alasan spesifik OAuth (**sebelum** pola generik `OAuth2 request failed`):
       - `canceled`, `cancelled`, `did not approve`, `user_cancelled`, `OAuth2 not granted or revoked` → `OAUTH_CANCELLED`.
       - `access_denied`, `org_internal`, `unverified` (termasuk `"OAuth2 request failed: access_denied"`) → `OAUTH_ACCESS_DENIED` (tips *Advanced → Continue* / hubungi pembuat ekstensi bila akses/kuota diblokir).
       - `bad client id`, `invalid_client`, atau fallback `OAuth2 request failed` → `OAUTH_CLIENT_MISMATCH`.
    6. `getAuthToken` tidak didukung / user tidak sign-in profil Chrome → `BROWSER_UNSUPPORTED`.
    7. Rate limit teks generik (`Rate Limit Exceeded`, `rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded`, `Too Many Requests`) → `GCAL_RATE_LIMITED`.
    8. `Failed to fetch`, `NetworkError`, timeout, HTTP `5xx` → `NETWORK_OR_SERVER`.
    9. Fallback aman → `UNKNOWN` (menampilkan pesan asli + saran coba ulang).
- `evaluateSetupStatus(state: StoredExtensionState, oauthConfigured: boolean): SetupStatus`
  - *(Aturan transisi state, gating, & validasi auth)*:
    - Koneksi Google dianggap terverifikasi aktif hanya bila `isGoogleVerifiedConnected = state.googleConnected && state.googleAuthVerified`.
    - **Step 1 (`spada`)**: `"error"` jika `state.lastScanError !== null`; `"done"` jika `state.lastScanAt !== null` (meskipun `state.courses.length === 0`, agar mahasiswa yang sudah login di awal semester/KRS tidak terjebak di Langkah 1 — bila `courses.length === 0`, `detail` memberi catatan informatif bahwa sesi SPADA aktif namun belum ada mata kuliah aktif terdeteksi di dashboard dan tetap bisa lanjut ke Langkah 2); selain itu `"active"`.
    - **Step 2 (`google`)**: `"blocked"` jika `!oauthConfigured`; `"done"` jika `isGoogleVerifiedConnected`; `"error"` jika `!isGoogleVerifiedConnected && state.lastSyncError !== null`; `"active"` jika Step 1 `"done"`; selain itu `"pending"`.
    - **Step 3 (`firstSync`)** *(strictly gated pada Step 1 & Step 2)*: `"blocked"` jika `!oauthConfigured`; `"pending"` jika `!isGoogleVerifiedConnected`; `"error"` jika `isGoogleVerifiedConnected && state.lastSyncError !== null`; `"done"` jika `isGoogleVerifiedConnected && state.lastSyncAt !== null`; `"active"` jika Step 1 `"done"` dan Step 2 `"done"`; selain itu `"pending"`.
    - **`completedCount`**: jumlah langkah berstatus `"done"` (`0..3`).
    - **`overallReady`**: `true` hanya ketika ketiga langkah berstatus `"done"` (tanpa error aktif — digunakan Onboarding untuk status "Semua siap!").
    - **`hasCompletedInitialSetup`**: `Boolean(oauthConfigured && state.lastScanAt && isGoogleVerifiedConnected && state.lastSyncAt)` — tetap `true` saat terjadi error jaringan/sesi sementara sesudah setup pernah beres, sehingga Popup cukup menampilkan alert diagnostik ramah pengguna tanpa memaksa pengguna lama melihat banner "Panduan Setup" lagi (akan kembali `false` bila pengguna memutus koneksi Google, beralih akun Google sebelum sync pertama akun baru, gagal revalidasi state lama, atau menghapus data lokal).
    - **`nextStep`**: langkah pertama yang belum `"done"` sesuai urutan `spada -> google -> firstSync`, atau `"done"`.
  - Di UI Onboarding, tombol Step 3 (`Scan & Sync Pertama`) dinonaktifkan (`disabled`) hingga Step 1 dan Step 2 berstatus `"done"`.

### 5.5. Lifecycle Install, Revalidasi State, & Service Worker (`src/background/install-lifecycle.ts` & `src/background/service-worker.ts`)
- Modul helper dengan *dependency injection* (`src/background/install-lifecycle.ts`):
  - `handleExtensionInstalled(reason: string, deps)`:
    - Selalu menjadwalkan alarm auto-scan dan memperbarui badge.
    - Membuka tab `onboarding/onboarding.html` **hanya** ketika `reason === "install"` (berlaku di target `unpacked` maupun `store`).
    - Pada `reason === "update"`, menjalankan `revalidateLegacyGoogleAuth` bila state lama memiliki `googleConnected: true && !googleAuthVerified`.
  - `buildDisconnectedStatePatch()` *(helper pure)*: mengembalikan `{ googleConnected: false, googleAuthVerified: false, lastSyncAt: null, lastSyncSummary: null, lastSyncError: null }` sebagai satu-satunya sumber kebenaran saat memutus atau menginvalidasi koneksi Google.
  - `revalidateLegacyGoogleAuth(state, deps)` *(pure-ish helper dengan adapter `getSilentToken` & `updateState`)*:
    - Jika `!state.googleConnected || state.googleAuthVerified || !deps.oauthConfigured`: tidak melakukan apa-apa (kembalikan `state`).
    - Memanggil `getSilentToken()` (`chrome.identity.getAuthToken({ interactive: false })`):
      - Jika token diperoleh → tingkatkan state menjadi `{ googleAuthVerified: true }` (pengguna lama yang memang sudah terautentikasi tetap mulus tanpa perlu login ulang).
      - Jika token kosong atau gagal karena belum pernah disetujui / dicabut (`not granted`, `revoked`, `not signed in`, `no token`) → invalidasi state lama memakai `buildDisconnectedStatePatch()`.
      - Jika gagal karena error jaringan sementara (`Failed to fetch`, `network`, offline) → jangan hapus `lastSyncAt` maupun menandai `googleAuthVerified: true` (coba revalidasi lagi saat online).
- Di `src/background/service-worker.ts` & `src/shared/storage.ts`:
  - `StoredExtensionState` menambah field `googleAuthVerified: boolean` (default `false` bila tidak ada di storage lama).
  - `GET_STATE` menjalankan `revalidateLegacyGoogleAuth` terlebih dahulu sebelum mengembalikan state ke Onboarding/Popup.
  - `CONNECT_GOOGLE` sukses → set `{ googleConnected: true, googleAuthVerified: true, lastSyncError: null }`; bila gagal → simpan `{ lastSyncError: errorMessage }`.
  - `performSync` sukses (setelah token benar-benar diperoleh di `syncAssignmentsToGoogleCalendar`) → set `{ googleConnected: true, googleAuthVerified: true, lastSyncAt, lastSyncSummary, lastSyncError: null }`.
  - **`DISCONNECT_GOOGLE`** → **wajib menginvalidasi status penyelesaian sync** memakai `buildDisconnectedStatePatch()`. Dengan demikian, jika mahasiswa menyinkronkan Akun A → Putuskan → hubungkan Akun B, Langkah 3 kembali `"active"` (belum `"done"`) hingga Akun B benar-benar selesai disinkronkan.

### 5.6. Antarmuka Pengguna (Onboarding, Popup, Options)

#### Sketsa Halaman Onboarding (`src/onboarding/onboarding.html`)
```text
┌───────────────────────────────────────────────────────────┐
│  SPADA UPNYK Assignment Scanner — Setup Cepat (0/3)       │
│  Hubungkan SPADA UPNYK ke Google Calendar milikmu         │
├───────────────────────────────────────────────────────────┤
│  [1] Login ke SPADA UPNYK                      [Aktif]    │
│      Buka SPADA dan login seperti biasa di browser ini.   │
│      [ Buka SPADA ↗ ]   [ Cek Sesi SPADA ]                │
│      Status / Diagnosa Error                              │
├───────────────────────────────────────────────────────────┤
│  [2] Hubungkan Google Calendar               [Menunggu]   │
│      Jadwal tugas otomatis masuk ke kalendermu sendiri.   │
│      [ Hubungkan Google ]                                 │
│      Info*: Jika muncul "Google hasn't verified this app",│
│      klik Advanced → Go to SPADA UPNYK Assignment Scanner │
├───────────────────────────────────────────────────────────┤
│  [3] Sinkronisasi Pertama                    [Menunggu]   │
│      Kirim tenggat tugas aktif ke Google Calendar.        │
│      [ Scan & Sync Pertama ] (aktif setelah 1 & 2 beres)  │
│      Status / Ringkasan (+X baru, ~Y update, Z skip)      │
├───────────────────────────────────────────────────────────┤
│  Tips Penting:                                            │
│  • Pin ekstensi dari ikon puzzle Chrome agar mudah dibuka │
│  • Jangan hapus folder hasil ekstrak ekstensi ini*        │
│  • [ Buka Pengaturan ⚙️ ]                                 │
└───────────────────────────────────────────────────────────┘
*Hanya tampil pada build target "unpacked" (disembunyikan pada build "store").
```
- *(Keputusan implementasi — copy kondisional per target)*: `onboarding.ts` membaca `__BUILD_TARGET__` sehingga tips khusus mode unpacked (*"Jangan hapus folder hasil ekstrak"* dan catatan *"Google hasn't verified this app"*) hanya tampil di build `"unpacked"` dan disembunyikan di build `"store"`.
- `onboarding.ts` berkomunikasi memakai message bus yang sudah ada (`GET_STATE`, `SCAN_NOW`, `CONNECT_GOOGLE`, `SYNC_NOW`) dan merender semua teks dengan `.textContent`.
- `popup.ts`: menampilkan alert hasil `diagnoseSetupError()` + tombol ringkas **"Panduan Setup"** saat `!setupStatus.hasCompletedInitialSetup` yang membuka `onboarding/onboarding.html`.
- `options.html` & `options.ts`: menambah tombol **"Salin ID"** (clipboard dengan fallback status teks), tombol **"Buka Panduan Setup"**, dan memperbarui instruksi developer agar mengacu ke `npm run setup:unpacked`.
- `README.md`: diperbarui menjadi dua bagian tegas — panduan instalasi mahasiswa (3 langkah dari ZIP, tanpa Node.js/Google Cloud Console) dan panduan developer (`setup:unpacked` & `package:unpacked`).

---

## 6. Rencana Seams untuk TDD (*Pre-Agreed Test Seams*)

Sesuai pendekatan TDD (*red → green* per *vertical slice*), pengujian difokuskan pada 6 *seams* berikut (tidak menguji detail internal/private):

| # | Seam (Public Interface) | Yang Tertangkap oleh Test | Yang Tidak Tertangkap (Perlu Cek Manual) |
|---|---|---|---|
| 1 | `scripts/unpacked-manifest.mjs`: `deriveExtensionIdFromPublicKey`, `validateUnpackedConfig`, `buildManifestForTarget` | Salah hitung Extension ID Chromium, bocornya `"key"` ke build Store, mismatch `publicKey`/`extensionId`, atau `clientId` tidak valid | Validasi parser manifest asli di runtime Google Chrome |
| 2 | `scripts/validate-manifest.mjs`: `validateManifestForStore` (dengan opsi `target` & `disallowedClientIds`) | Regresi aturan CWS, Client ID unpacked yang tidak sengaja terpakai di build Store, serta paket unpacked tanpa `"key"`/`client_id` asli | Integritas file ZIP hasil `Compress-Archive` / `zip` |
| 3 | `scripts/setup-unpacked.mjs`: `prepareUnpackedConfig` | Rotasi `publicKey` tidak sengaja saat dijalankan ulang, stale `clientId` saat `--reset-key`, validasi `--client-id` salah | Formatting tampilan console/stdout CLI |
| 4 | `src/background/scanner.ts` & `src/calendar/google-calendar-rest.ts`: `isConfiguredOAuthClientId`, `scanSpadaWithFetcher`, `syncAssignmentsToGoogleCalendar`, `GoogleCalendarApiError` | Placeholder client ID yang lolos runtime, dashboard SPADA terautentikasi 0 mata kuliah yang salah dianggap `AUTH_REQUIRED`, `SYNC_NOW` 0 tugas tanpa autentikasi Google, serta hilangnya layanan/status/reason (`GCAL HTTP 403 [rateLimitExceeded]`) pada error Calendar API | Validasi kredensial aktual terhadap server OAuth Google (tercakup oleh acceptance check manual ZIP di fresh Chrome profile) |
| 5 | `src/setup/setup-diagnostics.ts`: `evaluateSetupStatus`, `diagnoseSetupError` | Salah transisi 3 langkah (termasuk 0 mata kuliah aktif, urutan sync Akun A → disconnect → connect Akun B, legacy `googleConnected` belum terverifikasi, error pasca-setup), serta salah pemetaan `SPADA HTTP 403`, `OAuth2 request failed: access_denied`, dan `GCAL HTTP 403 [rateLimitExceeded]` | Layout visual & responsivitas CSS halaman Onboarding |
| 6 | `src/background/install-lifecycle.ts`: `handleExtensionInstalled`, `revalidateLegacyGoogleAuth`, `buildDisconnectedStatePatch` | Tab onboarding tidak terbuka saat `"install"` atau spam saat `"update"`, state disconnect gagal mengosongkan `lastSyncAt`, serta revalidasi state legacy (token valid vs tidak diizinkan vs offline) | Event firing asli Chrome Service Worker saat Load Unpacked di browser |

---

## 7. Yang Diserahkan ke Implementer (*Left to Builder*)

- Detail visual minor CSS (spacing, warna badge tiap state langkah) selama konsisten dengan palet `#0f3d6e` / `#f8fafc` pada `popup.css` dan `options.css`.
- Penamaan pesan teks minor di tombol/copy selama jelas berbahasa Indonesia dan tidak menyebut detail teknis yang membingungkan mahasiswa.
- Cara menangani fallback clipboard di `options.ts` jika `navigator.clipboard` gagal.
