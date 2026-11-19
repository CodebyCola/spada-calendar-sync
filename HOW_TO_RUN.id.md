# Panduan Menjalankan dan Setup

Bahasa: [English](HOW_TO_RUN.md) | **Bahasa Indonesia**  
Ringkasan Proyek: [README.id.md](README.id.md) | [README.md](README.md)

---

## Instalasi Pengguna Akhir (Load Unpacked ZIP)

Prasyarat: **Google Chrome** yang sudah login ke profil Chrome. Pengguna akhir tidak memerlukan Node.js, Google Cloud Console, maupun konfigurasi `refresh token` manual.

### 1. Unduh dan Ekstrak Arsip Rilis
1. Unduh arsip terbaru `spada-calendar-extension-unpacked-v*.zip` dari halaman [GitHub Releases](https://github.com/CodebyCola/spada-calendar-sync/releases).
2. Ekstrak arsip tersebut ke direktori lokal yang permanen (misalnya `Documents/spada-calendar-extension`).
   - Jangan hapus direktori hasil ekstrak setelah pemasangan karena Chrome membaca ekstensi langsung dari lokasi tersebut.

### 2. Pasang Ekstensi di Chrome
1. Buka `chrome://extensions` di Google Chrome.
2. Aktifkan **Developer mode** di pojok kanan atas.
3. Pilih **Load unpacked** lalu pilih direktori hasil ekstrak yang memuat `manifest.json`.

### 3. Selesaikan Setup Awal
Setelah pemasangan, Chrome akan membuka halaman Panduan Setup tiga langkah secara otomatis:
1. **Verifikasi Sesi SPADA:** Buka `https://spada.upnyk.ac.id/my/`, login dengan akun mahasiswa, lalu klik **Cek Sesi SPADA**.
2. **Hubungkan Google Calendar:** Klik **Hubungkan Google** dan pilih akun Google pribadi Anda.
   - Jika Google menampilkan peringatan *"Google hasn't verified this app"*, pilih **Advanced** -> **Go to SPADA UPNYK Assignment Scanner**. Seluruh jadwal masuk langsung ke Google Calendar milik pengguna masing-masing.
3. **Sinkronisasi Pertama:** Klik **Scan & Sync Pertama** untuk menambahkan tenggat tugas aktif beserta pengingat popup 24 jam dan 3 jam sebelumnya.
4. Sematkan (*Pin*) ikon ekstensi dari menu ekstensi pada toolbar Chrome agar mudah diakses.

---

## Pengaturan dan Packaging Developer

### Prasyarat
- Node.js `>= 22` dan npm
- Google Chrome (diperlukan untuk `chrome.identity.getAuthToken`)

Konfigurasi OAuth untuk distribusi unpacked disimpan di `config/unpacked-oauth.json` (masuk `.gitignore`; template tersedia di [config/unpacked-oauth.example.json](config/unpacked-oauth.example.json)) agar kuota OAuth tidak terpakai oleh *fork* repositori publik. Simpan cadangan file `config/unpacked-oauth.json` jika berpindah perangkat.

### 1. Clone dan Inisialisasi Stable Extension ID (Sekali Saja)
```bash
git clone https://github.com/CodebyCola/spada-calendar-sync.git
cd spada-calendar-sync
npm install
npm run setup:unpacked
```
Perintah ini membuat kunci publik RSA-2048 SPKI DER (kunci privat dibuang di memori dan tidak pernah ditulis ke disk) serta menurunkan Extension ID 32 karakter yang deterministik dan identik di seluruh perangkat pengguna.

### 2. Daftarkan OAuth Client ID di Google Cloud Console (Sekali Saja)
1. Buka [Google Cloud Console](https://console.cloud.google.com/), aktifkan **Google Calendar API**, dan konfigurasikan **OAuth consent screen**.
2. Masuk ke **APIs & Services -> Credentials -> Create Credentials -> OAuth client ID**.
   - **Application type:** Chrome Extension
   - **Item ID:** masukkan Extension ID dari Langkah 1.
3. Simpan Client ID ke konfigurasi lokal:
   ```bash
   npm run setup:unpacked -- --client-id <CLIENT_ID_DARI_GOOGLE>
   ```
   Menjalankan ulang `npm run setup:unpacked` mempertahankan kunci yang sudah ada. Gunakan `--reset-key` hanya jika ingin merotasi Extension ID secara sengaja (opsi ini juga mereset `clientId` kembali ke placeholder).

### 3. Build dan Kemas ZIP Unpacked
```bash
npm run package:unpacked
```
Proses packaging berjalan pada direktori staging temporer terisolasi, menerapkan validasi ketat RSA-2048 SPKI dan OAuth non-placeholder, lalu menghasilkan `release/spada-calendar-extension-unpacked-v<version>.zip`.

Untuk build pengembangan lokal cepat ke `dist/` sebelum memasukkan `clientId` asli, jalankan `npm run build:unpacked`.

### 4. Checklist Verifikasi Rilis Unpacked
Sebelum mengunggah `release/spada-calendar-extension-unpacked-v<version>.zip` ke GitHub Releases:
1. Ekstrak ZIP final ke direktori bersih di luar repositori proyek.
2. Buka profil Google Chrome baru (*fresh profile*), buka `chrome://extensions`, aktifkan **Developer mode**, lalu muat direktori hasil ekstrak.
3. Pastikan Extension ID pada `chrome://extensions` identik dengan `extensionId` di `config/unpacked-oauth.json` dan Google Cloud Console.
4. Jalankan onboarding Langkah 1-3, termasuk otorisasi Google dengan akun mahasiswa yang memenuhi syarat, lalu pastikan event tugas tampil di Google Calendar akun tersebut.

---

## Daftar Perintah

| Perintah | Deskripsi |
|---|---|
| `npm test` | Menjalankan seluruh unit dan integration test Vitest. |
| `npm run typecheck` | Menjalankan pemeriksaan tipe TypeScript ketat (`tsc --noEmit`). |
| `npm run build` | Membangun target Chrome Web Store ke `dist/` (menghapus `"key"`). |
| `npm run build:unpacked` | Membangun target Unpacked ke `dist/` memakai `config/unpacked-oauth.json`. |
| `npm run setup:unpacked` | Menginisialisasi atau memperbarui `config/unpacked-oauth.json` (`--client-id`, `--reset-key`). |
| `npm run package` | Mengemas ZIP Store (memberi warning bila `client_id` masih placeholder). |
| `npm run package:strict` | Mengemas ZIP Store secara ketat (menolak placeholder atau `client_id` unpacked). |
| `npm run package:unpacked` | Mengemas ZIP Unpacked untuk mahasiswa (selalu ketat OAuth dan kunci RSA-2048 SPKI). |

---

## Rilis Chrome Web Store

1. [public/manifest.json](public/manifest.json) dikhususkan untuk build Chrome Web Store (tanpa field `"key"`). Daftarkan OAuth Client ID (Chrome Extension) terpisah untuk Store Item ID yang ditetapkan lalu simpan ke `public/manifest.json` (jangan memakai ulang Client ID unpacked).
2. Periksa metadata listing toko dan justifikasi izin pada [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).
3. Jalankan validasi dan buat arsip rilis Store:
   ```bash
   npm test && npm run typecheck && npm run package:strict
   ```
   Hasil: `release/spada-calendar-extension-v<version>.zip`.
4. Sebelum dipublikasikan ke Production, pasang build Store (unlisted/testing) dan verifikasi alur login Google Calendar hingga berhasil.
