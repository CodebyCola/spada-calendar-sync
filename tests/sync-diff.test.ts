import { describe, expect, it } from "vitest";
import type { ScannedAssignment } from "../src/parsers/spada-html.js";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../src/shared/settings.js";
import {
  computeExtensionSyncPlan,
  evaluateAssignmentForSync,
  formatScannedAssignment,
  type LocalSyncCandidate,
  type RemoteCalendarEvent,
} from "../src/sync/formatter-and-diff.js";

const FROZEN_NOW_MS = Date.parse("2026-11-19T05:00:00.000Z");
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const SAMPLE_PENDING: ScannedAssignment = {
  cmid: "846622",
  title: "AI For Music",
  topic: "12. AI For Music",
  assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=846622",
  courseId: "52581",
  courseName: "Kapita Selekta IF-C (20261)",
  shortCourseName: "Kapita Selekta IF-C",
  courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
  dueDateIso: "2026-11-20T17:00:00.000Z",
  dueDateText: "Saturday, 21 November 2026, 00:00",
  submissionStatus: "Belum mengajukan",
  submitted: false,
  grade: "-",
};

const SAMPLE_SUBMITTED: ScannedAssignment = {
  cmid: "812118",
  title: "Tugas Kelompok",
  topic: "BAB 2",
  assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=812118",
  courseId: "56304",
  courseName: "Sistem Operasi IF-C (20261)",
  shortCourseName: "Sistem Operasi IF-C",
  courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=56304",
  dueDateIso: "2026-11-15T16:59:00.000Z",
  dueDateText: "Sunday, 15 November 2026, 23:59",
  submissionStatus: "Terkirim dan siap dinilai",
  submitted: true,
  grade: "-",
};

function settingsWith(overrides: Partial<ExtensionSettings>): ExtensionSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
  };
}

describe("evaluateAssignmentForSync (AC2)", () => {
  it("Enforces exact boundary timestamps for upcoming_only, recent_7d, and all", () => {
    const atNow: ScannedAssignment = {
      ...SAMPLE_PENDING,
      dueDateIso: new Date(FROZEN_NOW_MS).toISOString(),
    };
    const justBeforeNow: ScannedAssignment = {
      ...SAMPLE_PENDING,
      dueDateIso: new Date(FROZEN_NOW_MS - 1).toISOString(),
    };
    const atSevenDaysAgo: ScannedAssignment = {
      ...SAMPLE_PENDING,
      dueDateIso: new Date(FROZEN_NOW_MS - SEVEN_DAYS_MS).toISOString(),
    };
    const justBeforeSevenDays: ScannedAssignment = {
      ...SAMPLE_PENDING,
      dueDateIso: new Date(FROZEN_NOW_MS - SEVEN_DAYS_MS - 1).toISOString(),
    };

    // upcoming_only: dueMs >= nowMs
    const upcoming = settingsWith({ timeFilter: "upcoming_only", statusFilter: "all" });
    expect(evaluateAssignmentForSync(atNow, upcoming, FROZEN_NOW_MS)).toEqual({
      mode: "create_or_update",
      reason: "eligible",
    });
    expect(evaluateAssignmentForSync(justBeforeNow, upcoming, FROZEN_NOW_MS)).toEqual({
      mode: "existing_only",
      reason: "outside_time",
    });

    // recent_7d: dueMs >= nowMs - 7d
    const recent = settingsWith({ timeFilter: "recent_7d", statusFilter: "all" });
    expect(evaluateAssignmentForSync(atSevenDaysAgo, recent, FROZEN_NOW_MS)).toEqual({
      mode: "create_or_update",
      reason: "eligible",
    });
    expect(evaluateAssignmentForSync(justBeforeSevenDays, recent, FROZEN_NOW_MS)).toEqual({
      mode: "existing_only",
      reason: "outside_time",
    });

    // all: any valid timestamp
    const allTime = settingsWith({ timeFilter: "all", statusFilter: "all" });
    expect(evaluateAssignmentForSync(justBeforeSevenDays, allTime, FROZEN_NOW_MS)).toEqual({
      mode: "create_or_update",
      reason: "eligible",
    });
  });

  it("Evaluates statusFilter enums (pending_only, submitted_only, all) symmetrically", () => {
    const pendingInTime = { ...SAMPLE_PENDING, dueDateIso: new Date(FROZEN_NOW_MS + 1000).toISOString() };
    const submittedInTime = { ...SAMPLE_SUBMITTED, dueDateIso: new Date(FROZEN_NOW_MS + 1000).toISOString() };

    const pendingOnly = settingsWith({ timeFilter: "upcoming_only", statusFilter: "pending_only" });
    expect(evaluateAssignmentForSync(pendingInTime, pendingOnly, FROZEN_NOW_MS)).toEqual({
      mode: "create_or_update",
      reason: "eligible",
    });
    expect(evaluateAssignmentForSync(submittedInTime, pendingOnly, FROZEN_NOW_MS)).toEqual({
      mode: "existing_only",
      reason: "outside_status",
    });

    const submittedOnly = settingsWith({ timeFilter: "upcoming_only", statusFilter: "submitted_only" });
    expect(evaluateAssignmentForSync(submittedInTime, submittedOnly, FROZEN_NOW_MS)).toEqual({
      mode: "create_or_update",
      reason: "eligible",
    });
    expect(evaluateAssignmentForSync(pendingInTime, submittedOnly, FROZEN_NOW_MS)).toEqual({
      mode: "existing_only",
      reason: "outside_status",
    });

    const allStatus = settingsWith({ timeFilter: "upcoming_only", statusFilter: "all" });
    expect(evaluateAssignmentForSync(pendingInTime, allStatus, FROZEN_NOW_MS)).toEqual({
      mode: "create_or_update",
      reason: "eligible",
    });
    expect(evaluateAssignmentForSync(submittedInTime, allStatus, FROZEN_NOW_MS)).toEqual({
      mode: "create_or_update",
      reason: "eligible",
    });
  });

  it("Enforces priority: course_excluded > no_valid_deadline > outside_time > outside_status", () => {
    const excludedInvalidOldSubmitted: ScannedAssignment = {
      ...SAMPLE_SUBMITTED,
      dueDateIso: "not-a-valid-date",
    };

    // Excluded course beats invalid deadline, outside time, and outside status
    expect(
      evaluateAssignmentForSync(
        excludedInvalidOldSubmitted,
        settingsWith({
          excludedCourseIds: [SAMPLE_SUBMITTED.courseId],
          timeFilter: "upcoming_only",
          statusFilter: "pending_only",
        }),
        FROZEN_NOW_MS
      )
    ).toEqual({ mode: "ignore", reason: "course_excluded" });

    // Null or invalid deadline returns ignore + no_valid_deadline
    expect(
      evaluateAssignmentForSync(
        { ...SAMPLE_SUBMITTED, dueDateIso: null },
        settingsWith({ timeFilter: "upcoming_only", statusFilter: "pending_only" }),
        FROZEN_NOW_MS
      )
    ).toEqual({ mode: "ignore", reason: "no_valid_deadline" });
    expect(
      evaluateAssignmentForSync(
        { ...SAMPLE_SUBMITTED, dueDateIso: "invalid-iso" },
        settingsWith({ timeFilter: "all", statusFilter: "all" }),
        FROZEN_NOW_MS
      )
    ).toEqual({ mode: "ignore", reason: "no_valid_deadline" });

    // Outside time beats outside status
    const oldSubmitted: ScannedAssignment = {
      ...SAMPLE_SUBMITTED,
      dueDateIso: new Date(FROZEN_NOW_MS - SEVEN_DAYS_MS - 1000).toISOString(),
    };
    expect(
      evaluateAssignmentForSync(
        oldSubmitted,
        settingsWith({ timeFilter: "recent_7d", statusFilter: "pending_only" }),
        FROZEN_NOW_MS
      )
    ).toEqual({ mode: "existing_only", reason: "outside_time" });
  });
});

describe("formatScannedAssignment & computeExtensionSyncPlan (AC3-AC4)", () => {
  it("Formats pending and submitted titles cleanly with SHA-256 hash", async () => {
    const pendingFormatted = await formatScannedAssignment(SAMPLE_PENDING);
    expect(pendingFormatted.title).toBe("📌 [TUGAS] AI For Music — Kapita Selekta IF-C");
    expect(pendingFormatted.spadaUid).toBe("assign-846622@spada.upnyk.ac.id");
    expect(pendingFormatted.description).toContain(
      "https://spada.upnyk.ac.id/mod/assign/view.php?id=846622"
    );
    expect(pendingFormatted.spadaHash).toMatch(/^[a-f0-9]{64}$/);

    const submittedFormatted = await formatScannedAssignment(SAMPLE_SUBMITTED);
    expect(submittedFormatted.title).toBe("✅ [SELESAI] Tugas Kelompok — Sistem Operasi IF-C");
  });

  it("Deduplicates exact UID and .ics fallback, skips unchanged, updates existing_only when matched, and ignores unmatched existing_only", async () => {
    const formattedPending = await formatScannedAssignment(SAMPLE_PENDING);
    const formattedSubmitted = await formatScannedAssignment(SAMPLE_SUBMITTED);
    const unchangedAssign: ScannedAssignment = {
      ...SAMPLE_PENDING,
      cmid: "846700",
      title: "Quiz Persiapan",
    };
    const formattedUnchanged = await formatScannedAssignment(unchangedAssign);

    const unmatchedExistingOnlyAssign: ScannedAssignment = {
      ...SAMPLE_SUBMITTED,
      cmid: "846701",
      title: "Tugas Lama Tanpa Remote",
    };
    const formattedUnmatchedExistingOnly = await formatScannedAssignment(unmatchedExistingOnlyAssign);

    const remoteEvents: RemoteCalendarEvent[] = [
      // Fallback .ics event with different UID and due time within 2 minutes tolerance
      {
        googleEventId: "gcal_ics_os",
        summary: "📌 [TUGAS] Tugas Kelompok — Sistem Operasi IF-C",
        startIso: "2026-11-15T17:00:00.000Z", // +1 minute from SAMPLE_SUBMITTED
        spadaSource: "spada-upnyk-sync",
        spadaUid: "1444125@spada.upnyk.ac.id",
        spadaHash: "old_ics_hash",
      },
      // Exact UID match with identical hash -> skip
      {
        googleEventId: "gcal_exact_skip",
        summary: formattedUnchanged.title,
        startIso: formattedUnchanged.startIso,
        spadaSource: "spada-upnyk-sync",
        spadaUid: formattedUnchanged.spadaUid,
        spadaHash: formattedUnchanged.spadaHash,
      },
      // Remote event whose assignment disappeared from scan -> untouched (no delete)
      {
        googleEventId: "gcal_orphan",
        summary: "📌 [TUGAS] Tugas Hilang — Lainnya",
        startIso: "2026-11-10T10:00:00.000Z",
        spadaSource: "spada-upnyk-sync",
        spadaUid: "assign-111111@spada.upnyk.ac.id",
        spadaHash: "orphan_hash",
      },
    ];

    const candidates: LocalSyncCandidate[] = [
      { event: formattedPending, allowCreate: true },
      // existing_only with .ics remote match -> UPDATE keeping remote targetSpadaUid
      { event: formattedSubmitted, allowCreate: false },
      { event: formattedUnchanged, allowCreate: true },
      // existing_only without remote match -> neither created nor skipped
      { event: formattedUnmatchedExistingOnly, allowCreate: false },
    ];

    const plan = computeExtensionSyncPlan(candidates, remoteEvents);
    expect(plan.toCreate.map((e) => e.spadaUid)).toEqual(["assign-846622@spada.upnyk.ac.id"]);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0]!.googleEventId).toBe("gcal_ics_os");
    expect(plan.toUpdate[0]!.targetSpadaUid).toBe("1444125@spada.upnyk.ac.id");
    expect(plan.toSkip.map((e) => e.spadaUid)).toEqual([formattedUnchanged.spadaUid]);
    expect("toDelete" in plan).toBe(false);
  });

  it("Updates an existing remote submitted event back to pending symmetrically under submitted_only", async () => {
    const reopenedPending: ScannedAssignment = {
      ...SAMPLE_SUBMITTED,
      submitted: false,
      submissionStatus: "Belum mengajukan",
    };
    const formattedReopened = await formatScannedAssignment(reopenedPending);
    const prevSubmitted = await formatScannedAssignment(SAMPLE_SUBMITTED);

    const evalRes = evaluateAssignmentForSync(
      reopenedPending,
      settingsWith({ timeFilter: "all", statusFilter: "submitted_only" }),
      FROZEN_NOW_MS
    );
    expect(evalRes).toEqual({ mode: "existing_only", reason: "outside_status" });

    const plan = computeExtensionSyncPlan(
      [{ event: formattedReopened, allowCreate: false }],
      [
        {
          googleEventId: "gcal_exact_reopen",
          summary: prevSubmitted.title,
          startIso: prevSubmitted.startIso,
          spadaSource: "spada-upnyk-sync",
          spadaUid: prevSubmitted.spadaUid,
          spadaHash: prevSubmitted.spadaHash,
        },
      ]
    );

    expect(plan.toCreate).toHaveLength(0);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0]!.googleEventId).toBe("gcal_exact_reopen");
    expect(plan.toUpdate[0]!.targetSpadaUid).toBe(prevSubmitted.spadaUid);
    expect(plan.toUpdate[0]!.event.title).toContain("📌 [TUGAS]");
    expect(plan.toSkip).toHaveLength(0);
  });

  it("Hashes effective reminder & color preferences canonically and isolates pending changes from submitted events (AC6)", async () => {
    const pendingOrderA = await formatScannedAssignment(
      SAMPLE_PENDING,
      settingsWith({ reminderMinutes: [180, 1440], pendingColorId: "11", submittedColorId: "10" })
    );
    const pendingOrderB = await formatScannedAssignment(
      SAMPLE_PENDING,
      settingsWith({ reminderMinutes: [1440, 180], pendingColorId: "11", submittedColorId: "2" })
    );
    expect(pendingOrderA.reminderMinutes).toEqual([1440, 180]);
    expect(pendingOrderA.colorId).toBe("11");
    expect(pendingOrderA.spadaHash).toBe(pendingOrderB.spadaHash);

    const pendingChangedColor = await formatScannedAssignment(
      SAMPLE_PENDING,
      settingsWith({ reminderMinutes: [1440, 180], pendingColorId: "6", submittedColorId: "10" })
    );
    expect(pendingChangedColor.spadaHash).not.toBe(pendingOrderA.spadaHash);

    // Changing pendingColorId and reminderMinutes does NOT change submitted event's effective hash
    const submittedA = await formatScannedAssignment(
      SAMPLE_SUBMITTED,
      settingsWith({ reminderMinutes: [1440, 180], pendingColorId: "11", submittedColorId: "10" })
    );
    const submittedB = await formatScannedAssignment(
      SAMPLE_SUBMITTED,
      settingsWith({ reminderMinutes: [60], pendingColorId: "6", submittedColorId: "10" })
    );
    expect(submittedA.reminderMinutes).toEqual([]);
    expect(submittedA.colorId).toBe("10");
    expect(submittedA.spadaHash).toBe(submittedB.spadaHash);
  });

  it("Never overwrites another extension assignment (Tugas 1 vs Tugas 10), rejects non-.ics UIDs and substring false matches, and ignores ambiguous legacy .ics matches (AC3-AC4)", async () => {
    const tugas1Submitted: ScannedAssignment = {
      ...SAMPLE_PENDING,
      cmid: "1",
      title: "Tugas 1",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=1",
      dueDateIso: "2026-11-20T17:00:00.000Z",
      submitted: true,
      submissionStatus: "Terkirim",
    };
    const formattedTugas1 = await formatScannedAssignment(tugas1Submitted);

    // Case A: Calendar only has extension-created Tugas 10 (assign-10) with same course & deadline
    const remoteAssign10: RemoteCalendarEvent = {
      googleEventId: "gcal_assign_10",
      summary: "📌 [TUGAS] Tugas 10 — Kapita Selekta IF-C",
      startIso: "2026-11-20T17:00:00.000Z",
      spadaSource: "spada-upnyk-sync",
      spadaUid: "assign-10@spada.upnyk.ac.id",
      spadaHash: "hash_assign_10",
    };

    const planVsAssign10 = computeExtensionSyncPlan(
      [{ event: formattedTugas1, allowCreate: false }],
      [remoteAssign10]
    );
    expect(planVsAssign10.toCreate).toHaveLength(0);
    expect(planVsAssign10.toUpdate).toHaveLength(0);
    expect(planVsAssign10.toSkip).toHaveLength(0);

    // Case B: Calendar only has legacy .ics Tugas 10 (numeric UID) with same course & deadline
    const remoteIcs10: RemoteCalendarEvent = {
      googleEventId: "gcal_ics_10",
      summary: "📌 [TUGAS] Tugas 10 — Kapita Selekta IF-C",
      startIso: "2026-11-20T17:00:00.000Z",
      spadaSource: "spada-upnyk-sync",
      spadaUid: "990010@spada.upnyk.ac.id",
      spadaHash: "hash_ics_10",
    };

    const planVsIcs10 = computeExtensionSyncPlan(
      [{ event: formattedTugas1, allowCreate: false }],
      [remoteIcs10]
    );
    expect(planVsIcs10.toCreate).toHaveLength(0);
    expect(planVsIcs10.toUpdate).toHaveLength(0);
    expect(planVsIcs10.toSkip).toHaveLength(0);

    // Case C: Calendar has another extension UID with identical title/course/time (assign-999) -> must NOT match via fallback
    const remoteDifferentExtUid: RemoteCalendarEvent = {
      googleEventId: "gcal_assign_999",
      summary: "📌 [TUGAS] Tugas 1 — Kapita Selekta IF-C",
      startIso: "2026-11-20T17:00:00.000Z",
      spadaSource: "spada-upnyk-sync",
      spadaUid: "assign-999@spada.upnyk.ac.id",
      spadaHash: "hash_assign_999",
    };
    const planVsOtherExtUid = computeExtensionSyncPlan(
      [{ event: formattedTugas1, allowCreate: false }],
      [remoteDifferentExtUid]
    );
    expect(planVsOtherExtUid.toUpdate).toHaveLength(0);

    // Case D: Two ambiguous legacy .ics remote events match Tugas 1 -> ignore ambiguous match
    const ambiguousIcs: RemoteCalendarEvent[] = [
      {
        googleEventId: "gcal_ics_dup_a",
        summary: "📌 [TUGAS] Tugas 1 — Kapita Selekta IF-C",
        startIso: "2026-11-20T17:00:00.000Z",
        spadaSource: "spada-upnyk-sync",
        spadaUid: "990001@spada.upnyk.ac.id",
        spadaHash: "hash_a",
      },
      {
        googleEventId: "gcal_ics_dup_b",
        summary: "📌 [TUGAS] Tugas 1 — Kapita Selekta IF-C",
        startIso: "2026-11-20T17:01:00.000Z",
        spadaSource: "spada-upnyk-sync",
        spadaUid: "990002@spada.upnyk.ac.id",
        spadaHash: "hash_b",
      },
    ];
    const planAmbiguous = computeExtensionSyncPlan(
      [{ event: formattedTugas1, allowCreate: false }],
      ambiguousIcs
    );
    expect(planAmbiguous.toUpdate).toHaveLength(0);
    expect(planAmbiguous.toSkip).toHaveLength(0);
  });

  it("Rejects non-legacy spadaUid (unknown-import), partial-title non-emdash summaries (Tugas 1 Revisi - IF-C), and bipartite contested fallback (A->{100,200}, B->{100}) (AC3-AC4)", async () => {
    // 1. Unknown non-legacy UID with identical title, course, and timestamp -> rejected
    const tugas1 = await formatScannedAssignment({
      ...SAMPLE_PENDING,
      cmid: "1",
      title: "Tugas 1",
      shortCourseName: "IF-C",
      dueDateIso: "2026-11-20T17:00:00.000Z",
      submitted: true,
    });
    const remoteUnknownUid: RemoteCalendarEvent = {
      googleEventId: "gcal_unknown",
      summary: "📌 [TUGAS] Tugas 1 — IF-C",
      startIso: "2026-11-20T17:00:00.000Z",
      spadaSource: "spada-upnyk-sync",
      spadaUid: "unknown-import",
      spadaHash: "hash_unknown",
    };
    const planUnknown = computeExtensionSyncPlan(
      [{ event: tugas1, allowCreate: false }],
      [remoteUnknownUid]
    );
    expect(planUnknown.toUpdate).toHaveLength(0);
    expect(planUnknown.toSkip).toHaveLength(0);

    // 2. Legacy .ics event with "Tugas 1 Revisi - IF-C" (no em-dash) must NOT match local "Tugas 1"
    const remoteRevisi: RemoteCalendarEvent = {
      googleEventId: "gcal_ics_revisi",
      summary: "Tugas 1 Revisi - IF-C",
      startIso: "2026-11-20T17:00:00.000Z",
      spadaSource: "spada-upnyk-sync",
      spadaUid: "1444100@spada.upnyk.ac.id",
      spadaHash: "hash_revisi",
    };
    const planRevisi = computeExtensionSyncPlan(
      [{ event: tugas1, allowCreate: false }],
      [remoteRevisi]
    );
    expect(planRevisi.toUpdate).toHaveLength(0);
    expect(planRevisi.toSkip).toHaveLength(0);

    // 3. Bipartite contention: Local A matches remote 100 and 200; Local B matches only remote 100.
    // Because remote 100 is contested by both A and B, neither A nor B may patch remote 100.
    const localA = await formatScannedAssignment({
      ...SAMPLE_PENDING,
      cmid: "201",
      title: "Tugas 1",
      shortCourseName: "IF-C",
      dueDateIso: "2026-11-20T17:00:30.000Z", // within 2m of both 17:00:00 and 17:01:30
      submitted: true,
    });
    const localB = await formatScannedAssignment({
      ...SAMPLE_PENDING,
      cmid: "202",
      title: "Tugas 1",
      shortCourseName: "IF-C",
      dueDateIso: "2026-11-20T16:59:00.000Z", // within 2m of 17:00:00 ONLY (2m30s from 17:01:30)
      submitted: true,
    });
    const remote100: RemoteCalendarEvent = {
      googleEventId: "gcal_100",
      summary: "📌 [TUGAS] Tugas 1 — IF-C",
      startIso: "2026-11-20T17:00:00.000Z",
      spadaSource: "spada-upnyk-sync",
      spadaUid: "1444100@spada.upnyk.ac.id",
      spadaHash: "hash_100",
    };
    const remote200: RemoteCalendarEvent = {
      googleEventId: "gcal_200",
      summary: "📌 [TUGAS] Tugas 1 — IF-C",
      startIso: "2026-11-20T17:01:30.000Z",
      spadaSource: "spada-upnyk-sync",
      spadaUid: "1444200@spada.upnyk.ac.id",
      spadaHash: "hash_200",
    };

    const planContested = computeExtensionSyncPlan(
      [
        { event: localA, allowCreate: false },
        { event: localB, allowCreate: false },
      ],
      [remote100, remote200]
    );
    expect(planContested.toCreate).toHaveLength(0);
    expect(planContested.toUpdate).toHaveLength(0);
    expect(planContested.toSkip).toHaveLength(0);
  });

  it("Preserves meaningful punctuation (Latihan C++ vs Latihan C#) and matches legacy summaries when course name contains a hyphen (Algoritma - Kelas A) (AC3-AC4)", async () => {
    // High: C++ must NOT match C# via punctuation stripping
    const latihanCpp = await formatScannedAssignment({
      ...SAMPLE_PENDING,
      cmid: "301",
      title: "Latihan C++",
      shortCourseName: "IF-C",
      dueDateIso: "2026-11-20T17:00:00.000Z",
      submitted: true,
    });
    const remoteCSharp: RemoteCalendarEvent = {
      googleEventId: "gcal_ics_csharp",
      summary: "📌 [TUGAS] Latihan C# — IF-C",
      startIso: "2026-11-20T17:00:00.000Z",
      spadaSource: "spada-upnyk-sync",
      spadaUid: "1444301@spada.upnyk.ac.id",
      spadaHash: "hash_csharp",
    };

    const planCppVsCSharp = computeExtensionSyncPlan(
      [{ event: latihanCpp, allowCreate: false }],
      [remoteCSharp]
    );
    expect(planCppVsCSharp.toCreate).toHaveLength(0);
    expect(planCppVsCSharp.toUpdate).toHaveLength(0);
    expect(planCppVsCSharp.toSkip).toHaveLength(0);

    // Medium: Course name containing " - " must still match legacy "Tugas 1 — Algoritma - Kelas A" without creating duplicate
    const tugasAlgo = await formatScannedAssignment({
      ...SAMPLE_PENDING,
      cmid: "302",
      title: "Tugas 1",
      courseName: "Algoritma - Kelas A (20261)",
      shortCourseName: "Algoritma - Kelas A",
      dueDateIso: "2026-11-20T17:00:00.000Z",
      submitted: false,
    });
    const remoteAlgoLegacy: RemoteCalendarEvent = {
      googleEventId: "gcal_ics_algo",
      summary: "Tugas 1 — Algoritma - Kelas A",
      startIso: "2026-11-20T17:00:00.000Z",
      spadaSource: "spada-upnyk-sync",
      spadaUid: "1444302@spada.upnyk.ac.id",
      spadaHash: "old_algo_hash",
    };

    const planAlgo = computeExtensionSyncPlan(
      [{ event: tugasAlgo, allowCreate: true }],
      [remoteAlgoLegacy]
    );
    expect(planAlgo.toCreate).toHaveLength(0);
    expect(planAlgo.toUpdate).toHaveLength(1);
    expect(planAlgo.toUpdate[0]!.googleEventId).toBe("gcal_ics_algo");
    expect(planAlgo.toUpdate[0]!.targetSpadaUid).toBe("1444302@spada.upnyk.ac.id");
    expect(planAlgo.toSkip).toHaveLength(0);

    // Medium: NFC preserves distinct superscript/subscript scientific notation (m² vs m₂)
    const konversiSup = await formatScannedAssignment({
      ...SAMPLE_PENDING,
      cmid: "303",
      title: "Konversi m²",
      shortCourseName: "IF-C",
      dueDateIso: "2026-11-20T17:00:00.000Z",
      submitted: true,
    });
    const remoteSub: RemoteCalendarEvent = {
      googleEventId: "gcal_ics_sub",
      summary: "📌 [TUGAS] Konversi m₂ — IF-C",
      startIso: "2026-11-20T17:00:00.000Z",
      spadaSource: "spada-upnyk-sync",
      spadaUid: "1444303@spada.upnyk.ac.id",
      spadaHash: "hash_sub",
    };

    const planNotation = computeExtensionSyncPlan(
      [{ event: konversiSup, allowCreate: false }],
      [remoteSub]
    );
    expect(planNotation.toCreate).toHaveLength(0);
    expect(planNotation.toUpdate).toHaveLength(0);
    expect(planNotation.toSkip).toHaveLength(0);
  });
});
