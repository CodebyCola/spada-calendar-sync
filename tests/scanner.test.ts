import { describe, expect, it } from "vitest";
import { scanSpadaWithFetcher } from "../src/background/scanner.js";

describe("scanSpadaWithFetcher", () => {
  it("Throws AUTH_REQUIRED when SPADA returns the login page", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        '<html><body>Anda belum masuk <form action="https://spada.upnyk.ac.id/login/index.php" id="login"></form></body></html>',
        { status: 200 }
      );

    await expect(scanSpadaWithFetcher(fakeFetch)).rejects.toThrow(/AUTH_REQUIRED/);
  });

  it("Scans active courses from /my/ and parses /mod/assign/index.php in batches", async () => {
    const requestedUrls: string[] = [];
    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.endsWith("/my/")) {
        return new Response(
          `<div id="nav-drawer"><nav><ul>
            <li><a href="https://spada.upnyk.ac.id/course/view.php?id=52581">Kapita Selekta IF-C (20261)</a></li>
          </ul></nav></div>`,
          { status: 200 }
        );
      }

      if (url.includes("/mod/assign/index.php?id=52581")) {
        return new Response(
          `<table class="generaltable"><tbody>
            <tr>
              <td class="cell c0">12. AI For Music</td>
              <td class="cell c1"><a href="https://spada.upnyk.ac.id/mod/assign/view.php?id=846622">AI For Music</a></td>
              <td class="cell c2">Saturday, 21 November 2026, 00:00</td>
              <td class="cell c3">Belum mengajukan</td>
              <td class="cell c4 lastcol">-</td>
            </tr>
          </tbody></table>`,
          { status: 200 }
        );
      }

      return new Response("", { status: 404 });
    };

    const result = await scanSpadaWithFetcher(fakeFetch);
    expect(requestedUrls).toEqual([
      "https://spada.upnyk.ac.id/my/",
      "https://spada.upnyk.ac.id/mod/assign/index.php?id=52581",
    ]);
    expect(result.courses).toHaveLength(1);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]!.cmid).toBe("846622");
  });
});
