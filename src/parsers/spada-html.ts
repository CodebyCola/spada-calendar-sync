export interface SpadaCourse {
  courseId: string;
  courseName: string;
  shortCourseName: string;
  courseUrl: string;
}

export interface ScannedAssignment {
  cmid: string;
  title: string;
  topic: string;
  assignUrl: string;
  courseId: string;
  courseName: string;
  shortCourseName: string;
  courseUrl: string;
  dueDateIso: string | null;
  dueDateText: string;
  submissionStatus: string;
  submitted: boolean;
  grade: string;
}

const SPADA_BASE = "https://spada.upnyk.ac.id";

const MONTHS: Record<string, number> = {
  january: 0,
  januari: 0,
  jan: 0,
  february: 1,
  februari: 1,
  feb: 1,
  march: 2,
  maret: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  mei: 4,
  june: 5,
  juni: 5,
  jun: 5,
  july: 6,
  juli: 6,
  jul: 6,
  august: 7,
  agustus: 7,
  agu: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oktober: 9,
  oct: 9,
  okt: 9,
  november: 10,
  nov: 10,
  december: 11,
  desember: 11,
  dec: 11,
  des: 11,
};

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function stripCourseSemesterSuffix(courseName: string): string {
  return courseName.replace(/\s*\(\d{5}\)\s*$/, "").trim();
}

/**
 * Checks if fetched SPADA HTML is an unauthenticated login/bot-check page.
 */
export function isSpadaLoginHtml(html: string): boolean {
  const hasLoginForm =
    /\/login\/index\.php/i.test(html) &&
    (/id=["']login["']/i.test(html) || /Anda belum masuk/i.test(html));
  const hasNavCourses = /id=["']nav-drawer["'][\s\S]*\/course\/view\.php\?id=\d+/i.test(html);
  return hasLoginForm && !hasNavCourses;
}

/**
 * Extracts active semester courses exclusively from Moodle's `#nav-drawer` sidebar.
 */
export function parseEnrolledCoursesHtml(html: string): SpadaCourse[] {
  const navStart = html.search(/<div[^>]+id=["']nav-drawer["']/i);
  if (navStart === -1) {
    return [];
  }

  const afterNavStart = html.slice(navStart);
  const navEndOffset = afterNavStart.search(/<\/nav>/i);
  const drawerSlice =
    navEndOffset !== -1 ? afterNavStart.slice(0, navEndOffset + 6) : afterNavStart.slice(0, 40_000);

  const courses: SpadaCourse[] = [];
  const seen = new Set<string>();
  const linkRegex =
    /<a\b[^>]*href=["']([^"']*\/course\/view\.php\?id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of drawerSlice.matchAll(linkRegex)) {
    const courseId = match[2];
    const innerHtml = match[3] ?? "";
    if (!courseId || seen.has(courseId)) {
      continue;
    }

    const courseName = stripTags(innerHtml);
    if (!courseName) {
      continue;
    }

    seen.add(courseId);
    courses.push({
      courseId,
      courseName,
      shortCourseName: stripCourseSemesterSuffix(courseName),
      courseUrl: `${SPADA_BASE}/course/view.php?id=${courseId}`,
    });
  }

  return courses;
}

/**
 * Parses Moodle's English or Indonesian due date strings (interpreted as Asia/Jakarta UTC+07:00).
 */
export function parseMoodleDueDate(rawText: string): Date | null {
  const cleaned = rawText.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "-") {
    return null;
  }

  const match =
    /(?:[A-Za-z]+,\s*)?(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:,|\s+pukul)?\s+(\d{1,2})[:.](\d{2})/i.exec(
      cleaned
    );
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const monthName = (match[2] ?? "").toLowerCase();
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  const monthIndex = MONTHS[monthName];
  if (monthIndex === undefined) {
    return null;
  }

  // SPADA timestamps are displayed in WIB (UTC+07:00)
  return new Date(Date.UTC(year, monthIndex, day, hour - 7, minute, 0));
}

/**
 * Determines whether a Moodle assignment row status indicates submission completion.
 */
export function isAssignmentSubmitted(statusText: string): boolean {
  const normalized = statusText.trim().toLowerCase();
  if (!normalized || normalized === "-") {
    return false;
  }
  if (/belum|no submission|not submitted|draft|tidak ada upaya/i.test(normalized)) {
    return false;
  }
  return /terkirim|submitted for grading|sudah dikumpulkan|submitted/i.test(normalized);
}

/**
 * Parses `/mod/assign/index.php?id=<courseId>` table rows into structured assignments.
 */
export function parseAssignIndexHtml(html: string, course: SpadaCourse): ScannedAssignment[] {
  const tbodyMatch = /<table[^>]*generaltable[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i.exec(html);
  if (!tbodyMatch) {
    return [];
  }

  const tbody = tbodyMatch[1] ?? "";
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const assignments: ScannedAssignment[] = [];

  for (const rowMatch of tbody.matchAll(rowRegex)) {
    const rowHtml = rowMatch[1] ?? "";
    if (!rowHtml || /tabledivider/i.test(rowHtml) || /colspan=/i.test(rowHtml)) {
      continue;
    }

    const extractCell = (colClass: string): string => {
      const cellRegex = new RegExp(
        `<td\\b[^>]*class=["'][^"']*\\b${colClass}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
        "i"
      );
      return cellRegex.exec(rowHtml)?.[1] ?? "";
    };

    const c0Html = extractCell("c0");
    const c1Html = extractCell("c1");
    const c2Html = extractCell("c2");
    const c3Html = extractCell("c3");
    const c4Html = extractCell("c4");

    const linkMatch =
      /<a\b[^>]*href=["']([^"']*(?:\/mod\/assign\/)?view\.php\?id=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i.exec(
        c1Html
      );
    if (!linkMatch) {
      continue;
    }

    const cmid = linkMatch[2];
    if (!cmid) {
      continue;
    }

    const title = stripTags(linkMatch[3] ?? "") || `Tugas ${cmid}`;
    const topic = stripTags(c0Html);
    const dueDateText = stripTags(c2Html);
    const dueDate = parseMoodleDueDate(dueDateText);
    const submissionStatus = stripTags(c3Html);
    const grade = stripTags(c4Html) || "-";

    assignments.push({
      cmid,
      title,
      topic,
      assignUrl: `${SPADA_BASE}/mod/assign/view.php?id=${cmid}`,
      courseId: course.courseId,
      courseName: course.courseName,
      shortCourseName: course.shortCourseName,
      courseUrl: course.courseUrl,
      dueDateIso: dueDate ? dueDate.toISOString() : null,
      dueDateText,
      submissionStatus,
      submitted: isAssignmentSubmitted(submissionStatus),
      grade,
    });
  }

  return assignments;
}
