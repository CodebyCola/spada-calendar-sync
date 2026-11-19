# SPADA UPNYK Assignment Scanner

Bahasa: [English](README.md) | **Bahasa Indonesia**  
Panduan Setup dan Eksekusi: [HOW_TO_RUN.id.md](HOW_TO_RUN.id.md) | [HOW_TO_RUN.md](HOW_TO_RUN.md)

Ekstensi Google Chrome berbasis Manifest V3 untuk memindai seluruh tugas pada mata kuliah aktif di **SPADA Wimaya UPN "Veteran" Yogyakarta** (`spada.upnyk.ac.id`) — termasuk tugas yang tidak muncul di kalender bawaan Moodle maupun feed `.ics` — memantau status pengumpulan, dan menyinkronkan tenggat waktu ke Google Calendar pribadi pengguna.

Ekstensi ini kompatibel dengan metadata event milik proyek pendamping `spada_calendar_sync` (CLI) sehingga keduanya dapat digunakan bersamaan tanpa menghasilkan jadwal duplikat.

---

## Fitur Utama

- **Pemindaian Tugas Menyeluruh:** Mengambil daftar mata kuliah aktif dan memindai tabel `/mod/assign/index.php` di setiap mata kuliah, termasuk menangani dashboard awal semester/KRS yang masih kosong tanpa error autentikasi palsu.
- **Filter Tampilan Popup & Waktu Relatif WIB:** Saring daftar tugas di popup berdasarkan mata kuliah, status (`Belum`, `Terkirim`, `Semua`), dan waktu lokal (`Semua waktu`, `Mendatang`, `Sudah lewat`) tanpa mengubah aturan sinkronisasi latar belakang. Setiap kartu menampilkan hitung mundur kalender WIB (`Asia/Jakarta`) dan status kelayakan sync.
- **Aturan Filter Sync & Lifecycle Update:** Atur tugas yang dibuatkan event baru menurut rentang waktu (`upcoming_only`, `recent_7d`, `all`), status pengumpulan (`pending_only`, `submitted_only`, `all`), dan daftar pengecualian mata kuliah. Event yang sudah pernah dibuat tetap diperbarui (misalnya dari tertunda menjadi selesai) walau status barunya berada di luar filter buat event baru, tanpa menghapus event di kalender.
- **Pratinjau Jumlah Kandidat Sync:** Menampilkan jumlah global kandidat event baru dari scan terakhir pada tombol Sync, tidak berubah saat pengguna mengganti filter tampilan lokal popup.
- **Kustomisasi Pengingat & Warna Event:** Pilih hingga 5 preset pengingat popup (atau matikan pengingat) untuk tugas tertunda serta warna event Google Calendar (`colorId`) terpisah untuk tugas belum dan sudah dikumpulkan.
- **Pemilih Google Calendar & Fallback ID Manual:** Memuat daftar kalender yang dapat ditulisi di halaman Options (setelah izin diberikan) atau tetap menggunakan input Calendar ID manual saat offline maupun bila izin daftar kalender belum disetujui.
- **Onboarding Terpandu & Diagnostik Berbasis Layanan:** Membuka halaman setup tiga langkah pada pemasangan pertama serta mengklasifikasikan kendala sesi SPADA, HTTP 403/429, izin OAuth, dan browser yang tidak didukung menjadi langkah perbaikan yang jelas.
- **Arsitektur Lokal Tanpa Backend:** Berjalan sepenuhnya di browser menggunakan sesi SPADA pengguna. Tidak ada server backend developer, tidak ada penyimpanan kredensial SPADA, dan tidak memerlukan konfigurasi `refresh token` manual.

---

## Tech Stack

| Lapisan | Teknologi |
|---|---|
| Platform Ekstensi | Chrome Extensions Manifest V3 (Service Worker, Content Script, Popup, Options, Onboarding) |
| Bahasa | TypeScript 5.6 (`strict`, ESM) |
| Antarmuka | Vanilla HTML5, CSS3, DOM API standar (tanpa dependensi framework UI runtime) |
| Bundler & Skrip | esbuild 0.24, Node.js (>= 22) |
| Pengujian | Vitest 2.1 |
| Integrasi | Chrome Identity API (`chrome.identity`), Google Calendar REST API v3, HTML Moodle SPADA |

---

## Dokumentasi

- **Instalasi Pengguna Akhir (ZIP, tanpa Node.js dan tanpa Google Cloud Console):** [HOW_TO_RUN.id.md](HOW_TO_RUN.id.md#instalasi-pengguna-akhir-load-unpacked-zip)
- **Pengaturan Developer, Packaging, dan Verifikasi Rilis:** [HOW_TO_RUN.id.md](HOW_TO_RUN.id.md#pengaturan-dan-packaging-developer)
- **Metadata Listing Chrome Web Store:** [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)
- **Kebijakan Privasi:** [PRIVACY.md](PRIVACY.md)

---

## Struktur Proyek

```text
├── config/
│   └── unpacked-oauth.example.json   # Template konfigurasi OAuth unpacked (file asli di-gitignore)
├── public/
│   ├── manifest.json                 # Manifest MV3 khusus Chrome Web Store (tanpa field "key")
│   └── icons/                        # Ikon ekstensi (16px, 48px, 128px)
├── scripts/
│   ├── setup-unpacked.mjs            # Generator public key RSA-2048 SPKI dan Stable Extension ID
│   ├── unpacked-manifest.mjs         # Validator RSA-2048 SPKI dan komposer manifest dual-target
│   ├── validate-manifest.mjs         # Aturan validasi manifest target Store dan Unpacked
│   ├── build.mjs                     # Bundler esbuild dual-target (store / unpacked)
│   └── package.mjs                   # Packager ZIP dengan direktori staging terisolasi
├── src/
│   ├── background/                   # Service worker, scanner SPADA, lifecycle dan session guard
│   ├── calendar/                     # Client Google Calendar REST API v3
│   ├── content/                      # Observer DOM mata kuliah aktif SPADA
│   ├── onboarding/                   # Halaman panduan setup tiga langkah
│   ├── options/                      # Halaman pengaturan dan penyalinan Extension ID
│   ├── parsers/                      # Parser HTML, tanggal, dan status tugas Moodle SPADA
│   ├── popup/                        # Antarmuka popup toolbar
│   ├── setup/                        # Evaluasi kesiapan setup dan diagnostik error
│   ├── shared/                       # Lapisan state chrome.storage.local terserialisasi
│   └── sync/                         # Formatter event dan perencana diff
└── tests/                            # Suite unit dan integration test (Vitest)
```

---

## Izin dan Akses Data

| Izin / Host | Tujuan |
|---|---|
| `storage` | Menyimpan ringkasan hasil scan, status sinkronisasi, dan preferensi pengguna secara lokal. |
| `alarms` | Menjadwalkan pemindaian latar belakang setiap 3 jam selama Chrome berjalan. |
| `identity` | Meminta token akses Google OAuth 2.0 per operasi melalui login Chrome: `calendar.events` untuk sinkronisasi event tugas, dan `calendar.calendarlist.readonly` opsional untuk memuat nama/ID kalender yang dapat ditulisi di Options. |
| `https://spada.upnyk.ac.id/*` | Membaca tautan mata kuliah aktif dan tabel `/mod/assign/index.php` memakai sesi SPADA aktif. |
| `https://www.googleapis.com/*` | Memuat daftar kalender di perangkat untuk pemilihan kalender tujuan, serta membaca, membuat, dan memperbarui event tugas pada Google Calendar pilihan pengguna. |

Rincian lengkap tersedia di [PRIVACY.md](PRIVACY.md).

---

## Lisensi

Proyek ini dirilis di bawah **MIT License** — Copyright (c) 2026 Nicolaus Narindra Lianto. Lihat [LICENSE](LICENSE) untuk ketentuan lengkapnya.
