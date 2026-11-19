# Filter tugas, personalisasi event, dan pemilihan kalender

**Acuan kode** · main pada e7c6c87, ekstensi Chrome MV3. **Pengguna** · mahasiswa yang memantau tugas SPADA dan menyinkronkannya ke kalender miliknya. **Urutan pengiriman** · Filtering + A, kemudian B, kemudian D. Setiap tahap dapat dirilis sendiri. [Plan eksekusi](../plans/2026-11-19-assignment-filters-calendar.md)

## 1. Hasil yang harus terlihat

Mahasiswa dapat melihat tenggat per mata kuliah, mengetahui tugas yang cocok dengan aturan pembuatan event, dan memilih mata kuliah yang dikecualikan. Event yang pernah dibuat dapat berubah dari 📌 [TUGAS] menjadi ✅ [SELESAI] walau status baru berada di luar filter. Pengingat dan warna mengikuti pengaturan terbaru saat sync berikutnya. Mahasiswa dapat memilih kalender yang dapat ditulisi atau memakai ID manual seperti pada v1.0.0.

Sinkronisasi tetap satu arah. Ekstensi hanya mengelola event bertanda sumber SPADA pada kalender tujuan. Mengganti filter, mengecualikan mata kuliah, atau mengganti kalender tidak memindahkan maupun menghapus event. Badge toolbar dan statistik onboarding mempertahankan arti yang sudah ada.

## 2. Preferensi dan kompatibilitas

Simpan preferensi di `spadaScannerState.settings`. Semua penyimpanan lewat pesan `SAVE_SETTINGS` dan antrean mutasi service worker. Popup menyimpan pilihan tampilannya di memori selama terbuka.

| Field | Nilai sah | Default saat instalasi / reset |
|---|---|---|
| `timeFilter` | `upcoming_only`, `recent_7d`, `all` | `recent_7d` |
| `statusFilter` | `pending_only`, `submitted_only`, `all` | `all` |
| `excludedCourseIds` | ID mata kuliah SPADA berupa string, unik | `[]` |
| `reminderMinutes` | himpunan dari 4320, 1440, 360, 180, 60; maksimal lima | `[1440, 180]` |
| `pendingColorId`, `submittedColorId` | masing-masing `"default"` atau string desimal `"1"` sampai `"11"` | keduanya `"default"` |
| `calendarId`, `autoSyncOnVisit` | string ID yang sudah di-trim, boolean | `"primary"`, `true` |

**Migrasi saat baca.** Dahulukan enum baru yang valid. Jika absen/rusak, petakan `includePastAssignments: true → all`, `false → recent_7d`; `syncSubmitted: true → all`, `false → pending_only`. Jika field lama juga absen/rusak, pakai default instalasi. Pertahankan kalender, auto-sync, data scan, dan riwayat yang ada. Pembacaan berulang menghasilkan preferensi identik. Simpan representasi kanonis pada penulisan berikutnya. Saat membaca array pengingat, pertahankan array kosong yang berarti sengaja mematikan reminder; jika semua elemen array nonkosong rusak, pulihkan default. Buang elemen tidak valid pada array campuran, hilangkan duplikat dan urutkan menit menurun. Normalisasi warna per status secara independen. Pertahankan ID pengecualian meski course sedang tidak muncul dalam scan. Pada input form/pesan simpan yang tidak valid, tampilkan kesalahan dan pertahankan preferensi tersimpan.

## 3. Filtering dan lifecycle event

Gunakan `ScannedAssignment.courseId`, `cmid`, `submitted`, dan `dueDateIso`. Untuk satu evaluasi, ambil satu `nowMs`. Deadline valid berarti timestamp ISO yang dapat diparse menjadi waktu hingga. `upcoming_only` menerima `dueMs >= nowMs`; `recent_7d` menerima `dueMs >= nowMs - 7 * 86400000`; `all` menerima setiap waktu valid. Filter status membandingkan boolean `submitted`. Filter waktu dan status digabung dengan AND.

| Pada snapshot scan | Belum ada event yang cocok | Ada event yang cocok di kalender tujuan |
|---|---|---|
| Course dikecualikan, deadline kosong/tidak valid, atau tugas hilang dari scan | Abaikan | Biarkan event lama |
| Deadline valid, course diizinkan, lolos waktu dan status | Create | Update jika hash berbeda, selain itu skip |
| Deadline valid, course diizinkan, gagal waktu atau status | Abaikan | Update jika hash berbeda, selain itu skip |

Pencocokan memakai UID deterministik `assign-<cmid>@spada.upnyk.ac.id` dan fallback kompatibel event .ics pada planner saat ini. Saat patch, gunakan `googleEventId` dan `targetSpadaUid` milik pasangan yang ditemukan. Lookup hanya membaca event dengan `privateExtendedProperty` sumber SPADA di kalender terpilih, termasuk semua halaman. Tugas yang diabaikan tanpa pasangan bukan bagian dari angka skip; skip menghitung pasangan yang sudah sesuai.

Worker mempertahankan autentikasi sebelum melaporkan sync berhasil, termasuk saat nol tugas. Sesudah autentikasi, boleh melewati GET event jika seluruh tugas diabaikan mutlak. Jika ada satu saja tugas yang mungkin memperbarui event, jalankan lookup dan diff meskipun kandidat create berjumlah nol. Gunakan kontrak ini untuk sync manual, alarm, dan kunjungan SPADA. Pertahankan retry 401 satu kali, pembacaan ulang remote sebelum retry penulisan, serta guard generasi untuk hasil sync sesudah disconnect/reset.

## 4. Feature A · Popup dan pengecualian course

- **Pengaturan sync di Options.** Waktu, status, dan checkbox “Kecualikan dari sync” berlaku untuk aksi manual dan otomatis setelah Simpan. Gunakan ID untuk identitas dan nama untuk label; sediakan cara membatalkan pengecualian untuk ID lama yang belum terlihat pada scan terbaru. Kegagalan memuat state menahan tombol Simpan dan menawarkan muat ulang.
- **Filter tampilan di Popup.** Dropdown course dari `state.courses` dengan “Semua mata kuliah”, filter status default pending (tambahkan submitted ke pending/all), dan filter waktu lokal dengan default “Semua waktu”. Terapkan pada snapshot lokal. Tugas tanpa tanggal tetap bisa dilihat pada tampilan semua waktu, dengan label “Tanpa deadline”. Kartu dari course yang dikecualikan tetap bisa dilihat. Beri empty state sesuai filter dan akses untuk mengembalikan tampilan ke semua tugas.
- **Preview.** Label contoh “Sync ke Calendar (4 kandidat)” dengan keterangan “Cocok untuk event baru pada scan terakhir; event lama juga diperiksa.” Angka menghitung semua tugas yang lolos aturan create pada snapshot lokal. Filter tampilan tidak mengubah angka ini. Worker melakukan scan ulang saat tombol ditekan; tampilkan hasil aktual setelah sync. Nilai nol tetap mengizinkan sync. Sebelum scan pertama tampilkan “Belum ada hasil scan”. Alasan pada kartu berasal dari evaluator yang sama dengan prioritas course dikecualikan, deadline invalid, waktu, kemudian status. Untuk tugas di luar waktu/status tulis “Hanya memperbarui jika event sudah ada”.
- **Waktu relatif.** Tampilkan tanggal absolut WIB yang sudah ada. Bandingkan hari kalender di Asia/Jakarta untuk “Hari ini” dan “Besok”, durasi aktual untuk “4 jam lagi” atau “Lewat 2 jam”. Pada saat deadline persis tampilkan “Jatuh tempo sekarang”. Gunakan teks selain warna, tangani menit terakhir dan refresh selama popup terbuka (misalnya setiap menit dan saat kembali fokus). Preview dan kartu menggunakan waktu evaluasi yang sama pada satu render.

## 5. Feature B · Reminder, warna, dan identitas event

Options menyediakan lima preset, opsi “Tanpa pengingat” yang mengosongkan pilihan, dan dua pilihan warna berlabel teks serta contoh warna. Event pending memakai reminder pilihan; event submitted selalu memakai nol reminder. Kirim `reminders.useDefault = false`, `overrides` berupa array dengan metode `popup`. Validasi juga di builder agar input dari storage lama tidak pernah menghasilkan lebih dari lima override. [Google Calendar Events](https://developers.google.com/workspace/calendar/api/v3/reference/events)

Hitung satu representasi efektif per tugas, berisi menit pengingat unik yang terurut dan warna untuk status tugas tersebut. Hash-kan representasi ini bersama field yang sudah ada pada `formatScannedAssignment`; gunakan nilai yang sama untuk payload. Jangan hash seluruh preferensi pengguna. Mengubah warna pending tidak memicu patch pada event submitted yang sudah memakai format hash baru. Peralihan hash v1 ke format baru boleh menghasilkan satu patch per event yang masih dikelola. Sync kedua dengan snapshot dan preferensi identik menghasilkan nol penulisan.

Pada insert, pilihan default menghilangkan `colorId`. Pada PATCH, kirim `colorId: null` untuk menghapus override dan kembali ke warna kalender. Sesuaikan tipe payload PATCH agar nilai null benar-benar terserialisasi. Pertahankan properti ekstensi saat patch serta field pengguna di luar payload terkelola. Verifikasi reset warna dengan membaca ulang event uji, termasuk jika pengguna mengganti warna kalender induk. [Semantik PATCH Google Calendar](https://developers.google.com/workspace/calendar/api/guides/performance)

## 6. Feature D · Kalender tujuan dan persetujuan OAuth

1. Tambahkan scope `https://www.googleapis.com/auth/calendar.calendarlist.readonly` di samping `https://www.googleapis.com/auth/calendar.events` pada manifest untuk kedua target build. Permission ekstensi dan host saat ini cukup. Gunakan scope eksplisit pada panggilan Identity karena default API mengikuti seluruh scope manifest. Connect, revalidasi legacy, sync, dan retry event hanya meminta scope events. [Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity)
2. Options mengirim `LIST_CALENDARS` dengan `interactive: false` untuk pemuatan diam-diam saat akun sudah terhubung. Sediakan “Muat ulang” dan, jika izin kurang, tombol eksplisit “Izinkan akses daftar kalender” untuk permintaan interaktif. Worker meminta scope daftar khusus operasi list. Pengguna yang menolak izin tambahan tetap dapat sync dengan scope events. Aksi putuskan membersihkan sesi lokal dan menangani token dari kedua jenis permintaan. Token tidak boleh dikirim ke UI, disimpan di storage, atau dicantumkan di diagnostik.
3. Worker menjalankan GET `/calendar/v3/users/me/calendarList?minAccessRole=writer`, mengikuti seluruh `nextPageToken`, menyaring tepat `owner` dan `writer`, membuang ID kosong/duplikat. DTO ke UI hanya `{id, label, primary}`. Label memakai `summaryOverride`, lalu `summary`, lalu ID. Tampilkan kalender utama dahulu, sisanya urut nama dan ID. Penanda utama memakai flag `primary`. Untuk pilihan utama baru simpan alias `primary`; ID eksplisit yang sudah tersimpan tetap dipertahankan sampai pengguna memilih pengganti dan menekan Simpan. [CalendarList.list](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list)
4. Jika belum terhubung, offline, daftar kosong, atau ID tersimpan tidak muncul, tetap tampilkan ID manual dan nilai/draft saat ini. Memuat, refresh, gagal, atau mendapat respons lambat tidak boleh mengubah kalender tujuan maupun menimpa input yang sedang diketik. Saat user memilih tujuan lain, jelaskan bahwa sync berikutnya memakai kalender baru; event lama tetap di kalender sebelumnya.
5. Bedakan `insufficientPermissions`/izin belum diberikan dari 403 kuota, 429, penolakan pengguna, 401, dan jaringan. Saat 401, buang token gagal dan coba satu kali dengan scope/mode interaktif yang sama. Gagal pada halaman kedua menghasilkan status gagal yang dapat dicoba ulang. Error list tampil di Options; jangan menulisnya ke `lastSyncError` atau mereset kesiapan onboarding. Abaikan respons dari akun/sesi sebelumnya setelah disconnect/reset dan respons refresh yang telah disusul permintaan lain. Nama kalender dirender dengan `textContent`.
6. Sebelum distribusi D, maintainer menyesuaikan OAuth consent/data access di proyek Google Cloud untuk client yang digunakan dan mengecek kebutuhan verifikasi. Selaraskan listing Store, kebijakan privasi Markdown/HTML, dan panduan instalasi. Dokumen menjelaskan nama/ID daftar dipakai di perangkat untuk pemilihan, ID pilihan disimpan lokal, dan event tugas dikirim ke Google Calendar yang dipilih.

## 7. Kriteria penerimaan lintas fitur

| ID | Skenario | Hasil yang harus bisa diamati |
|---|---|---|
| AC1 | Upgrade empat kombinasi boolean v1; simpan dua kali; reset | Preferensi ekuivalen, nilai stabil, reset mengembalikan default |
| AC2 | Tenggat tepat sekarang, tepat tujuh hari, satu milidetik di luar batas, tanggal invalid | Keputusan konsisten antara worker dan preview; tanggal invalid aman di Popup |
| AC3 | Hanya satu tugas pending menjadi submitted setelah lewat tujuh hari | Event yang sama berubah ke SELESAI, reminder kosong, tanpa duplikat; bila remote kosong, nol insert |
| AC4 | Course dikecualikan atau deadline hilang setelah pernah sync | Tidak ada POST/PATCH/DELETE untuk tugas tersebut; kartu menjelaskan alasannya |
| AC5 | Filter tampilan menyisakan satu kartu, lalu tombol sync ditekan | Angka kandidat tetap global; selisih scan terbaru dijelaskan oleh ringkasan aktual |
| AC6 | Ubah reminder, urutkan ulang pilihan, ubah warna khusus ke default | Hanya perubahan efektif memicu patch; event dibaca ulang memakai warna kalender |
| AC7 | List dua halaman, nama identik, kalender reader dan primary | Hanya ID writable yang ditampilkan satu kali, primary ditandai, pilihan disimpan setelah Simpan |
| AC8 | Upgrade dengan grant events saja, tolak list, isi ID manual | Event sync tetap sukses; dialog OAuth hanya muncul dari aksi pengguna; status sync lama tetap valid |
| AC9 | Offline, 403 rate limit, 401 dua kali, respons list lama setelah disconnect | Pesan sesuai sebab, retry terbatas, draft ID aman, daftar akun lama tidak muncul |
| AC10 | Paket unpacked dan Store; profil Chrome segar dan profil upgrade | Scope benar pada kedua manifest, identitas target terpisah, alur connect/onboarding lama tetap berjalan |
