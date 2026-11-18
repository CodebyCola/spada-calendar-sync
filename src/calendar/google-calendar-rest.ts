import type {
  FormattedExtensionEvent,
  RemoteCalendarEvent,
} from "../sync/formatter-and-diff.js";

const GCAL_API_BASE = "https://www.googleapis.com/calendar/v3";
const TIME_ZONE = "Asia/Jakarta";
const SPADA_SOURCE_TAG = "spada-upnyk-sync";

export class GoogleCalendarApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "GoogleCalendarApiError";
  }
}

export interface GoogleCalendarEventPayload {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  reminders: {
    useDefault: boolean;
    overrides: Array<{ method: "popup"; minutes: number }>;
  };
  extendedProperties: {
    private: {
      spadaSource: string;
      spadaUid: string;
      spadaHash: string;
      spadaKind: string;
    };
  };
}

export function toGoogleCalendarPayload(
  event: FormattedExtensionEvent,
  overrideSpadaUid?: string
): GoogleCalendarEventPayload {
  return {
    summary: event.title,
    description: event.description,
    start: {
      dateTime: event.startIso,
      timeZone: TIME_ZONE,
    },
    end: {
      dateTime: event.endIso,
      timeZone: TIME_ZONE,
    },
    reminders: {
      useDefault: false,
      overrides: event.submitted
        ? []
        : [
            { method: "popup", minutes: 1440 },
            { method: "popup", minutes: 180 },
          ],
    },
    extendedProperties: {
      private: {
        spadaSource: SPADA_SOURCE_TAG,
        spadaUid: overrideSpadaUid ?? event.spadaUid,
        spadaHash: event.spadaHash,
        spadaKind: "ASSIGNMENT",
      },
    },
  };
}

interface GoogleEventsListResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    start?: { dateTime?: string; date?: string };
    extendedProperties?: {
      private?: Record<string, string>;
    };
  }>;
  nextPageToken?: string;
}

async function parseErrorResponse(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text || res.statusText;
  } catch {
    return res.statusText;
  }
}

export async function listRemoteSpadaEvents(
  accessToken: string,
  calendarId = "primary",
  fetchImpl: typeof fetch = fetch
): Promise<RemoteCalendarEvent[]> {
  const results: RemoteCalendarEvent[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${GCAL_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`
    );
    url.searchParams.set("privateExtendedProperty", `spadaSource=${SPADA_SOURCE_TAG}`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", "2500");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) {
      throw new GoogleCalendarApiError(res.status, await parseErrorResponse(res));
    }

    const data = (await res.json()) as GoogleEventsListResponse;
    for (const item of data.items ?? []) {
      const priv = item.extendedProperties?.private;
      const spadaUid = priv?.spadaUid;
      if (!item.id || !spadaUid) {
        continue;
      }
      results.push({
        googleEventId: item.id,
        summary: item.summary ?? "",
        startIso: item.start?.dateTime ?? item.start?.date ?? "",
        spadaSource: priv?.spadaSource ?? SPADA_SOURCE_TAG,
        spadaUid,
        spadaHash: priv?.spadaHash ?? "",
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return results;
}

export async function createRemoteEvent(
  accessToken: string,
  calendarId: string,
  event: FormattedExtensionEvent,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const url = `${GCAL_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toGoogleCalendarPayload(event)),
  });

  if (!res.ok) {
    throw new GoogleCalendarApiError(res.status, await parseErrorResponse(res));
  }

  const data = (await res.json()) as { id?: string };
  return data.id ?? "";
}

export async function patchRemoteEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
  event: FormattedExtensionEvent,
  targetSpadaUid: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const url = `${GCAL_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`;
  const res = await fetchImpl(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(toGoogleCalendarPayload(event, targetSpadaUid)),
  });

  if (!res.ok) {
    throw new GoogleCalendarApiError(res.status, await parseErrorResponse(res));
  }
}
