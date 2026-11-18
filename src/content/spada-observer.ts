import { stripCourseSemesterSuffix, type SpadaCourse } from "../parsers/spada-html.js";

function extractNavDrawerCoursesFromDom(): SpadaCourse[] {
  const links = document.querySelectorAll('#nav-drawer a[href*="/course/view.php?id="]');
  const seen = new Set<string>();
  const courses: SpadaCourse[] = [];

  for (const link of links) {
    const href = link.getAttribute("href") ?? "";
    const match = /\/course\/view\.php\?id=(\d+)/.exec(href);
    const courseId = match?.[1];
    if (!courseId || seen.has(courseId)) {
      continue;
    }

    const courseName = (link.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!courseName) {
      continue;
    }

    seen.add(courseId);
    courses.push({
      courseId,
      courseName,
      shortCourseName: stripCourseSemesterSuffix(courseName),
      courseUrl: `https://spada.upnyk.ac.id/course/view.php?id=${courseId}`,
    });
  }

  return courses;
}

async function notifySpadaVisit(): Promise<void> {
  if (window.location.pathname.startsWith("/login/")) {
    return;
  }

  const courses = extractNavDrawerCoursesFromDom();
  if (courses.length === 0) {
    return;
  }

  try {
    await chrome.runtime.sendMessage({
      type: "SPADA_PAGE_VISITED",
      courses,
    });
  } catch {
    // Service worker might be restarting; ignore silently
  }
}

void notifySpadaVisit();
