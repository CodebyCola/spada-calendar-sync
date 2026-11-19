# Implementation plan · Filter tugas dan preferensi Google Calendar

**Untuk pelaksana:** gunakan alur `executing-plans` untuk mengerjakan checklist secara berurutan. Baca [spec dan matriks AC1–AC10](../specs/2026-11-19-assignment-filters-calendar-design.md) sebelum mengubah kode. Baseline perencanaan adalah main pada e7c6c87. Periksa diff jika HEAD sudah bergerak.

**Tujuan** · Mengirim tiga tahap yang bisa diuji sendiri. Tahap I mencakup filtering dan A, tahap II menambahkan B, tahap III menambahkan D. Tahap I dan II tetap dapat dipakai dengan grant OAuth v1.0.0.

**Arsitektur** · Tipe dan normalisasi preferensi menjadi kontrak storage/worker. Satu evaluator murni menentukan kelayakan per tugas. Planner menggabungkan keputusan tersebut dengan event remote. Options mengirim pesan worker, Popup membaca snapshot, dan semua token serta penulisan state tetap di worker. Gunakan TypeScript, esbuild, Vitest, DOM dan Chrome MV3 yang sudah dipakai repo.

## Sebelum memulai

- [ ] Periksa `git status --short --branch`, `git rev-parse --short HEAD`, serta `package.json`. Pakai versi Node proyek dan dependensi dari lockfile (`npm ci` jika belum terpasang).
- [ ] Jalankan `npm test` dan `npm run typecheck`. Catat kegagalan baseline secara terpisah. Periksa pemanggil dengan `rg -n "filterSyncableAssignments|computeExtensionSyncPlan|formatScannedAssignment|includePastAssignments|syncSubmitted|getAuthToken|SAVE_SETTINGS" src tests`.
- [ ] Pada tiap tugas, jalankan test baru sekali untuk memastikan perilaku yang diminta memang belum ada, implementasikan, lalu jalankan ulang test terfokus dan typecheck. Akhiri tiap tahap dengan suite penuh. Pertahankan guard generasi, normalisasi legacy, validasi dua target paket, dan autentikasi jalur nol tugas.

## Tahap I · Filtering dan Feature A

### Tugas 1 · Membaca preferensi v1 dan menyimpan aturan baru — AC1

**File:** buat `src/shared/settings.ts` dan `tests/settings.test.ts`; integrasikan di `src/shared/storage.ts`, `src/background/install-lifecycle.ts`, `src/options/options.ts`, `src/options/options.html`, serta konsumen tipe di scanner dan test. Gunakan kembali ekspor tipe/default lewat storage bila dibutuhkan caller lama.

- [ ] Buat `TimeFilter`, `StatusFilter`, dan `normalizeSettings(raw: unknown): ExtensionSettings`. Mulai dengan field tahap I plus dua field lama yang tetap dipakai (`calendarId`, `autoSyncOnVisit`). Enum menggantikan `includePastAssignments` dan `syncSubmitted` pada objek kanonis. Field warna/reminder baru masuk di tugas 5.
- [ ] Uji input kosong, empat kombinasi boolean lama, enum baru + boolean konflik, enum rusak + boolean lama valid, array ID duplikat, ID yang belum muncul di scan, dan default reset. Tambahkan satu test membaca data v1 melalui `getStoredState`, menyimpan lewat `runSaveSettings`, lalu membacanya ulang. Assert histori dan generasi tetap utuh. Jalankan `npm test -- tests/settings.test.ts tests/install-lifecycle.test.ts`.
- [ ] Gunakan normalisasi pada pembacaan `spadaScannerState.settings` dan default pada clear. Untuk save, validasi tipe/nilai dari pesan sebelum mutasi. Bangun payload kanonis lengkap; pastikan proses merge di `mutateStoredState` tidak memasukkan kembali boolean legacy. Jika halaman Options lama masih mengirim bentuk v1 sesudah update, normalisasi boolean yang dikirim dan pertahankan preferensi baru yang tidak dikirim.
- [ ] Ganti dua checkbox lama di Options dengan select waktu/status dan daftar checkbox pengecualian menurut course ID. Render gabungan course yang terlihat dan ID dikecualikan yang masih tersimpan. Gunakan ID sebagai fallback label. Hanya tombol Simpan menulis ke worker. Nonaktifkan input dan Simpan sampai GET_STATE berhasil; jika gagal, beri aksi muat ulang. Uji lewat adapter pesan bahwa form lama yang belum termuat tidak dapat mengirim nilai default.
- [ ] Adaptasi caller filter ke bentuk settings baru dalam tahap ini; tugas 2 menyelesaikan seluruh semantik planner sebelum tahap I dirilis. Perbarui fixture yang memakai settings lengkap; gunakan `DEFAULT_SETTINGS` dengan override relevan.

### Tugas 2 · Evaluator dan keputusan planner — AC2–AC4

**File:** `src/sync/formatter-and-diff.ts`, `tests/sync-diff.test.ts`. Gunakan satu evaluator untuk worker dan Popup. Referensi tanggal aktual adalah `ScannedAssignment.dueDateIso`.

- [ ] Definisikan `evaluateAssignmentForSync(assignment, settings, nowMs)` dengan hasil bertipe `{ mode: "ignore" | "existing_only" | "create_or_update", reason }`. Alasan tetap: `course_excluded`, `no_valid_deadline`, `outside_time`, `outside_status`, `eligible`. Prioritas dan tabel keputusan mengikuti spec §3–4. Render teks alasan di UI; domain mengembalikan kode.
- [ ] Test tabel untuk semua enum. Bekukan waktu ke `2026-11-19T05:00:00.000Z`. Cek `now`, `now-1ms`, `now-7d`, `now-7d-1ms`, null, tanggal invalid, dan course dikecualikan yang juga gagal waktu/status. Jalankan `npm test -- tests/sync-diff.test.ts`.
- [ ] Perluas input `computeExtensionSyncPlan` sehingga tiap event lokal terformat membawa izin create (misalnya `{event, allowCreate}`). Buang `ignore` sebelum formatting. Di cabang tanpa pasangan, create hanya jika diizinkan. Dengan pasangan, bandingkan hash dan pertahankan target UID milik remote. Sesuaikan seluruh caller dan test; hapus jalur filter boolean yang akan membuang kandidat update.
- [ ] Test menggunakan pasangan lokal/remote nyata: exact UID, fallback .ics dengan UID berbeda dan waktu dalam toleransi, hash sama, hash berbeda, existing-only tanpa pasangan, serta remote tanpa lokal. Assert ID patch, target UID, panjang ketiga array, dan tidak ada operasi delete. Kasus `submitted_only` juga harus berlaku simetris saat tugas kembali pending.

### Tugas 3 · Wiring scanner dan worker — AC3–AC5

**File:** `src/background/scanner.ts`, `src/background/service-worker.ts` bila diperlukan, `tests/scanner.test.ts`, `src/calendar/google-calendar-rest.ts` untuk seam HTTP yang sudah mendukung fetch.

- [ ] Uji `syncAssignmentsToGoogleCalendar` sampai ke request REST. Pakai fake fetch dan token di memori; teruskan fetch ke list/create/patch atau gunakan spy fetch yang dipulihkan tiap test. Jangan mock planner. Fixture utama: satu tugas submitted di luar tujuh hari, mode pending_only, satu event remote bertanda SPADA masih pending. Harapkan satu GET dan satu PATCH ke ID event lama, nol POST, ringkasan `{created:0, updated:1, skipped:0}`. Dengan remote kosong, harapkan GET tanpa write.
- [ ] Ambil token seperti sekarang, evaluasi satu snapshot settings dan waktu, format kandidat yang bisa dibuat/diperbarui, lalu list remote pada kalender tujuan yang sama. Jika semua `ignore`, kembalikan nol setelah autentikasi tanpa GET. Bangun ulang plan terhadap hasil GET terkini pada retry 401; pertahankan pagination, pembatasan laju tulis, dan guard koneksi otomatis.
- [ ] Uji kombinasi satu create, satu update, satu skip, satu ignore. Uji semua dikecualikan, nol tugas tanpa grant, dan kegagalan 401 sekali lalu berhasil. Jalankan `npm test -- tests/scanner.test.ts tests/sync-diff.test.ts tests/install-lifecycle.test.ts`. Pastikan semua entry point tetap memakai fungsi sync yang sama.

### Tugas 4 · Popup untuk scan terakhir — AC2, AC4, AC5

**File:** `src/popup/popup.ts`, `src/popup/popup.html`, `src/popup/popup.css`; tambahkan `src/popup/assignment-view.ts` untuk perhitungan tampilan yang diuji dalam `tests/assignment-view.test.ts`.

- [ ] Bentuk model tampilan dari `assignments, courses, settings, viewFilters, nowMs`. Hitung jumlah kandidat create dari seluruh snapshot memakai evaluator tugas 2, lalu hitung daftar yang terlihat dengan filter tampilan lokal. Format countdown melalui `Intl.DateTimeFormat` berzona `Asia/Jakarta`. Pertahankan tanggal absolut dan urutan tugas hasil scanner. Tangani tanggal invalid sebelum memanggil formatter tanggal.
- [ ] Uji empat kandidat global dengan hanya satu kartu terlihat; count tetap empat. Uji satu tugas existing-only dengan count nol, tanpa deadline, course bernama sama dengan ID berbeda, dan kondisi kosong. Untuk pergantian hari gunakan `2026-11-19T16:59:00Z` dan deadline `2026-11-19T17:01:00Z`: label “Besok” meski hanya dua menit. Uji pula lewat pada hari yang sama.
- [ ] Wire filter tampilan berlabel, status per kartu, alasan eligibility, count dan penjelasan preview. Gunakan `textContent`, label form yang bisa dibaca keyboard/screen reader, dan turunkan warna urgensi dari state. Saat filter berubah, render lokal tanpa `SAVE_SETTINGS` atau request ke Google. Jika belum scan, berikan status awal; jika nol kandidat, aksi sync tetap aktif selama worker tidak sibuk. Segarkan label saat popup tetap terbuka.
- [ ] Jalankan `npm test -- tests/assignment-view.test.ts tests/scanner.test.ts`, suite penuh, typecheck, dan `npm run build`. Smoke di popup: pilih course, cek jumlah global tetap, sync, periksa ringkasan aktual, buka ulang dan cek preferensi sync tetap tersimpan. Tahap I selesai saat AC1–AC5 terpenuhi.

## Tahap II · Feature B

### Tugas 5 · Preferensi reminder/warna dan payload efektif — AC1, AC6

**File:** `src/shared/settings.ts`, `src/options/options.{html,ts,css}`, `src/sync/formatter-and-diff.ts`, `src/calendar/google-calendar-rest.ts`, `src/background/scanner.ts`. Test: settings, sync-diff, google-calendar-rest, scanner.

- [ ] Tambah field dan default tahap II dari spec §2. Uji missing vs `[]`, menit di luar preset, duplikat, urutan berbeda, lebih dari lima pilihan pada input mentah, dan ID warna invalid. Pada UI sediakan preset berlabel, “Tanpa pengingat”, dan dua select warna dengan label selain swatch. Kirim lewat payload save yang sama. Pertahankan draft ketika save gagal.
- [ ] Definisikan preferensi efektif untuk satu event, misalnya `{reminderMinutes: number[], colorId: string | null}`. Hitung sekali dari status + settings, masukkan ke input hash dan hasil formatter, lalu gunakan pada payload. Pertahankan UID, properti private, judul dan tanggal. Singkirkan nilai reminder hardcoded dari builder; bangun maksimal lima override unik dari pilihan sah, backend tetap defensif untuk input di luar form.
- [ ] Beri builder konteks insert/patch. Pada insert default, properti warna absen. Pada patch default, JSON final mengandung `"colorId":null`. Pada kedua jalur, submitted dan tanpa pengingat mengirim `useDefault:false, overrides:[]`. Uji JSON yang diserialisasi oleh transport untuk keduanya, termasuk target UID .ics.
- [ ] Simulasikan dua putaran sync memakai remote palsu yang menyimpan payload/hash dari putaran pertama. Ubah reminder atau warna, periksa satu patch; jalankan lagi tanpa perubahan, harapkan nol patch. Menukar urutan menit menghasilkan hash identik. Mengubah warna pending tidak memicu patch pada submitted; hash v1 dapat menyebabkan satu patch migrasi.
- [ ] Jalankan `npm test -- tests/settings.test.ts tests/sync-diff.test.ts tests/google-calendar-rest.test.ts tests/scanner.test.ts`, typecheck dan build. Dengan kalender uji sendiri, pilih warna eksplisit, sync, pilih default, sync ulang, lalu periksa event kembali mengikuti warna kalender dan reminder benar. Gunakan scope events yang sudah ada.

## Tahap III · Feature D

### Tugas 6 · Daftar kalender dan token per operasi — AC7–AC9

**File:** `public/manifest.json`, `src/calendar/google-calendar-rest.ts`, `src/background/{scanner,service-worker}.ts`, `src/setup/setup-diagnostics.ts` bila menambah pemetaan konteks list, `tests/{google-calendar-rest,scanner,package-check}.test.ts`. Periksa juga `scripts/unpacked-manifest.mjs`; sifat komposisi manifest harus mempertahankan kedua scope.

- [ ] Tambahkan kedua URI scope persis seperti spec §6 ke manifest. Pusatkan konstanta operasi events/list untuk worker. Audit **semua** pemanggil `getAuthToken` termasuk connect, silent revalidation, disconnect, retry, dan auto-sync. Berikan `scopes` eksplisit pada token request masing-masing. Pertahankan deteksi browser tanpa Identity API. Tidak ada perubahan host permissions.
- [ ] Tambahkan `listWritableCalendars(token, fetchImpl = fetch)`. Pakai `URL.searchParams`, Authorization header, `minAccessRole=writer`, dan loop pageToken. Reuse parsing `GoogleCalendarApiError` agar status dan reason utuh. Test dua halaman, satu halaman kosong ber-token, owner/writer/reader, ID duplikat, dua nama sama, primary, label kosong, dan error halaman kedua. Jangan keluarkan daftar parsial sebagai sukses.
- [ ] Tambah pesan `{ type:"LIST_CALENDARS", interactive:boolean }`. Respons sukses `{ok:true, calendars:Array<{id:string,label:string,primary:boolean}>}`; gagal `{ok:false, code, message}`. Pisahkan kode kebutuhan grant, dibatalkan, belum terhubung, offline, rate limit, dan kegagalan lain. Tangani di cabang list agar respons dan state onboarding tidak tercampur dengan kegagalan sync. Cek generasi sebelum mengirim hasil, terutama setelah token request atau pagination.
- [ ] Untuk permintaan diam-diam yang butuh grant, kembalikan kode yang dapat ditindaklanjuti. Aksi pengguna boleh meminta token interaktif. Jika `grantedScopes` tersedia, cek scope tujuan; jika absen, biarkan endpoint menentukan izin. Pada 401 hapus token yang gagal lalu ambil ulang satu kali; 403 insufficientPermissions membuka tindakan consent, kuota memberi saran tunggu. Pertahankan sinkronisasi events-only ketika consent daftar ditolak. Pada disconnect, bersihkan token terkait kedua operasi secara best effort tanpa prompt baru atau menyimpan token.
- [ ] Test melalui handler/adapter worker: buka Options tidak memunculkan prompt, klik izin meneruskan mode interaktif, list 403 tidak menulis `lastSyncError`, 401 kedua berhenti, request event berikutnya memakai scope events saja, dan disconnect saat list berjalan membuang hasil. Periksa pesan hanya memuat DTO yang diizinkan. Jalankan test terfokus untuk REST, scanner, lifecycle, dan handler baru.

### Tugas 7 · Pemilih kalender dan fallback — AC7–AC9

**File:** `src/options/options.{html,ts,css}`; buat `tests/options-calendar.test.ts` dengan adapter DOM/runtime ringan mengikuti pola Vitest Node proyek.

- [ ] Saat state termuat, render nilai tersimpan dan input manual terlebih dahulu. Jika terhubung, minta daftar secara silent. Sediakan status memuat, kosong, gagal, serta tombol refresh/otorisasi. Tombol Simpan tetap dapat menyimpan ID manual ketika hanya permintaan daftar yang gagal. Pisahkan readiness GET_STATE dari readiness daftar.
- [ ] Gunakan ID sebagai nilai option, tandai “(Utama)” menggunakan flag, simpan alias `primary` bila dipilih secara eksplisit. Tampilkan ID manual lama jika di luar daftar. Sinkronkan pilihan dropdown ke draft yang akan disimpan; refresh, error dan cancel tidak menyimpan apa pun. Pertahankan ID/draft jika pengguna mengetik saat daftar dimuat.
- [ ] Beri nomor permintaan lokal atau batalkan permintaan sebelumnya agar respons lama tidak mengganti pilihan baru. Saat disconnect/reset, kosongkan daftar akun lama termasuk bila hasil masih tertunda (amati perubahan state sesi di Options). Render nama dari Google dengan DOM teks. Uji menggunakan nama berkarakter HTML sebagai teks.
- [ ] Uji submit dengan ID manual sebelum list selesai, dua refresh selesai terbalik, grant ditolak, penyimpanan primary, kalender tersimpan hilang, serta kegagalan GET_STATE. Pastikan hanya Simpan yang mengirim `SAVE_SETTINGS`. Jalankan `npm test -- tests/options-calendar.test.ts` dan suite penuh.

### Tugas 8 · Dokumentasi, packaging, dan acceptance rilis — AC10

- [ ] Perbarui `README.md`, `README.id.md`, `HOW_TO_RUN.md`, `HOW_TO_RUN.id.md` di bagian relevan: filter tampilan/sync, lifecycle update, arti angka kandidat, reminder/warna, fallback ID, consent baru. Selaraskan `CHROMEWEBSTORE.md`, `PRIVACY.md`, dan `docs/privacy.html` dengan data list yang dibaca, lokasi penyimpanan pilihan dan alasan kedua scope. Jika merilis tahap terpisah, dokumentasikan perilaku yang sudah dikirim pada masing-masing tahap.
- [ ] Jalankan `npm test`, `npm run typecheck`, `npm run build`. Perluas integration test packaging yang sudah membuka kedua ZIP agar memeriksa set scope dari manifest produksi pada Store dan unpacked; pertahankan pemeriksaan key dan client ID masing-masing. Fixture yang sengaja generik untuk menguji preservasi scope tetap berguna.
- [ ] Maintainer menjalankan `npm run package:unpacked` dengan config lokal resmi serta `npm run package:strict` untuk Store dengan client ID Store. Pemilik proyek Cloud menambahkan scope list readonly ke konfigurasi consent dan mengecek persyaratan verifikasi sebelum rollout. Jangan memasukkan kredensial ke commit. Jika runner hanya punya placeholder, laporkan status acceptance riil secara eksplisit; integration test fixture menguji isi arsip.
- [ ] Verifikasi di Chrome dengan **profil baru** dan **upgrade in-place dari v1.0.0 memakai Extension ID yang sama**. Rekam versi, target paket, dan hasil AC1–AC10. Pada upgrade pertahankan grant events lama, uji penolakan scope list + sync manual ke kalender yang tersimpan, lalu berikan izin list dan pilih kalender writable lain. Pastikan event baru muncul di tujuan pilihan, event kalender lama tetap ada, dan refresh tidak mengubah tujuan.
- [ ] Untuk laporan eksekusi, sebutkan test yang dijalankan, hasil smoke aktual, serta pemeriksaan eksternal yang masih membutuhkan akun uji. Selesai ketika perilaku otomatis lulus dan hasil acceptance per tahap diketahui; hasil mock dan verifikasi akun nyata dicatat terpisah.
