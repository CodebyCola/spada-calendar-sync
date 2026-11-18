# SPADA UPNYK Assignment Scanner (Chrome Extension MV3)

Ekstensi Chrome untuk memindai **semua tugas** di seluruh mata kuliah aktifmu pada **SPADA Wimaya UPN "Veteran" Yogyakarta** (`spada.upnyk.ac.id`) — **termasuk tugas yang tidak muncul di kalender Moodle / `.ics`** — beserta status pengumpulannya (`✅ Terkirim` vs `⏳ Belum`), lalu menyinkronkannya ke **Google Calendar**.

Ekstensi ini juga otomatis mengenali *event* yang dibuat oleh proyek pendamping [spada_calendar_sync](../../../Backend/spada_calendar_sync) sehingga keduanya bisa dipakai bersamaan tanpa membuat jadwal duplikat.

---

## Cara Setup & Uji Coba di Laptop (Mode *Load Unpacked*)

### Langkah 1: Build Ekstensi
```bash
npm install
npm run build
```
Perintah di atas menghasilkan folder siap pakai di `dist/`.

### Langkah 2: Pasang di Chrome
1. Buka `chrome://extensions` di Google Chrome.
2. Aktifkan sakelar **Developer mode** di pojok kanan atas.
3. Klik **Load unpacked** lalu pilih folder **`dist/`** di dalam proyek ini.
4. *(Langsung bisa dipakai untuk memindai SPADA!)* Buka tab `https://spada.upnyk.ac.id/` yang sudah login, lalu klik ikon ekstensi $\rightarrow$ **Scan SPADA**.

### Langkah 3: Hubungkan ke Google Calendar (Sekali Saja)
Agar tombol **Sync ke Calendar** aktif:
1. Salin **Extension ID** yang tampil pada kartu ekstensi di `chrome://extensions` (atau di halaman **Pengaturan ⚙️** ekstensi).
2. Buka [Google Cloud Console](https://console.cloud.google.com/) (boleh pakai project yang sama dengan `spada_calendar_sync`, pastikan **Google Calendar API** aktif).
3. Masuk ke **APIs & Services $\rightarrow$ Credentials $\rightarrow$ Create Credentials $\rightarrow$ OAuth client ID**.
   - **Application type:** pilih **Chrome Extension**
   - **Item ID:** tempel **Extension ID** tadi.
4. Salin `Client ID` yang diberikan Google, lalu tempel ke `public/manifest.json` pada bagian:
   ```json
   "oauth2": {
     "client_id": "PASTE_CLIENT_ID_DISINI.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/calendar.events"]
   }
   ```
5. Build ulang dan muat ulang ekstensi:
   ```bash
   npm run build
   ```
   Klik tombol **Reload (↻)** di `chrome://extensions`, buka popup ekstensi, lalu klik **Hubungkan Google** $\rightarrow$ **Sync ke Calendar**.

---

## Catatan Saat Publish ke Chrome Web Store

1. Lihat panduan lengkap daftar isian toko, justifikasi izin, dan privasi di [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md).
2. Saat sudah terbit di Chrome Web Store, Chrome Web Store menetapkan **Extension ID permanen** baru — buatlah *OAuth Client ID (Chrome Extension)* baru di Google Cloud Console menggunakan Store ID tersebut dan perbarui `public/manifest.json` sebelum rilis final (serta ubah status *OAuth consent screen* dari *Testing* ke *Production* agar seluruh mahasiswa bisa memakainya).
3. Untuk membuat arsip `.zip` unggahan toko, zip isi folder `dist/` saja (jangan sertakan `node_modules/`, `.git/`, atau `CHROMEWEBSTORE.md`).
