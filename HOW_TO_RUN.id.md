# Panduan Menjalankan & Setup — SPADA UPNYK Assignment Scanner

> 🌐 **Bahasa:** [English](HOW_TO_RUN.md) | **Bahasa Indonesia**  
> 📘 **Ringkasan Proyek:** [README.id.md](README.id.md) | [README.md](README.md)

---

## Untuk Mahasiswa — Cara Pasang dari ZIP (3 Langkah, Tanpa Node.js & Tanpa Google Cloud Console)

> Pastikan kamu menggunakan **Google Chrome** yang sudah login ke profil Chrome. Kamu **tidak perlu** menginstal Node.js, tidak perlu membuka Google Cloud Console, dan tidak pernah perlu mengisi `refresh token` manual.

### Langkah 1: Download & Ekstrak ZIP
1. Download file rilis terbaru `spada-calendar-extension-unpacked-v*.zip` dari halaman [GitHub Releases](https://github.com/CodebyCola/spada-calendar-sync/releases).
2. Klik kanan file ZIP → **Extract All...** ke folder permanen (misalnya `Documents/spada-calendar-extension`).
   - **Penting:** Jangan hapus folder hasil ekstrak ini karena Chrome membaca ekstensi langsung dari folder tersebut.

### Langkah 2: Pasang di Google Chrome (*Load Unpacked*)
1. Buka `chrome://extensions` di Google Chrome.
2. Nyalakan sakelar **Developer mode** di pojok kanan atas.
3. Klik **Load unpacked** lalu pilih folder hasil ekstrak tadi (folder yang di dalamnya langsung ada file `manifest.json`).

### Langkah 3: Ikuti Panduan Setup Otomatis (3 Langkah)
Begitu terpasang, Chrome akan **otomatis membuka tab Panduan Setup**:
1. **Login ke SPADA UPNYK:** Klik **Buka SPADA ↗**, login dengan akun mahasiswamu seperti biasa, lalu klik **Cek Sesi SPADA**.
2. **Hubungkan Google Calendar:** Klik **Hubungkan Google** dan pilih akun Google milikmu sendiri.
   - *Catatan:* Jika muncul layar peringatan *"Google hasn't verified this app"*, klik **Advanced** → **Go to SPADA UPNYK Assignment Scanner** untuk melanjutkan. Semua jadwal masuk langsung ke **Google Calendar milikmu sendiri**.
3. **Sinkronisasi Pertama:** Klik **Scan & Sync Pertama**. Seluruh tenggat tugas aktif otomatis tersinkronisasi ke Google Calendar dengan pengingat popup H-1 hari & H-3 jam.
4. Klik ikon puzzle (🧩) di pojok kanan atas Chrome lalu **Pin** ekstensi ini agar mudah dibuka kapan saja.

---

## Untuk Developer — Menyiapkan Paket Unpacked (Sekali Saja)

### Prasyarat
- **Node.js >= 22** dan **npm**
- **Google Chrome** (untuk menguji `chrome.identity.getAuthToken`)

Konfigurasi distribusi *Load Unpacked* disimpan di `config/unpacked-oauth.json` (masuk `.gitignore`; lihat contoh di [config/unpacked-oauth.example.json](config/unpacked-oauth.example.json)) agar kunci publik & Client ID milikmu tidak terpakai oleh *fork* di repo publik. **Simpan cadangan file `config/unpacked-oauth.json` jika suatu saat pindah laptop.**

### 1. Clone & Generate Stable Extension ID (Sekali Saja)
```bash
git clone https://github.com/CodebyCola/spada-calendar-sync.git
cd spada-calendar-sync
npm install
npm run setup:unpacked
```
Perintah ini membuat RSA-2048 SPKI DER *public key* (*private key* langsung dibuang di memori dan tidak pernah disimpan ke disk) serta menghitung **Stable Extension ID** 32 karakter yang selalu sama di semua laptop mahasiswa.

### 2. Buat 1 OAuth Client ID di Google Cloud Console (Sekali Saja)
1. Buka [Google Cloud Console](https://console.cloud.google.com/), aktifkan **Google Calendar API**, dan atur **OAuth consent screen**.
2. Masuk ke **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - **Application type:** pilih **Chrome Extension**
   - **Item ID:** tempel **Stable Extension ID** dari langkah 1.
3. Simpan `Client ID` ke konfigurasi lokal:
   ```bash
   npm run setup:unpacked -- --client-id <CLIENT_ID_DARI_GOOGLE>
   ```
   *(Menjalankan ulang `npm run setup:unpacked` bersifat aman/idempoten dan tidak mengubah Extension ID. Gunakan `--reset-key` hanya jika memang sengaja ingin membuat Extension ID baru — flag tersebut otomatis me-reset `clientId` ke placeholder.)*

### 3. Build & Kemas ZIP Siap Bagikan
```bash
npm run package:unpacked
```
Perintah ini melakukan build di direktori staging temporer terisolasi, memvalidasi ketat public key RSA-2048 SPKI dan `clientId` non-placeholder, lalu menghasilkan:
- `release/spada-calendar-extension-unpacked-v<version>.zip`

*(Untuk uji coba lokal cepat ke folder `dist/` sebelum memasukkan `Client ID` asli, jalankan `npm run build:unpacked`.)*

### 4. Checklist Verifikasi Wajib Sebelum Membagikan ZIP (*Unpacked Release Acceptance*)
Sebelum mengunggah `release/spada-calendar-extension-unpacked-v<version>.zip` ke GitHub Releases:
1. Ekstrak file ZIP final ke folder bersih (terpisah dari folder proyek).
2. Buka **profil Chrome baru (*fresh profile*)** → `chrome://extensions` → nyalakan **Developer mode** → **Load unpacked** folder hasil ekstrak.
3. Pastikan **Extension ID** yang tampil di `chrome://extensions` **sama persis** dengan `extensionId` di `config/unpacked-oauth.json` dan Google Cloud Console.
4. Selesaikan halaman Onboarding yang otomatis terbuka (Langkah 1–3) termasuk **Hubungkan Google** memakai akun mahasiswa yang *eligible*, lalu pastikan event tugas muncul di Google Calendar akun tersebut.

---

## Perintah Pengembangan, Pengujian & Build

```bash
npm test                 # Jalankan seluruh unit & integration test (Vitest)
npm run typecheck        # Cek tipe TypeScript ketat (tsc --noEmit)
npm run build            # Build target Store ke dist/ (tanpa field "key")
npm run build:unpacked   # Build target Unpacked ke dist/ (memakai config/unpacked-oauth.json)
npm run package          # Kemas ZIP Store (mengizinkan placeholder dengan warning)
npm run package:strict   # Kemas ZIP Store ketat (menolak placeholder atau Client ID unpacked)
npm run package:unpacked # Kemas ZIP Unpacked untuk mahasiswa (selalu ketat OAuth + SPKI RSA-2048)
```

---

## Catatan Saat Publish ke Chrome Web Store

1. File [public/manifest.json](public/manifest.json) **khusus untuk Chrome Web Store** (tanpa field `"key"`). Saat Store menetapkan **Store Item ID** permanen, buat OAuth Client ID (Chrome Extension) khusus untuk Store Item ID tersebut dan pasang di `public/manifest.json` (jangan memakai ulang Client ID unpacked dari `config/unpacked-oauth.json`).
2. Lihat panduan lengkap daftar isian toko, justifikasi izin, dan privasi di [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).
3. Jalankan verifikasi dan buat arsip Store yang bersih:
   ```bash
   npm test && npm run typecheck && npm run package:strict
   ```
   Hasil: `release/spada-calendar-extension-v<version>.zip`.
4. Sebelum mempublikasikan ke Production, pasang versi Chrome Web Store (unlisted/testing) dan uji alur **Hubungkan Google** sampai berhasil dari instalasi Store tersebut.
