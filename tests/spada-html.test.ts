import { describe, expect, it } from "vitest";
import {
  isSpadaLoginHtml,
  parseAssignIndexHtml,
  parseEnrolledCoursesHtml,
  parseMoodleDueDate,
} from "../src/parsers/spada-html.js";

const SAMPLE_MY_HTML = `
<html>
<body>
  <div id="nav-drawer" data-region="drawer" class="d-print-none moodle-has-zindex">
    <nav class="list-group" aria-label="Navigasi">
      <ul>
        <li><a class="list-group-item" href="https://spada.upnyk.ac.id/my/" data-key="myhome">Dasbor</a></li>
        <li><div class="list-group-item" data-key="mycourses">Kursusku</div></li>
        <li>
          <a class="list-group-item list-group-item-action" href="https://spada.upnyk.ac.id/course/view.php?id=52581" data-key="52581" data-type="20">
            <div class="ml-0"><div class="media"><span class="media-left"><i class="icon fa fa-graduation-cap"></i></span><span class="media-body ">Kapita Selekta IF-C (20261)</span></div></div>
          </a>
        </li>
        <li>
          <a class="list-group-item list-group-item-action" href="https://spada.upnyk.ac.id/course/view.php?id=56304" data-key="56304" data-type="20">
            <div class="ml-0"><div class="media"><span class="media-left"><i class="icon fa fa-graduation-cap"></i></span><span class="media-body ">Sistem Operasi IF-C (20261)</span></div></div>
          </a>
        </li>
      </ul>
    </nav>
  </div>
  <div id="page">
    <a href="https://spada.upnyk.ac.id/course/view.php?id=30414">Algoritma dan Pemrograman IF-C (20241)</a>
  </div>
</body>
</html>
`;

const SAMPLE_ASSIGN_INDEX_HTML = `
<html>
<body>
  <div role="main">
    <h2>Penugasan</h2>
    <table class="generaltable">
      <thead>
        <tr>
          <th class="header c0" scope="col">Topik</th>
          <th class="header c1" scope="col">Penugasan</th>
          <th class="header c2" scope="col">Jatuh tempo</th>
          <th class="header c3" scope="col">Pengajuan</th>
          <th class="header c4 lastcol" scope="col">Nilai</th>
        </tr>
      </thead>
      <tbody>
        <tr class="">
          <td class="cell c0">2. Wawasan Kebangsaan di Era Digital 1</td>
          <td class="cell c1"><a href="https://spada.upnyk.ac.id/mod/assign/view.php?id=814603">Unggah Laporan Pemateri 1</a></td>
          <td class="cell c2">Sunday, 6 September 2026, 00:00</td>
          <td class="cell c3">Terkirim dan siap dinilai</td>
          <td class="cell c4 lastcol">-</td>
        </tr>
        <tr><td colspan="5"><div class="tabledivider"></div></td></tr>
        <tr class="">
          <td class="cell c0">12. AI For Music</td>
          <td class="cell c1"><a href="https://spada.upnyk.ac.id/mod/assign/view.php?id=846622">AI For Music</a></td>
          <td class="cell c2">Saturday, 21 November 2026, 00:00</td>
          <td class="cell c3">Belum mengajukan</td>
          <td class="cell c4 lastcol">-</td>
        </tr>
        <tr><td colspan="5"><div class="tabledivider"></div></td></tr>
        <tr class="lastrow">
          <td class="cell c0">13. Agent AI untuk penulisan ilmiah.</td>
          <td class="cell c1"><a href="https://spada.upnyk.ac.id/mod/assign/view.php?id=846623">Agent AI untuk penulisan ilmiah</a></td>
          <td class="cell c2">-</td>
          <td class="cell c3">Belum mengajukan tugas</td>
          <td class="cell c4 lastcol">-</td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>
`;

describe("parseEnrolledCoursesHtml & isSpadaLoginHtml", () => {
  it("Extracts only active courses from #nav-drawer and ignores old courses in #page", () => {
    const courses = parseEnrolledCoursesHtml(SAMPLE_MY_HTML);
    expect(courses).toEqual([
      {
        courseId: "52581",
        courseName: "Kapita Selekta IF-C (20261)",
        shortCourseName: "Kapita Selekta IF-C",
        courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
      },
      {
        courseId: "56304",
        courseName: "Sistem Operasi IF-C (20261)",
        shortCourseName: "Sistem Operasi IF-C",
        courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=56304",
      },
    ]);
  });

  it("Detects Moodle login HTML when session is unauthenticated", () => {
    expect(
      isSpadaLoginHtml('<form action="https://spada.upnyk.ac.id/login/index.php" method="post" id="login">')
    ).toBe(true);
    expect(isSpadaLoginHtml(SAMPLE_MY_HTML)).toBe(false);
  });
});

describe("parseMoodleDueDate", () => {
  it("Parses English and Indonesian Moodle due dates as Asia/Jakarta (UTC+07:00)", () => {
    expect(parseMoodleDueDate("Saturday, 21 November 2026, 00:00")?.toISOString()).toBe(
      "2026-11-20T17:00:00.000Z"
    );
    expect(parseMoodleDueDate("Tuesday, 15 September 2026, 23:59")?.toISOString()).toBe(
      "2026-09-15T16:59:00.000Z"
    );
    expect(parseMoodleDueDate("Sabtu, 21 Desember 2026, 23:59")?.toISOString()).toBe(
      "2026-12-21T16:59:00.000Z"
    );
    expect(parseMoodleDueDate("-")).toBeNull();
  });
});

describe("parseAssignIndexHtml", () => {
  it("Parses assignment rows, skips tabledivider rows, and determines submission status", () => {
    const assignments = parseAssignIndexHtml(SAMPLE_ASSIGN_INDEX_HTML, {
      courseId: "52581",
      courseName: "Kapita Selekta IF-C (20261)",
      shortCourseName: "Kapita Selekta IF-C",
      courseUrl: "https://spada.upnyk.ac.id/course/view.php?id=52581",
    });

    expect(assignments).toHaveLength(3);

    expect(assignments[0]).toMatchObject({
      cmid: "814603",
      title: "Unggah Laporan Pemateri 1",
      topic: "2. Wawasan Kebangsaan di Era Digital 1",
      submitted: true,
      submissionStatus: "Terkirim dan siap dinilai",
      dueDateIso: "2026-09-05T17:00:00.000Z",
      assignUrl: "https://spada.upnyk.ac.id/mod/assign/view.php?id=814603",
    });

    expect(assignments[1]).toMatchObject({
      cmid: "846622",
      title: "AI For Music",
      submitted: false,
      submissionStatus: "Belum mengajukan",
      dueDateIso: "2026-11-20T17:00:00.000Z",
    });

    expect(assignments[2]).toMatchObject({
      cmid: "846623",
      title: "Agent AI untuk penulisan ilmiah",
      submitted: false,
      submissionStatus: "Belum mengajukan tugas",
      dueDateIso: null,
    });
  });
});
