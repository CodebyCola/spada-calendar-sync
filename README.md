# SPADA UPNYK Assignment Scanner (Chrome Extension MV3)

Ekstensi Chrome untuk memindai **semua tugas** di seluruh mata kuliah aktifmu pada **SPADA Wimaya UPN "Veteran" Yogyakarta** (`spada.upnyk.ac.id`) — **termasuk tugas yang tidak muncul di kalender Moodle / `.ics`** — beserta status pengumpulannya (`✅ Terkirim` vs `⏳ Belum`), lalu menyinkronkannya ke **Google Calendar** milikmu sendiri.

Ekstensi ini juga otomatis mengenali *event* yang dibuat oleh proyek pendamping [spada_calendar_sync](../../../Backend/spada_calendar_sync) sehingga keduanya bisa dipakai bersamaan tanpa membuat jadwal duplikat.

---

## Untuk Mahasiswa — Cara Pasang dari ZIP (3 Langkah, Tanpa Node.js & Tanpa Google Cloud Console)

> Pastikan kamu menggunakan **Google Chrome** yang sudah login ke profil Chrome. Kamu **tidak perlu** menginstal Node.js, tidak perlu membuka Google Cloud Console, dan tidak perlu mengisi `refresh token` manual.

### Langkah 1: Download & Ekstrak ZIP
1. Download file rilis `spada-calendar-extension-unpacked-v*.zip`.
2. Klik kanan file ZIP $\rightarrow$ **Extract All...** ke folder permanen (misalnya `Documents/spada-calendar-extension`).
   - **Penting:** Jangan hapus folder hasil ekstrak ini karena Chrome membaca ekstensi langsung dari folder tersebut.

### Langkah 2: Pasang di Google Chrome (*Load Unpacked*)
1. Buka `chrome://extensions` di Google Chrome.
2. Nyalakan sakelar **Developer mode** di pojok kanan atas.
3. Klik **Load unpacked** lalu pilih folder hasil ekstrak tadi (folder yang di dalamnya langsung ada file `manifest.json`).

### Langkah 3: Ikuti Panduan Setup Otomatis (3 Langkah)
Begitu terpasang, Chrome akan **otomatis membuka halaman Panduan Setup**:
1. **Login ke SPADA UPNYK:** Klik **Buka SPADA ↗**, login seperti biasa, lalu klik **Cek Sesi SPADA**.
2. **Hubungkan Google Calendar:** Klik **Hubungkan Google** dan pilih akun Google milikmu sendiri.
   - *Catatan:* Jika muncul layar peringatan *"Google hasn't verified this app"*, klik **Advanced** $\rightarrow$ **Go to SPADA UPNYK Assignment Scanner** untuk melanjutkan.
3. **Sinkronisasi Pertama:** Klik **Scan & Sync Pertama**. Semua tenggat tugas aktif otomatis masuk ke Google Calendar milikmu sendiri dengan pengingat H-1 hari & H-3 jam.
4. Klik ikon puzzle (🧩) di pojok kanan atas Chrome lalu **Pin** ekstensi ini agar mudah dibuka kapan saja.

---

## Untuk Developer — Menyiapkan Paket Unpacked (Sekali Saja)

Konfigurasi *Load Unpacked* disimpan di `config/unpacked-oauth.json` (masuk `.gitignore`; lihat contoh di [config/unpacked-oauth.example.json](config/unpacked-oauth.example.json)) agar kunci & Client ID milikmu tidak terpakai oleh *fork* di repo publik. **Simpan cadangan file `config/unpacked-oauth.json` jika suatu saat pindah laptop.**

### 1. Generate Stable Extension ID (Sekali Saja)
```bash
npm install
npm run setup:unpacked
```
Perintah ini membuat RSA-2048 *public key* (tanpa menyimpan *private key* ke disk) dan menghitung **Stable Extension ID** 32 karakter yang identik di semua laptop mahasiswa.

### 2. Buat 1 OAuth Client ID di Google Cloud Console (Sekali Saja)
1. Buka [Google Cloud Console](https://console.cloud.google.com/), pastikan **Google Calendar API** aktif dan **OAuth consent screen** sudah diatur.
2. Masuk ke **APIs & Services $\rightarrow$ Credentials $\rightarrow$ Create Credentials $\rightarrow$ OAuth client ID**.
   - **Application type:** pilih **Chrome Extension**
   - **Item ID:** tempel **Stable Extension ID** dari langkah 1.
3. Simpan `Client ID` ke konfigurasi lokal:
   ```bash
   npm run setup:unpacked -- --client-id <CLIENT_ID_DARI_GOOGLE>
   ```
   *(Catatan: menjalankan ulang `npm run setup:unpacked` aman dan tidak akan mengubah Extension ID. Gunakan `--reset-key` hanya jika memang ingin membuat Extension ID baru.)*

### 3. Build & Kemas ZIP Siap Bagikan
```bash
npm run package:unpacked
```
Hasilnya tersimpan di `release/spada-calendar-extension-unpacked-v<version>.zip`.
*(Untuk uji coba lokal cepat sebelum memasukkan `Client ID`, kamu juga bisa menjalankan `npm run build:unpacked` lalu Load Unpacked folder `dist/`.)*

### 4. Checklist Verifikasi Wajib Sebelum Membagikan ZIP ke Mahasiswa (*Unpacked Release Acceptance*)
Sebelum membagikan `release/spada-calendar-extension-unpacked-v<version>.zip`, wajib lakukan verifikasi ini di **profil Chrome baru (*fresh profile*)**:
1. Ekstrak file ZIP final ke folder bersih (terpisah dari folder proyek).
2. Buka profil Chrome baru $\rightarrow$ `chrome://extensions` $\rightarrow$ nyalakan **Developer mode** $\rightarrow$ **Load unpacked** folder hasil ekstrak.
3. Pastikan **Extension ID** yang tampil di `chrome://extensions` **sama persis** dengan `extensionId` di `config/unpacked-oauth.json` dan Google Cloud Console.
4. Selesaikan halaman Onboarding yang otomatis terbuka (Langkah 1–3) termasuk **Hubungkan Google** memakai akun mahasiswa yang *eligible*, lalu pastikan event tugas muncul di Google Calendar akun tersebut.

---

## Catatan Saat Publish ke Chrome Web Store

1. File `public/manifest.json` **khusus untuk Chrome Web Store** (tanpa field `"key"`). Saat Store menetapkan **Store Item ID** permanen, daftarkan OAuth Client ID (Chrome Extension) khusus untuk Store Item ID tersebut ke `public/manifest.json` (jangan pakai Client ID unpacked).
2. Lihat panduan lengkap daftar isian toko, justifikasi izin, dan privasi di [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).
3. Jalankan `npm test && npm run typecheck && npm run package:strict` untuk menghasilkan `release/spada-calendar-extension-v<version>.zip` yang bersih tanpa `"key"`.
4. Sebelum mempublikasikan ke semua pengguna, pasang versi Chrome Web Store (unlisted/testing) dan uji alur **Hubungkan Google** sampai berhasil.
