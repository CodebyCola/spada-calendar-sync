import { describe, expect, it } from "vitest";
import type { ScannedAssignment } from "../src/parsers/spada-html.js";
import {
  computeExtensionSyncPlan,
  filterSyncableAssignments,
  formatScannedAssignment,
  type RemoteCalendarEvent,
} from "../src/sync/formatter-and-diff.js";

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

describe("filterSyncableAssignments", () => {
  it("Skips assignments without due dates and optionally filters assignments older than 7 days", () => {
    const oldAssign: ScannedAssignment = {
      ...SAMPLE_PENDING,
      cmid: "814603",
      dueDateIso: "2026-09-05T17:00:00.000Z",
    };
    const noDateAssign: ScannedAssignment = {
      ...SAMPLE_PENDING,
      cmid: "999999",
      dueDateIso: null,
    };

    const nowMs = Date.parse("2026-11-18T11:00:00.000Z");
    const filtered = filterSyncableAssignments(
      [SAMPLE_PENDING, SAMPLE_SUBMITTED, oldAssign, noDateAssign],
      { includePastAssignments: false, syncSubmitted: true, nowMs }
    );
    expect(filtered.map((a) => a.cmid)).toEqual(["846622", "812118"]);

    const excludeSubmitted = filterSyncableAssignments(
      [SAMPLE_PENDING, SAMPLE_SUBMITTED],
      { includePastAssignments: false, syncSubmitted: false, nowMs }
    );
    expect(excludeSubmitted.map((a) => a.cmid)).toEqual(["846622"]);
  });
});

describe("formatScannedAssignment & computeExtensionSyncPlan", () => {
  it("Formats pending and submitted titles cleanly with SHA-256 hash", async () => {
    const pendingFormatted = await formatScannedAssignment(SAMPLE_PENDING);
    expect(pendingFormatted.title).toBe("📌 [TUGAS] AI For Music — Kapita Selekta IF-C");
    expect(pendingFormatted.spadaUid).toBe("assign-846622@spada.upnyk.ac.id");
    expect(pendingFormatted.description).toContain("https://spada.upnyk.ac.id/mod/assign/view.php?id=846622");
    expect(pendingFormatted.spadaHash).toMatch(/^[a-f0-9]{64}$/);

    const submittedFormatted = await formatScannedAssignment(SAMPLE_SUBMITTED);
    expect(submittedFormatted.title).toBe("✅ [SELESAI] Tugas Kelompok — Sistem Operasi IF-C");
  });

  it("Deduplicates against existing .ics-synced events by matching title, course, and due timestamp", async () => {
    const formattedPending = await formatScannedAssignment(SAMPLE_PENDING);
    const formattedSubmitted = await formatScannedAssignment(SAMPLE_SUBMITTED);

    const remoteEvents: RemoteCalendarEvent[] = [
      {
        googleEventId: "gcal_ics_os",
        summary: "📌 [TUGAS] Tugas Kelompok — Sistem Operasi IF-C",
        startIso: "2026-11-15T16:59:00.000Z",
        spadaSource: "spada-upnyk-sync",
        spadaUid: "1444125@spada.upnyk.ac.id",
        spadaHash: "old_ics_hash",
      },
    ];

    const plan = computeExtensionSyncPlan([formattedPending, formattedSubmitted], remoteEvents);
    expect(plan.toCreate.map((e) => e.spadaUid)).toEqual(["assign-846622@spada.upnyk.ac.id"]);
    expect(plan.toUpdate).toHaveLength(1);
    expect(plan.toUpdate[0]!.googleEventId).toBe("gcal_ics_os");
    expect(plan.toUpdate[0]!.targetSpadaUid).toBe("1444125@spada.upnyk.ac.id");
    expect(plan.toSkip).toHaveLength(0);
  });
});
