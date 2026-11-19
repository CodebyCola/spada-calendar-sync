# SPADA UPNYK Assignment Scanner (Chrome Extension MV3)

Ekstensi Google Chrome (Manifest V3) untuk memindai **semua tugas** di seluruh mata kuliah aktif pada **SPADA Wimaya UPN "Veteran" Yogyakarta** (`spada.upnyk.ac.id`) — **termasuk tugas yang tidak muncul di kalender Moodle / `.ics`** — beserta status pengumpulannya (`✅ Terkirim` vs `⏳ Belum`), lalu menyinkronkannya ke **Google Calendar** milikmu sendiri.

Ekstensi ini juga otomatis mengenali *event* yang dibuat oleh proyek pendamping `spada_calendar_sync` (versi CLI) sehingga keduanya bisa dipakai bersamaan tanpa membuat jadwal duplikat.

---

## Fitur Utama

- **Deteksi Tugas Menyeluruh:** Memindai seluruh mata kuliah aktif di SPADA UPNYK, termasuk tugas yang terlewat dari kalender bawaan Moodle (serta tetap berjalan aman saat dashboard SPADA kosong di awal semester/KRS).
- **Status Pengumpulan & Badge Counter:** Memisahkan tugas yang belum dikumpulkan dari yang sudah terkirim, lengkap dengan penghitung tugas tertunda pada ikon ekstensi.
- **Panduan Setup Otomatis (Onboarding 3 Langkah):** Terbuka otomatis saat pertama kali dipasang untuk mengecek sesi SPADA, menghubungkan Google Calendar dalam 1 klik, dan menjalankan sinkronisasi pertama.
- **Diagnostik Error Ramah Mahasiswa:** Membedakan kendala sesi SPADA, akses mata kuliah (HTTP 403), *rate limit* Google Calendar, OAuth, dan dukungan browser menjadi langkah perbaikan berbahasa Indonesia.
- **Sinkronisasi Google Calendar Anti-Duplikat:** Menambahkan tenggat tugas (WIB / `Asia/Jakarta`) beserta pengingat popup H-1 hari & H-3 jam, lalu otomatis memperbarui event saat tugas sudah dikumpulkan.
- **Privasi Terjaga:** 100% berjalan lokal di browser memakai sesi SPADA-mu sendiri; tidak ada backend server developer, tidak ada penyimpanan username/password SPADA, dan tidak pernah meminta `refresh token` manual.

---

## Untuk Mahasiswa — Cara Pasang dari ZIP (3 Langkah, Tanpa Node.js & Tanpa Google Cloud Console)

> Pastikan kamu menggunakan **Google Chrome** yang sudah login ke profil Chrome. Kamu **tidak perlu** menginstal Node.js, tidak perlu membuka Google Cloud Console, dan tidak perlu mengisi `refresh token` manual.

### Langkah 1: Download & Ekstrak ZIP
1. Download file rilis terbaru `spada-calendar-extension-unpacked-v*.zip` dari halaman [Releases](https://github.com/CodebyCola/spada-calendar-sync/releases).
2. Klik kanan file ZIP → **Extract All...** ke folder permanen (misalnya `Documents/spada-calendar-extension`).
   - **Penting:** Jangan hapus folder hasil ekstrak ini karena Chrome membaca ekstensi langsung dari folder tersebut.

### Langkah 2: Pasang di Google Chrome (*Load Unpacked*)
1. Buka `chrome://extensions` di Google Chrome.
2. Nyalakan sakelar **Developer mode** di pojok kanan atas.
3. Klik **Load unpacked** lalu pilih folder hasil ekstrak tadi (folder yang di dalamnya langsung ada file `manifest.json`).

### Langkah 3: Ikuti Panduan Setup Otomatis (3 Langkah)
Begitu terpasang, Chrome akan **otomatis membuka halaman Panduan Setup**:
1. **Login ke SPADA UPNYK:** Klik **Buka SPADA ↗**, login seperti biasa, lalu klik **Cek Sesi SPADA**.
2. **Hubungkan Google Calendar:** Klik **Hubungkan Google** dan pilih akun Google milikmu sendiri.
   - *Catatan:* Jika muncul layar peringatan *"Google hasn't verified this app"*, klik **Advanced** → **Go to SPADA UPNYK Assignment Scanner** untuk melanjutkan.
3. **Sinkronisasi Pertama:** Klik **Scan & Sync Pertama**. Semua tenggat tugas aktif otomatis masuk ke Google Calendar milikmu sendiri.
4. Klik ikon puzzle (🧩) di pojok kanan atas Chrome lalu **Pin** ekstensi ini agar mudah dibuka kapan saja.

---

## Untuk Developer — Menyiapkan Paket Unpacked (Sekali Saja)

Konfigurasi *Load Unpacked* disimpan di `config/unpacked-oauth.json` (masuk `.gitignore`; lihat contoh di [config/unpacked-oauth.example.json](config/unpacked-oauth.example.json)) agar kunci publik & Client ID milikmu tidak terpakai oleh *fork* di repo publik. **Simpan cadangan file `config/unpacked-oauth.json` jika suatu saat pindah laptop.**

### 1. Clone & Generate Stable Extension ID (Sekali Saja)
```bash
git clone https://github.com/CodebyCola/spada-calendar-sync.git
cd spada-calendar-sync
npm install
npm run setup:unpacked
```
Perintah ini membuat RSA-2048 *public key* (SPKI DER base64, tanpa menyimpan *private key* ke disk) dan menghitung **Stable Extension ID** 32 karakter yang identik di semua laptop mahasiswa.

### 2. Buat 1 OAuth Client ID di Google Cloud Console (Sekali Saja)
1. Buka [Google Cloud Console](https://console.cloud.google.com/), pastikan **Google Calendar API** aktif dan **OAuth consent screen** sudah diatur.
2. Masuk ke **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - **Application type:** pilih **Chrome Extension**
   - **Item ID:** tempel **Stable Extension ID** dari langkah 1.
3. Simpan `Client ID` ke konfigurasi lokal:
   ```bash
   npm run setup:unpacked -- --client-id <CLIENT_ID_DARI_GOOGLE>
   ```
   *(Menjalankan ulang `npm run setup:unpacked` bersifat idempoten dan tidak mengubah Extension ID. Gunakan `--reset-key` hanya jika ingin membuat Extension ID baru.)*

### 3. Build & Kemas ZIP Siap Bagikan
```bash
npm run package:unpacked
```
Hasilnya tersimpan di `release/spada-calendar-extension-unpacked-v<version>.zip` (dibangun di direktori staging temporer terisolasi sehingga aman dari konflik build paralel).
*(Untuk uji coba lokal cepat sebelum memasukkan `Client ID`, kamu juga bisa menjalankan `npm run build:unpacked` lalu Load Unpacked folder `dist/`.)*

### 4. Checklist Verifikasi Wajib Sebelum Membagikan ZIP ke Mahasiswa (*Unpacked Release Acceptance*)
Sebelum mengunggah `release/spada-calendar-extension-unpacked-v<version>.zip` ke GitHub Releases, lakukan verifikasi ini di **profil Chrome baru (*fresh profile*)**:
1. Ekstrak file ZIP final ke folder bersih (terpisah dari folder proyek).
2. Buka profil Chrome baru → `chrome://extensions` → nyalakan **Developer mode** → **Load unpacked** folder hasil ekstrak.
3. Pastikan **Extension ID** yang tampil di `chrome://extensions` **sama persis** dengan `extensionId` di `config/unpacked-oauth.json` dan Google Cloud Console.
4. Selesaikan halaman Onboarding yang otomatis terbuka (Langkah 1–3) termasuk **Hubungkan Google** memakai akun mahasiswa yang *eligible*, lalu pastikan event tugas muncul di Google Calendar akun tersebut.

---

## Pengujian & Perintah npm

```bash
npm test              # Jalankan seluruh unit & integration test (Vitest)
npm run typecheck     # Cek tipe TypeScript ketat (tsc --noEmit)
npm run build         # Build target Store ke dist/ (tanpa field "key")
npm run build:unpacked   # Build target Unpacked ke dist/ (memakai config/unpacked-oauth.json)
npm run package:unpacked # Kemas ZIP siap bagikan untuk mahasiswa (wajib OAuth valid)
npm run package:strict   # Kemas ZIP bersih untuk Chrome Web Store (wajib Store Client ID)
```

---

## Catatan Saat Publish ke Chrome Web Store

1. File [public/manifest.json](public/manifest.json) **khusus untuk Chrome Web Store** (tanpa field `"key"`). Saat Store menetapkan **Store Item ID** permanen, daftarkan OAuth Client ID (Chrome Extension) khusus untuk Store Item ID tersebut ke `public/manifest.json` (jangan memakai ulang Client ID unpacked).
2. Lihat panduan lengkap daftar isian toko, justifikasi izin, dan privasi di [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) serta [PRIVACY.md](PRIVACY.md).
3. Jalankan `npm test && npm run typecheck && npm run package:strict` untuk menghasilkan `release/spada-calendar-extension-v<version>.zip` yang bersih tanpa `"key"`.
4. Sebelum mempublikasikan ke semua pengguna, pasang versi Chrome Web Store (unlisted/testing) dan uji alur **Hubungkan Google** sampai berhasil.
