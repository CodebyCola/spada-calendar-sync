import type { StoredExtensionState } from "../shared/storage.js";

export type SetupErrorCode =
  | "SPADA_AUTH_REQUIRED"
  | "SPADA_ACCESS_DENIED"
  | "OAUTH_NOT_CONFIGURED"
  | "OAUTH_CANCELLED"
  | "OAUTH_CLIENT_MISMATCH"
  | "OAUTH_ACCESS_DENIED"
  | "GCAL_RATE_LIMITED"
  | "GCAL_CALENDAR_NOT_FOUND"
  | "BROWSER_UNSUPPORTED"
  | "NETWORK_OR_SERVER"
  | "UNKNOWN";

export interface SetupErrorDiagnosis {
  code: SetupErrorCode;
  title: string;
  hint: string;
  rawMessage: string;
}

const GCAL_RATE_LIMIT_PATTERN =
  /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded|calendarUsageLimitsExceeded|rate limit exceeded|too many requests/i;

export function diagnoseSetupError(rawError: string): SetupErrorDiagnosis {
  const rawMessage = rawError.trim();

  // 1. SPADA service-specific HTTP errors first (never misclassify SPADA 403 as Google OAuth)
  const spadaHttpMatch = /^SPADA HTTP (\d{3})\b/i.exec(rawMessage);
  if (spadaHttpMatch) {
    const status = Number(spadaHttpMatch[1]);
    if (status === 401) {
      return {
        code: "SPADA_AUTH_REQUIRED",
        title: "Sesi SPADA UPNYK sudah habis",
        hint: "Buka spada.upnyk.ac.id, login kembali dengan akun mahasiswamu, lalu coba Scan lagi.",
        rawMessage,
      };
    }
    if (status === 403) {
      return {
        code: "SPADA_ACCESS_DENIED",
        title: "Akses halaman SPADA ditolak (HTTP 403)",
        hint: "Pastikan sesi login SPADA masih aktif dan kamu masih terdaftar pada mata kuliah terkait, lalu muat ulang SPADA.",
        rawMessage,
      };
    }
    return {
      code: "NETWORK_OR_SERVER",
      title: `Server SPADA bermasalah (HTTP ${status})`,
      hint: "Cek koneksi internet atau tunggu beberapa saat sampai SPADA kembali normal, lalu coba lagi.",
      rawMessage,
    };
  }

  // 2. Google Calendar service-specific HTTP errors (preserve status & rate-limit reason)
  const gcalHttpMatch = /^GCAL HTTP (\d{3})(?:\s+\[([^\]]+)\])?:/i.exec(rawMessage);
  if (gcalHttpMatch) {
    const status = Number(gcalHttpMatch[1]);
    const reason = gcalHttpMatch[2] ?? "";

    if (status === 429 || (status === 403 && (GCAL_RATE_LIMIT_PATTERN.test(reason) || GCAL_RATE_LIMIT_PATTERN.test(rawMessage)))) {
      return {
        code: "GCAL_RATE_LIMITED",
        title: "Batas permintaan Google Calendar sementara tercapai",
        hint: "Tunggu beberapa menit lalu klik Sync lagi. Data tugasmu tetap aman.",
        rawMessage,
      };
    }
    if (status === 403) {
      return {
        code: "OAUTH_ACCESS_DENIED",
        title: "Izin akses Google Calendar ditolak",
        hint: "Coba putuskan lalu hubungkan ulang akun Google dan pastikan izin kalender disetujui penuh.",
        rawMessage,
      };
    }
    if (status === 404) {
      return {
        code: "GCAL_CALENDAR_NOT_FOUND",
        title: "Google Calendar tidak ditemukan (HTTP 404)",
        hint: 'Buka Pengaturan ⚙️ dan pastikan kolom Google Calendar ID diisi "primary" atau ID kalender yang benar.',
        rawMessage,
      };
    }
    if (status === 401) {
      return {
        code: "OAUTH_CANCELLED",
        title: "Sesi Google Calendar perlu diperbarui",
        hint: "Klik Hubungkan Google kembali untuk menyegarkan izin akses kalender.",
        rawMessage,
      };
    }
    if (status >= 500) {
      return {
        code: "NETWORK_OR_SERVER",
        title: `Server Google Calendar bermasalah (HTTP ${status})`,
        hint: "Tunggu beberapa saat lalu coba Sync kembali.",
        rawMessage,
      };
    }
  }

  // 3. SPADA login required
  if (/AUTH_REQUIRED/i.test(rawMessage)) {
    return {
      code: "SPADA_AUTH_REQUIRED",
      title: "Belum login ke SPADA UPNYK",
      hint: "Buka https://spada.upnyk.ac.id/ di tab Chrome, login dengan akun SPADA-mu, lalu klik Cek Sesi SPADA lagi.",
      rawMessage,
    };
  }

  // 4. OAuth client not configured in manifest
  if (/OAUTH_NOT_CONFIGURED/i.test(rawMessage)) {
    return {
      code: "OAUTH_NOT_CONFIGURED",
      title: "Paket ekstensi belum dilengkapi OAuth Google",
      hint: "Pastikan kamu memasang file ZIP rilis resmi (atau bagi developer, jalankan npm run setup:unpacked & npm run package:unpacked).",
      rawMessage,
    };
  }

  // 5. OAuth specific reasons & Chromium offline OAuth failures BEFORE generic "OAuth2 request failed"
  if (/service unavailable|connection failed|err_connection|err_internet|err_name_not_resolved/i.test(rawMessage)) {
    return {
      code: "NETWORK_OR_SERVER",
      title: "Gangguan koneksi ke layanan Google",
      hint: "Periksa koneksi internetmu atau tunggu beberapa saat lalu coba lagi.",
      rawMessage,
    };
  }

  if (/did not approve|canceled|cancelled|user_cancelled|oauth2 not granted or revoked/i.test(rawMessage)) {
    return {
      code: "OAUTH_CANCELLED",
      title: "Login Google dibatalkan atau dicabut",
      hint: "Klik Hubungkan Google lagi, pilih akun Gmail-mu, lalu tekan Izinkan/Continue.",
      rawMessage,
    };
  }

  if (/access_denied|org_internal|unverified/i.test(rawMessage)) {
    return {
      code: "OAUTH_ACCESS_DENIED",
      title: "Akses login Google dibatasi",
      hint: 'Jika muncul layar "Google hasn\'t verified this app", klik Advanced → Go to SPADA UPNYK Assignment Scanner. Jika tetap ditolak (kuota/daftar test user), hubungi pembuat ekstensi.',
      rawMessage,
    };
  }

  if (/bad client id|invalid_client|oauth2 request failed/i.test(rawMessage)) {
    return {
      code: "OAUTH_CLIENT_MISMATCH",
      title: "Extension ID tidak cocok dengan OAuth Client ID",
      hint: "Pastikan kamu memasang dari ZIP unpacked resmi (tanpa mengubah manifest) atau samakan Extension ID di Google Cloud Console.",
      rawMessage,
    };
  }

  // 6. Browser / Chrome profile sign-in unsupported
  if (/BROWSER_UNSUPPORTED|not signed in|browser sign-?in|turned off.*sign-?in|getauthtoken.*not supported|getauthtoken is not a function|identity.*not available|chrome sign-?in/i.test(rawMessage)) {
    return {
      code: "BROWSER_UNSUPPORTED",
      title: "Login Google memerlukan Google Chrome",
      hint: "Pastikan kamu memakai Google Chrome (bukan Brave/Edge) dan sudah login ke profil Chrome sebelum klik Hubungkan Google.",
      rawMessage,
    };
  }

  // 7. Generic rate limit text without GCAL prefix
  if (GCAL_RATE_LIMIT_PATTERN.test(rawMessage)) {
    return {
      code: "GCAL_RATE_LIMITED",
      title: "Batas permintaan Google Calendar sementara tercapai",
      hint: "Tunggu beberapa menit lalu klik Sync lagi.",
      rawMessage,
    };
  }

  // 8. Network / server failures
  if (/failed to fetch|networkerror|network error|timeout|timed out|\b50[0234]\b/i.test(rawMessage)) {
    return {
      code: "NETWORK_OR_SERVER",
      title: "Gangguan koneksi atau server",
      hint: "Periksa koneksi internetmu lalu coba ulangi beberapa saat lagi.",
      rawMessage,
    };
  }

  // 9. Safe fallback
  return {
    code: "UNKNOWN",
    title: "Terjadi kendala saat memproses",
    hint: rawMessage || "Silakan coba lagi beberapa saat.",
    rawMessage,
  };
}

export type StepState = "done" | "active" | "pending" | "error" | "blocked";
export type SetupStepId = "spada" | "google" | "firstSync";

export interface SetupStepStatus {
  id: SetupStepId;
  state: StepState;
  detail: string;
}

export interface SetupStatus {
  steps: {
    spada: SetupStepStatus;
    google: SetupStepStatus;
    firstSync: SetupStepStatus;
  };
  completedCount: number;
  overallReady: boolean;
  hasCompletedInitialSetup: boolean;
  nextStep: SetupStepId | "done";
}

export function evaluateSetupStatus(
  state: StoredExtensionState,
  oauthConfigured: boolean
): SetupStatus {
  const isGoogleVerifiedConnected = state.googleConnected && state.googleAuthVerified;

  // Step 1: SPADA login/scan
  let spada: SetupStepStatus;
  if (state.lastScanError !== null) {
    const diag = diagnoseSetupError(state.lastScanError);
    spada = { id: "spada", state: "error", detail: `${diag.title} — ${diag.hint}` };
  } else if (state.lastScanAt !== null) {
    const detail =
      state.courses.length > 0
        ? `Terhubung • ${state.courses.length} mata kuliah, ${state.assignments.length} tugas terdeteksi.`
        : "Sesi SPADA aktif, tetapi belum ada mata kuliah aktif terdeteksi di dashboard (mis. awal semester/KRS). Kamu tetap bisa lanjut ke Langkah 2.";
    spada = { id: "spada", state: "done", detail };
  } else {
    spada = {
      id: "spada",
      state: "active",
      detail: "Buka SPADA UPNYK, pastikan sudah login, lalu klik Cek Sesi SPADA.",
    };
  }

  // Step 2: Google Calendar OAuth connection
  let google: SetupStepStatus;
  if (!oauthConfigured) {
    google = {
      id: "google",
      state: "blocked",
      detail: "Paket ekstensi ini belum dilengkapi konfigurasi OAuth Google.",
    };
  } else if (isGoogleVerifiedConnected) {
    google = {
      id: "google",
      state: "done",
      detail: "Akun Google terhubung (jadwal akan masuk ke Google Calendar milikmu sendiri).",
    };
  } else if (state.lastSyncError !== null) {
    const diag = diagnoseSetupError(state.lastSyncError);
    google = { id: "google", state: "error", detail: `${diag.title} — ${diag.hint}` };
  } else if (spada.state === "done") {
    google = {
      id: "google",
      state: "active",
      detail: "Klik Hubungkan Google untuk memilih akun Google Calendar milikmu.",
    };
  } else {
    google = {
      id: "google",
      state: "pending",
      detail: "Selesaikan Langkah 1 terlebih dahulu.",
    };
  }

  // Step 3: First sync (strictly gated behind Step 1 & Step 2)
  let firstSync: SetupStepStatus;
  if (!oauthConfigured) {
    firstSync = {
      id: "firstSync",
      state: "blocked",
      detail: "Menunggu konfigurasi OAuth Google tersedia.",
    };
  } else if (!isGoogleVerifiedConnected) {
    firstSync = {
      id: "firstSync",
      state: "pending",
      detail: "Hubungkan Google Calendar di Langkah 2 terlebih dahulu.",
    };
  } else if (state.lastSyncError !== null) {
    const diag = diagnoseSetupError(state.lastSyncError);
    firstSync = { id: "firstSync", state: "error", detail: `${diag.title} — ${diag.hint}` };
  } else if (state.lastSyncAt !== null) {
    const summary = state.lastSyncSummary;
    const detail = summary
      ? `Sinkronisasi berhasil (+${summary.created} baru, ~${summary.updated} update, ${summary.skipped} skip).`
      : "Sinkronisasi Google Calendar aktif.";
    firstSync = { id: "firstSync", state: "done", detail };
  } else if (spada.state === "done" && google.state === "done") {
    firstSync = {
      id: "firstSync",
      state: "active",
      detail: "Klik Scan & Sync Pertama untuk mengirim tenggat tugas ke kalendermu.",
    };
  } else {
    firstSync = {
      id: "firstSync",
      state: "pending",
      detail: "Selesaikan Langkah 1 dan 2 terlebih dahulu.",
    };
  }

  const ordered = [spada, google, firstSync];
  const completedCount = ordered.filter((s) => s.state === "done").length;
  const overallReady = completedCount === 3;
  const hasCompletedInitialSetup = Boolean(
    oauthConfigured &&
      state.lastScanAt !== null &&
      isGoogleVerifiedConnected &&
      state.lastSyncAt !== null
  );
  const nextStep = ordered.find((s) => s.state !== "done")?.id ?? "done";

  return {
    steps: { spada, google, firstSync },
    completedCount,
    overallReady,
    hasCompletedInitialSetup,
    nextStep,
  };
}
