# SPADA UPNYK Assignment Scanner (Chrome Extension MV3)

> 🌐 **Bahasa:** [English](README.md) | **Bahasa Indonesia**  
> 🚀 **Panduan Pasang & Menjalankan:** [HOW_TO_RUN.id.md](HOW_TO_RUN.id.md) | [HOW_TO_RUN.md](HOW_TO_RUN.md)

Ekstensi Google Chrome (Manifest V3) untuk memindai **semua tugas** di seluruh mata kuliah aktif pada **SPADA Wimaya UPN "Veteran" Yogyakarta** (`spada.upnyk.ac.id`) — **termasuk tugas yang tidak muncul di kalender bawaan Moodle / `.ics`** — beserta status pengumpulannya (`✅ Terkirim` vs `⏳ Belum`), lalu menyinkronkannya ke **Google Calendar** milikmu sendiri.

Ekstensi ini juga otomatis mengenali *event* yang dibuat oleh proyek pendamping `spada_calendar_sync` (versi CLI) sehingga keduanya bisa dipakai bersamaan tanpa membuat jadwal duplikat.

---

## Fitur Utama

- **Deteksi Tugas Menyeluruh:** Memindai seluruh mata kuliah aktif di SPADA UPNYK, termasuk tugas yang terlewat dari kalender bawaan Moodle (serta tetap berjalan aman saat dashboard SPADA masih kosong di awal semester/KRS).
- **Status Pengumpulan & Badge Counter:** Memisahkan tugas yang belum dikumpulkan dari yang sudah terkirim, lengkap dengan penghitung tugas tertunda pada ikon ekstensi.
- **Panduan Setup Otomatis (Onboarding 3 Langkah):** Terbuka otomatis saat pertama kali dipasang untuk mengecek sesi SPADA, menghubungkan Google Calendar dalam 1 klik, dan menjalankan sinkronisasi pertama.
- **Diagnostik Error Ramah Mahasiswa:** Membedakan sesi SPADA habis, akses mata kuliah ditolak (SPADA HTTP 403), *rate limit* Google Calendar, error OAuth, dan browser yang tidak didukung menjadi langkah perbaikan berbahasa Indonesia.
- **Sinkronisasi Google Calendar Anti-Duplikat:** Menambahkan tenggat tugas (WIB / `Asia/Jakarta`) dengan pengingat popup H-1 hari & H-3 jam, lalu otomatis memperbarui event saat tugas sudah dikumpulkan.
- **Privasi Terjaga:** Berjalan 100% lokal di browser memakai sesi SPADA-mu sendiri. Tidak ada backend server developer, tidak ada penyimpanan username/password SPADA, dan tidak pernah meminta input `refresh token` manual.

---

## Tautan Cepat

- **Untuk Mahasiswa (Pasang 3 langkah dari ZIP — tanpa Node.js & tanpa Google Cloud Console):** [HOW_TO_RUN.id.md — Untuk Mahasiswa](HOW_TO_RUN.id.md#untuk-mahasiswa--cara-pasang-dari-zip-3-langkah-tanpa-nodejs--tanpa-google-cloud-console)
- **Untuk Developer (Build unpacked, setup OAuth & packaging):** [HOW_TO_RUN.id.md — Untuk Developer](HOW_TO_RUN.id.md#untuk-developer--menyiapkan-paket-unpacked-sekali-saja)
- **Daftar Isian & Catatan Chrome Web Store:** [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md)
- **Kebijakan Privasi:** [PRIVACY.md](PRIVACY.md)

---

## Struktur Proyek

```text
├── config/
│   └── unpacked-oauth.example.json   # Template config OAuth unpacked lokal (file asli di-gitignore)
├── public/
│   ├── manifest.json                 # Manifest MV3 khusus Chrome Web Store (tanpa field "key")
│   └── icons/                        # Ikon ekstensi 16px, 48px, 128px
├── scripts/
│   ├── setup-unpacked.mjs            # Membuat public key RSA-2048 & Stable Extension ID
│   ├── unpacked-manifest.mjs         # Validasi ketat RSA-2048 SPKI & komposer manifest dual-target
│   ├── validate-manifest.mjs         # Validator manifest target Store & Unpacked
│   ├── build.mjs                     # Bundler esbuild dual-target (store / unpacked)
│   └── package.mjs                   # Packager ZIP dengan direktori staging terisolasi
├── src/
│   ├── background/                   # Service worker, scanner SPADA, install lifecycle & session guard
│   ├── calendar/                     # Client Google Calendar REST API v3
│   ├── content/                      # Content script pemantau mata kuliah aktif di SPADA
│   ├── onboarding/                   # Halaman Panduan Setup 3 langkah otomatis saat fresh install
│   ├── options/                      # Halaman Pengaturan & tombol Salin Extension ID
│   ├── parsers/                      # Parser HTML SPADA Moodle, tenggat, & status pengumpulan
│   ├── popup/                        # Antarmuka popup ikon ekstensi
│   ├── setup/                        # State machine kesiapan setup & diagnostik error
│   ├── shared/                       # Store chrome.storage.local terserialisasi
│   └── sync/                         # Formatter event & perencana diff anti-duplikat
└── tests/                            # Suite unit & integration test (Vitest)
```

---

## Izin & Privasi

| Izin / Host | Tujuan |
|---|---|
| `storage` | Menyimpan cache daftar tugas, status sync, dan preferensi pengguna secara lokal di Chrome. |
| `alarms` | Menjadwalkan pemindaian otomatis tiap 3 jam selama Chrome terbuka. |
| `identity` | Meminta token Google OAuth 2.0 melalui login Chrome (hanya scope `calendar.events`). |
| `https://spada.upnyk.ac.id/*` | Membaca daftar mata kuliah aktif dan halaman `/mod/assign/index.php` memakai sesi login SPADA-mu. |
| `https://www.googleapis.com/*` | Mendaftar, membuat, dan memperbarui event tugas langsung pada Google Calendar milikmu. |

Lihat [PRIVACY.md](PRIVACY.md) untuk kebijakan privasi lengkap.

---

## Lisensi

Dirilis di bawah lisensi pada berkas [LICENSE](LICENSE).
