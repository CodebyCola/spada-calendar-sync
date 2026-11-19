import {
  isCalendarColorId,
  MAX_REMINDER_OVERRIDES,
  normalizeReminderMinutes,
} from "../shared/settings.js";
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
    detail: string,
    public readonly reason?: string
  ) {
    const cleanDetail = detail.trim() || "Unknown Google Calendar API error";
    const formattedMessage = reason
      ? `GCAL HTTP ${status} [${reason}]: ${cleanDetail}`
      : `GCAL HTTP ${status}: ${cleanDetail}`;
    super(formattedMessage);
    this.name = "GoogleCalendarApiError";
  }
}

export type CalendarPayloadMode = "insert" | "patch";

export interface GoogleCalendarEventPayload {
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  colorId?: string | null;
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
  overrideSpadaUid?: string,
  mode: CalendarPayloadMode = "insert"
): GoogleCalendarEventPayload {
  const effectiveMinutes = event.submitted
    ? []
    : normalizeReminderMinutes(event.reminderMinutes).slice(0, MAX_REMINDER_OVERRIDES);

  const validColorId =
    event.colorId && event.colorId !== "default" && isCalendarColorId(event.colorId)
      ? event.colorId
      : null;

  const payload: GoogleCalendarEventPayload = {
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
      overrides: effectiveMinutes.map((minutes) => ({
        method: "popup" as const,
        minutes,
      })),
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

  if (validColorId !== null) {
    payload.colorId = validColorId;
  } else if (mode === "patch") {
    payload.colorId = null;
  }

  return payload;
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

interface GoogleApiErrorBody {
  error?: {
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
}

async function parseErrorResponse(res: Response): Promise<{ detail: string; reason?: string }> {
  let text = "";
  try {
    text = (await res.text()).trim();
  } catch {
    return { detail: res.statusText || "Unknown error" };
  }

  if (!text) {
    return { detail: res.statusText || "Unknown error" };
  }

  try {
    const parsed = JSON.parse(text) as GoogleApiErrorBody;
    const reason = parsed?.error?.errors?.[0]?.reason;
    const message = parsed?.error?.message ?? parsed?.error?.errors?.[0]?.message;
    if (message || reason) {
      return {
        detail: message ?? text,
        reason: typeof reason === "string" && reason.trim() ? reason.trim() : undefined,
      };
    }
  } catch {
    // Plain-text or HTML error body; fall back to raw text
  }

  return { detail: text };
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
      const parsed = await parseErrorResponse(res);
      throw new GoogleCalendarApiError(res.status, parsed.detail, parsed.reason);
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
    body: JSON.stringify(toGoogleCalendarPayload(event, undefined, "insert")),
  });

  if (!res.ok) {
    const parsed = await parseErrorResponse(res);
    throw new GoogleCalendarApiError(res.status, parsed.detail, parsed.reason);
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
    body: JSON.stringify(toGoogleCalendarPayload(event, targetSpadaUid, "patch")),
  });

  if (!res.ok) {
    const parsed = await parseErrorResponse(res);
    throw new GoogleCalendarApiError(res.status, parsed.detail, parsed.reason);
  }
}

export interface CalendarListItemDto {
  id: string;
  label: string;
  primary: boolean;
}

interface GoogleCalendarListResponse {
  items?: Array<{
    id?: string;
    summary?: string;
    summaryOverride?: string;
    accessRole?: string;
    primary?: boolean;
  }>;
  nextPageToken?: string;
}

export async function listWritableCalendars(
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<CalendarListItemDto[]> {
  const seenIds = new Set<string>();
  const calendars: CalendarListItemDto[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GCAL_API_BASE}/users/me/calendarList`);
    url.searchParams.set("minAccessRole", "writer");
    url.searchParams.set("maxResults", "250");
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
      const parsed = await parseErrorResponse(res);
      throw new GoogleCalendarApiError(res.status, parsed.detail, parsed.reason);
    }

    const data = (await res.json()) as GoogleCalendarListResponse;
    for (const item of data.items ?? []) {
      if (item.accessRole !== "owner" && item.accessRole !== "writer") {
        continue;
      }
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id || seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
      const label =
        (typeof item.summaryOverride === "string" && item.summaryOverride.trim()) ||
        (typeof item.summary === "string" && item.summary.trim()) ||
        id;
      calendars.push({
        id,
        label,
        primary: Boolean(item.primary),
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  calendars.sort((a, b) => {
    if (a.primary !== b.primary) {
      return a.primary ? -1 : 1;
    }
    const labelCmp = a.label.localeCompare(b.label, "id", { sensitivity: "base" });
    if (labelCmp !== 0) {
      return labelCmp;
    }
    return a.id.localeCompare(b.id);
  });

  return calendars;
}
