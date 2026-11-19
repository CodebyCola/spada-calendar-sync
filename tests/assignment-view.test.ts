import { describe, expect, it } from "vitest";
import type { ScannedAssignment, SpadaCourse } from "../src/parsers/spada-html.js";
import { DEFAULT_SETTINGS, type ExtensionSettings } from "../src/shared/settings.js";
import {
  buildPopupViewModel,
  DEFAULT_POPUP_VIEW_FILTERS,
  formatRelativeDeadlineWib,
  type PopupViewFilters,
} from "../src/popup/assignment-view.js";

const COURSES: SpadaCourse[] = [
  {
    courseId: "52581",
    courseName: "Kapita Selekta",
    shortCourseName: "Kapita Selekta",
    courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
  },
  {
    courseId: "52582",
    courseName: "Kapita Selekta", // identical name, different ID
    shortCourseName: "Kapita Selekta",
    courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52582",
  },
  {
    courseId: "56304",
    courseName: "Sistem Operasi",
    shortCourseName: "Sistem Operasi",
    courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=56304",
  },
];

function makeAssignment(overrides: Partial<ScannedAssignment>): ScannedAssignment {
  return {
    cmid: "100",
    title: "Tugas Default",
    topic: "Topik 1",
    assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=100",
    courseId: "52581",
    courseName: "Kapita Selekta",
    shortCourseName: "Kapita Selekta",
    courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
    dueDateIso: "2026-11-20T10:00:00.000Z",
    dueDateText: "Friday, 20 November 2026, 17:00",
    submissionStatus: "Belum mengajukan",
    submitted: false,
    grade: "-",
    ...overrides,
  };
}

describe("formatRelativeDeadlineWib (AC2)", () => {
  it("Uses Asia/Jakarta calendar day for Besok across midnight WIB even when only 2 minutes apart", () => {
    const nowMs = Date.parse("2026-11-19T16:59:00.000Z"); // 23:59 WIB on Nov 19
    const dueIso = "2026-11-19T17:01:00.000Z"; // 00:01 WIB on Nov 20

    const formatted = formatRelativeDeadlineWib(dueIso, nowMs, false);
    expect(formatted.relativeLabel).toContain("Besok");
    expect(formatted.relativeLabel).toContain("2 menit lagi");
    expect(formatted.absoluteLabel).toContain("WIB");
    expect(formatted.urgency).toBe("soon");
  });

  it("Handles exact deadline moment, same-day future, and same-day overdue", () => {
    const nowMs = Date.parse("2026-11-19T05:00:00.000Z"); // 12:00 WIB

    const exact = formatRelativeDeadlineWib("2026-11-19T05:00:00.000Z", nowMs, false);
    expect(exact.relativeLabel).toBe("Jatuh tempo sekarang");
    expect(exact.urgency).toBe("urgent");

    const sameDayFuture = formatRelativeDeadlineWib("2026-11-19T09:00:00.000Z", nowMs, false);
    expect(sameDayFuture.relativeLabel).toBe("Hari ini • 4 jam lagi");
    expect(sameDayFuture.urgency).toBe("urgent");

    const sameDayOverdue = formatRelativeDeadlineWib("2026-11-19T03:00:00.000Z", nowMs, false);
    expect(sameDayOverdue.relativeLabel).toBe("Hari ini • Lewat 2 jam");
    expect(sameDayOverdue.urgency).toBe("overdue");
  });

  it("Safely handles null and invalid dueDateIso without throwing", () => {
    const nowMs = Date.parse("2026-11-19T05:00:00.000Z");
    const noDate = formatRelativeDeadlineWib(null, nowMs, false);
    expect(noDate.relativeLabel).toBe("Tanpa deadline");
    expect(noDate.absoluteLabel).toBe("Tanpa deadline");
    expect(noDate.urgency).toBe("none");

    const invalidDate = formatRelativeDeadlineWib("not-a-date", nowMs, false);
    expect(invalidDate.relativeLabel).toBe("Tanpa deadline");
    expect(invalidDate.absoluteLabel).toBe("Tanpa deadline");
    expect(invalidDate.urgency).toBe("none");
  });
});

describe("buildPopupViewModel (AC4, AC5)", () => {
  it("Keeps global createCandidateCount equal to 4 even when local view filters leave only 1 visible card", () => {
    const nowMs = Date.parse("2026-11-19T05:00:00.000Z");
    const assignments = [
      makeAssignment({ cmid: "1", courseId: "52581", title: "Tugas 1" }),
      makeAssignment({ cmid: "2", courseId: "52581", title: "Tugas 2", submitted: true }),
      makeAssignment({ cmid: "3", courseId: "52582", title: "Tugas 3" }),
      makeAssignment({ cmid: "4", courseId: "56304", title: "Tugas 4" }),
    ];
    const settings: ExtensionSettings = {
      ...DEFAULT_SETTINGS,
      timeFilter: "upcoming_only",
      statusFilter: "all",
    };
    const filters: PopupViewFilters = {
      courseId: "52581",
      status: "pending",
      time: "all",
    };

    const vm = buildPopupViewModel({
      assignments,
      courses: COURSES,
      settings,
      viewFilters: filters,
      lastScanAt: "2026-11-19T04:55:00.000Z",
      nowMs,
    });

    expect(vm.createCandidateCount).toBe(4);
    expect(vm.visibleCards).toHaveLength(1);
    expect(vm.visibleCards[0]!.assignment.cmid).toBe("1");
    expect(vm.syncButtonLabel).toBe("📅 Sync ke Calendar (4 kandidat)");
    expect(vm.syncPreviewHint).toBe(
      "Cocok untuk event baru pada scan terakhir; event lama juga diperiksa."
    );
  });

  it("Disambiguates courses with identical names using courseId while keeping courseId as option value", () => {
    const nowMs = Date.parse("2026-11-19T05:00:00.000Z");
    const vm = buildPopupViewModel({
      assignments: [makeAssignment({ cmid: "1", courseId: "52582" })],
      courses: COURSES,
      settings: DEFAULT_SETTINGS,
      viewFilters: { courseId: "52582", status: "all", time: "all" },
      lastScanAt: "2026-11-19T04:55:00.000Z",
      nowMs,
    });

    expect(vm.courseOptions).toEqual([
      { value: "all", label: "Semua mata kuliah" },
      { value: "52581", label: "Kapita Selekta (ID 52581)" },
      { value: "52582", label: "Kapita Selekta (ID 52582)" },
      { value: "56304", label: "Sistem Operasi" },
    ]);
    expect(vm.visibleCards).toHaveLength(1);
    expect(vm.visibleCards[0]!.assignment.courseId).toBe("52582");
  });

  it("Reports 0 create candidates with existing-only reason, shows no-deadline and excluded cards in view, and provides resettable empty state", () => {
    const nowMs = Date.parse("2026-11-19T05:00:00.000Z");
    const existingOnlyTask = makeAssignment({
      cmid: "10",
      courseId: "56304",
      submitted: true,
      dueDateIso: "2026-11-20T10:00:00.000Z",
    });
    const noDeadlineTask = makeAssignment({
      cmid: "11",
      courseId: "56304",
      dueDateIso: null,
    });
    const excludedTask = makeAssignment({
      cmid: "12",
      courseId: "52581",
      dueDateIso: "2026-11-20T10:00:00.000Z",
    });

    const settings: ExtensionSettings = {
      ...DEFAULT_SETTINGS,
      timeFilter: "upcoming_only",
      statusFilter: "pending_only",
      excludedCourseIds: ["52581"],
    };

    const vmAll = buildPopupViewModel({
      assignments: [existingOnlyTask, noDeadlineTask, excludedTask],
      courses: COURSES,
      settings,
      viewFilters: { courseId: "all", status: "all", time: "all" },
      lastScanAt: "2026-11-19T04:55:00.000Z",
      nowMs,
    });

    expect(vmAll.createCandidateCount).toBe(0);
    expect(vmAll.syncButtonLabel).toBe("📅 Sync ke Calendar (0 kandidat)");
    expect(vmAll.visibleCards).toHaveLength(3);
    expect(vmAll.visibleCards[0]!.syncReasonText).toBe("Hanya memperbarui jika event sudah ada");
    expect(vmAll.visibleCards[1]!.deadline.relativeLabel).toBe("Tanpa deadline");
    expect(vmAll.visibleCards[1]!.evaluation.reason).toBe("no_valid_deadline");
    expect(vmAll.visibleCards[2]!.evaluation.reason).toBe("course_excluded");

    // Empty state caused by filter offers reset
    const vmEmptyFiltered = buildPopupViewModel({
      assignments: [existingOnlyTask],
      courses: COURSES,
      settings,
      viewFilters: DEFAULT_POPUP_VIEW_FILTERS, // pending
      lastScanAt: "2026-11-19T04:55:00.000Z",
      nowMs,
    });
    expect(vmEmptyFiltered.visibleCards).toHaveLength(0);
    expect(vmEmptyFiltered.canResetFilters).toBe(true);
    expect(vmEmptyFiltered.emptyStateMessage).toBeTruthy();

    // Before first scan
    const vmBeforeScan = buildPopupViewModel({
      assignments: [],
      courses: [],
      settings,
      viewFilters: DEFAULT_POPUP_VIEW_FILTERS,
      lastScanAt: null,
      nowMs,
    });
    expect(vmBeforeScan.syncPreviewHint).toBe("Belum ada hasil scan");
    expect(vmBeforeScan.canResetFilters).toBe(false);
  });
});
