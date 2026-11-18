import { describe, expect, it } from "vitest";
import {
  listRemoteSpadaEvents,
  toGoogleCalendarPayload,
} from "../src/calendar/google-calendar-rest.js";
import { formatScannedAssignment } from "../src/sync/formatter-and-diff.js";

describe("toGoogleCalendarPayload", () => {
  it("Builds Google Calendar v3 event payload with popup reminders for pending assignments and none for submitted", async () => {
    const pending = await formatScannedAssignment({
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
    });

    const payload = toGoogleCalendarPayload(pending);
    expect(payload.summary).toBe("📌 [TUGAS] AI For Music — Kapita Selekta IF-C");
    expect(payload.start).toEqual({
      dateTime: "2026-11-20T17:00:00.000Z",
      timeZone: "Asia/Jakarta",
    });
    expect(payload.reminders).toEqual({
      useDefault: false,
      overrides: [
        { method: "popup", minutes: 1440 },
        { method: "popup", minutes: 180 },
      ],
    });
    expect(payload.extendedProperties.private.spadaUid).toBe(
      "assign-846622@spada.upnyk.ac.id"
    );

    const submitted = await formatScannedAssignment({
      cmid: "814603",
      title: "Unggah Laporan Pemateri 1",
      topic: "2",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=814603",
      courseId: "52581",
      courseName: "Kapita Selekta IF-C (20261)",
      shortCourseName: "Kapita Selekta IF-C",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
      dueDateIso: "2026-09-05T17:00:00.000Z",
      dueDateText: "Sunday, 6 September 2026, 00:00",
      submissionStatus: "Terkirim dan siap dinilai",
      submitted: true,
      grade: "-",
    });

    const submittedPayload = toGoogleCalendarPayload(submitted, "1444125@spada.upnyk.ac.id");
    expect(submittedPayload.reminders).toEqual({ useDefault: false, overrides: [] });
    expect(submittedPayload.extendedProperties.private.spadaUid).toBe(
      "1444125@spada.upnyk.ac.id"
    );
  });
});

describe("listRemoteSpadaEvents", () => {
  it("Paginates Google Calendar REST API results and extracts spada metadata", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = async (input) => {
      calls++;
      const url = String(input);
      if (!url.includes("pageToken=next2")) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: "ev1",
                summary: "Task 1",
                start: { dateTime: "2026-11-20T17:00:00Z" },
                extendedProperties: {
                  private: {
                    spadaSource: "spada-upnyk-sync",
                    spadaUid: "assign-1@spada.upnyk.ac.id",
                    spadaHash: "hash1",
                  },
                },
              },
            ],
            nextPageToken: "next2",
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          items: [
            {
              id: "ev2",
              summary: "Task 2",
              start: { dateTime: "2026-11-21T17:00:00Z" },
              extendedProperties: {
                private: {
                  spadaSource: "spada-upnyk-sync",
                  spadaUid: "assign-2@spada.upnyk.ac.id",
                  spadaHash: "hash2",
                },
              },
            },
          ],
        }),
        { status: 200 }
      );
    };

    const events = await listRemoteSpadaEvents("fake_token", "primary", fakeFetch);
    expect(calls).toBe(2);
    expect(events).toHaveLength(2);
    expect(events[1]!.spadaUid).toBe("assign-2@spada.upnyk.ac.id");
  });
});
