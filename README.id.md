# SPADA UPNYK Assignment Scanner

Bahasa: [English](README.md) | **Bahasa Indonesia**  
Panduan Setup dan Eksekusi: [HOW_TO_RUN.id.md](HOW_TO_RUN.id.md) | [HOW_TO_RUN.md](HOW_TO_RUN.md)

Ekstensi Google Chrome berbasis Manifest V3 untuk memindai seluruh tugas pada mata kuliah aktif di **SPADA Wimaya UPN "Veteran" Yogyakarta** (`spada.upnyk.ac.id`) — termasuk tugas yang tidak muncul di kalender bawaan Moodle maupun feed `.ics` — memantau status pengumpulan, dan menyinkronkan tenggat waktu ke Google Calendar pribadi pengguna.

Ekstensi ini kompatibel dengan metadata event milik proyek pendamping `spada_calendar_sync` (CLI) sehingga keduanya dapat digunakan bersamaan tanpa menghasilkan jadwal duplikat.

---

## Fitur Utama

- **Pemindaian Tugas Menyeluruh:** Mengambil daftar mata kuliah aktif dan memindai tabel `/mod/assign/index.php` di setiap mata kuliah, termasuk menangani dashboard awal semester/KRS yang masih kosong tanpa error autentikasi palsu.
- **Pelacakan Status Pengumpulan:** Memisahkan tugas yang belum dikumpulkan dan yang sudah terkirim, serta menampilkan jumlah tugas tertunda pada badge ikon ekstensi.
- **Onboarding Terpandu Saat Instalasi Pertama:** Membuka halaman setup tiga langkah secara otomatis setelah pemasangan pertama untuk memverifikasi sesi SPADA, menghubungkan Google Calendar, dan menjalankan sinkronisasi awal.
- **Diagnostik Error Berbasis Layanan:** Membedakan sesi SPADA habis, SPADA HTTP 403, batas permintaan (*rate limit*) Google Calendar, kendala izin OAuth, dan browser yang tidak didukung menjadi langkah perbaikan yang spesifik.
- **Sinkronisasi Google Calendar Idempoten:** Menyimpan tenggat dalam zona waktu `Asia/Jakarta` (WIB) dengan pengingat popup 24 jam dan 3 jam sebelumnya, serta memperbarui event secara otomatis setelah tugas dikumpulkan.
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
| `identity` | Meminta token akses Google OAuth 2.0 melalui login Chrome (hanya scope `calendar.events`). |
| `https://spada.upnyk.ac.id/*` | Membaca tautan mata kuliah aktif dan tabel `/mod/assign/index.php` memakai sesi SPADA aktif. |
| `https://www.googleapis.com/*` | Membaca, membuat, dan memperbarui event tugas pada Google Calendar pengguna. |

Rincian lengkap tersedia di [PRIVACY.md](PRIVACY.md).

---

## Lisensi

Proyek ini dirilis di bawah **MIT License** — Copyright (c) 2026 Nicolaus Narindra Lianto. Lihat [LICENSE](LICENSE) untuk ketentuan lengkapnya.
