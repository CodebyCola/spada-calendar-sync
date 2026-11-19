# Easy Extension Setup (Unpacked Mode + Guided Onboarding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Follow `mattpocock-skills:tdd` strictly: vertical slices (one failing test → minimal passing implementation → repeat) at the 6 pre-agreed seams.

**Goal:** Enable students to install `spada_calendar_extension` from a ready-to-use unpacked ZIP with zero Google Cloud Console or Node.js steps, guided by an auto-opening 3-step Onboarding Wizard, friendly service-aware error diagnostics, and safe dual-target packaging (`unpacked` vs Chrome Web Store `store`).

**Architecture:** Separate unpacked distribution identity (`config/unpacked-oauth.json`, gitignored, public key + deterministic Extension ID + unpacked OAuth Client ID) from Chrome Web Store manifest (`public/manifest.json`, no `"key"`). Concentrate setup state evaluation, service-aware error diagnostics, install lifecycle, and legacy auth revalidation into small deep modules tested through dependency-injected seams, then wire thin UI adapters for Onboarding, Popup, and Options.

**Tech Stack:** TypeScript 5.6 (strict), Chrome Extension Manifest V3, esbuild 0.24, Vitest 2.1 (`npx vitest run <file> --no-cache`), Node.js >= 22 (`node:crypto`, `node:fs`).

**Spec:** `docs/superpowers/specs/2026-11-19-easy-extension-setup-design.md`

## Global Constraints

- Manifest V3 only; zero new `permissions` (stay `["storage", "alarms", "identity"]`), zero new `host_permissions`, zero new OAuth scopes (stay `https://www.googleapis.com/auth/calendar.events`), no `web_accessible_resources` for `onboarding/onboarding.html`.
- Strict CSP: zero inline `<script>` or inline event handlers in HTML; all error/external text rendered strictly via `.textContent` (never `innerHTML`).
- Never write or commit RSA private keys; `config/unpacked-oauth.json` is gitignored (only `config/unpacked-oauth.example.json` committed) and contains only public key, derived `extensionId`, and `clientId`.
- `public/manifest.json` must NEVER contain `"key"` and must reset `oauth2.client_id` to `YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com` until a real Chrome Web Store Item ID client is registered.
- Relative TypeScript imports use `.js` extensions; `.mjs` build scripts include JSDoc types so `npm run typecheck` (`tsc --noEmit`) passes cleanly.
- Run Vitest with `--no-cache` (`npx vitest run ... --no-cache`) on Windows sandbox to avoid `.vite/vitest/results.json` EPERM.
- Do not change existing assignment extraction logic in `src/parsers/spada-html.ts` or formatter/diff logic in `src/sync/formatter-and-diff.ts`; all 14 existing tests must stay green.

## Review Focus

1. **Malformed/non-canonical base64 or PEM headers passed to `deriveExtensionIdFromPublicKey`** — must reject with a descriptive error rather than hashing garbage bytes into a bogus Extension ID (pinned in Task 1).
2. **`clientId` with surrounding whitespace or missing `.apps.googleusercontent.com` suffix passed to `prepareUnpackedConfig`** — must trim valid inputs and reject malformed IDs clearly before writing config (pinned in Task 3).
3. **Google Calendar API returning non-JSON HTML/plain-text error body on HTTP 403/502 (e.g., plain `"Rate Limit Exceeded"` or gateway HTML)** — `GoogleCalendarApiError` must never crash with `SyntaxError`, must preserve `GCAL HTTP <status>: <detail>`, and `diagnoseSetupError` must classify rate limits as `GCAL_RATE_LIMITED` and `502` as `NETWORK_OR_SERVER` (pinned in Task 4 & Task 5).
4. **Legacy v1.0.0 stored state lacking `googleAuthVerified` when user opens popup offline vs revoked** — `getStoredState()` defaults `googleAuthVerified` to `false`; `revalidateLegacyGoogleAuth` must keep state untouched on offline/network errors and invalidate via `buildDisconnectedStatePatch()` when token is missing or auth is not granted (pinned in Task 6).
5. **Cross-service HTTP 403 & compound OAuth error strings (`SPADA HTTP 403`, `"OAuth2 request failed: access_denied"`, `"GCAL HTTP 403 [rateLimitExceeded]: Rate Limit Exceeded"`)** — each must map to its exact diagnosis (`SPADA_ACCESS_DENIED`, `OAUTH_ACCESS_DENIED`, `GCAL_RATE_LIMITED`) with zero cross-contamination (pinned in Task 5).

---

## File Structure

- **Create:**
  - `scripts/unpacked-manifest.mjs` — Pure unpacked Extension ID derivation, unpacked config validation, and dual-target manifest composition (Seam #1).
  - `scripts/setup-unpacked.mjs` — Pure `prepareUnpackedConfig` + developer CLI helper for `config/unpacked-oauth.json` (Seam #3).
  - `config/unpacked-oauth.example.json` — Committed template showing exact shape of `config/unpacked-oauth.json`.
  - `src/setup/setup-diagnostics.ts` — Pure `diagnoseSetupError` and `evaluateSetupStatus` shared by Onboarding and Popup (Seam #5).
  - `src/background/install-lifecycle.ts` — `buildDisconnectedStatePatch`, `revalidateLegacyGoogleAuth`, and `handleExtensionInstalled` (Seam #6).
  - `src/env.d.ts` — Ambient declaration for esbuild-injected `__BUILD_TARGET__`.
  - `src/onboarding/onboarding.html`, `src/onboarding/onboarding.css`, `src/onboarding/onboarding.ts` — Auto-opening 3-step Guided Onboarding page.
  - `tests/unpacked-manifest.test.ts`, `tests/setup-unpacked.test.ts`, `tests/setup-diagnostics.test.ts`, `tests/install-lifecycle.test.ts` — TDD test suites for new seams.
- **Modify:**
  - `scripts/validate-manifest.mjs` — Add `target?: "store" | "unpacked"` and `disallowedClientIds?: string[]` (Seam #2).
  - `public/manifest.json` — Reset `oauth2.client_id` to Store placeholder `YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com`.
  - `.gitignore` — Ignore `config/unpacked-oauth.json`.
  - `src/parsers/spada-html.ts` — Add `isAuthenticatedSpadaDashboardHtml(html)`.
  - `src/calendar/google-calendar-rest.ts` — Preserve service, HTTP status, and Google reason in `GoogleCalendarApiError` (`GCAL HTTP <status> [<reason>]: <detail>`).
  - `src/background/scanner.ts` — Export `isConfiguredOAuthClientId`, allow authenticated empty SPADA dashboard in `scanSpadaWithFetcher`, and require token acquisition before early return on 0 syncable assignments in `syncAssignmentsToGoogleCalendar` (Seam #4).
  - `src/shared/storage.ts` — Add `googleAuthVerified: boolean` (default `false`) to `StoredExtensionState`.
  - `src/background/service-worker.ts` — Wire `handleExtensionInstalled`, `revalidateLegacyGoogleAuth`, `buildDisconnectedStatePatch`, `googleAuthVerified`, and persist `CONNECT_GOOGLE` failure into `lastSyncError`.
  - `src/popup/popup.html`, `src/popup/popup.ts`, `src/popup/popup.css` — Show `diagnoseSetupError` messages and conditional "Panduan Setup" button when `!hasCompletedInitialSetup`.
  - `src/options/options.html`, `src/options/options.ts`, `src/options/options.css` — Add "Salin ID" button, "Buka Panduan Setup" button, and updated developer guidance.
  - `scripts/build.mjs`, `scripts/package.mjs`, `package.json` — Dual-target `--target=store|unpacked`, `__BUILD_TARGET__` define, `onboarding/onboarding` bundle & verification, `disallowedClientIds` cross-check, and new npm scripts (`setup:unpacked`, `build:unpacked`, `package:unpacked`).
  - `README.md`, `CHROMEWEBSTORE.md` — Student 3-step ZIP guide, developer unpacked workflow, and fresh-profile unpacked & Store sign-in acceptance checklists.
  - `tests/package-check.test.ts`, `tests/scanner.test.ts`, `tests/google-calendar-rest.test.ts` — Extended tests for Seams #2 & #4.

---

### Task 1: Unpacked Identity & Dual-Target Manifest Composition (Seam #1)

**Files:**
- Create: `scripts/unpacked-manifest.mjs`
- Test: `tests/unpacked-manifest.test.ts`

**Interfaces:**
- Consumes: Node built-in `node:crypto` (`createHash`).
- Produces (`scripts/unpacked-manifest.mjs`):
  - `UNPACKED_CLIENT_ID_PLACEHOLDER = "YOUR_UNPACKED_CLIENT_ID.apps.googleusercontent.com"`
  - `isValidOAuthClientIdFormat(clientId: string): boolean`
  - `isPlaceholderOAuthClientId(clientId: string): boolean`
  - `deriveExtensionIdFromPublicKey(publicKeyBase64: string): string`
  - `validateUnpackedConfig(config: unknown, options?: { strictOAuth?: boolean }): { errors: string[]; warnings: string[]; derivedExtensionId: string | null }`
  - `buildManifestForTarget(baseManifest: Record<string, any>, options: { target: "store" | "unpacked"; unpackedConfig?: any; strictOAuth?: boolean }): Record<string, any>`

- [ ] **Step 1 (Slice 1 — Red): Write failing test for `deriveExtensionIdFromPublicKey`**

In `tests/unpacked-manifest.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { deriveExtensionIdFromPublicKey } from "../scripts/unpacked-manifest.mjs";

describe("deriveExtensionIdFromPublicKey", () => {
  it("Derives Chromium 32-char a-p extension ID from base64 DER bytes", () => {
    // Independent vector: sha256("hello") first 16 bytes = 2cf24dba5fb0a30e26e83b2ac5b9e29e
    expect(deriveExtensionIdFromPublicKey("aGVsbG8=")).toBe("cmpcenlkfplakdaocgoidlckmfljocjo");
  });

  it("Rejects empty strings, PEM headers, and malformed base64", () => {
    expect(() => deriveExtensionIdFromPublicKey("")).toThrow(/public key/i);
    expect(() => deriveExtensionIdFromPublicKey("-----BEGIN PUBLIC KEY-----\naGVsbG8=")).toThrow(
      /base64/i
    );
    expect(() => deriveExtensionIdFromPublicKey("not@valid!base64")).toThrow(/base64/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unpacked-manifest.test.ts --no-cache`
Expected: FAIL (`Cannot find module '../scripts/unpacked-manifest.mjs'`).

- [ ] **Step 3 (Slice 1 — Green): Implement `deriveExtensionIdFromPublicKey` in `scripts/unpacked-manifest.mjs`**

Validate non-empty canonical base64 (`/^[A-Za-z0-9+/]+={0,2}$/`, length divisible by 4, decoded length > 0), SHA-256 hash raw bytes via `node:crypto`, map first 16 bytes (32 nibbles) to `'a'..'p'`. Include JSDoc types.

- [ ] **Step 4: Run test to verify Slice 1 passes**

Run: `npx vitest run tests/unpacked-manifest.test.ts --no-cache`
Expected: PASS (2 tests).

- [ ] **Step 5 (Slice 2 — Red): Add failing tests for `validateUnpackedConfig`**

Append to `tests/unpacked-manifest.test.ts`:
- Passes with zero errors/warnings when `publicKey`, matching `extensionId`, and real `*.apps.googleusercontent.com` `clientId` are provided.
- Errors when `extensionId` does not match `deriveExtensionIdFromPublicKey(publicKey)`.
- Errors when `clientId` lacks `.apps.googleusercontent.com` suffix.
- Flags `YOUR_UNPACKED_CLIENT_ID.apps.googleusercontent.com` as warning when `strictOAuth: false` and as error when `strictOAuth: true`.

- [ ] **Step 6: Run test to verify Slice 2 fails**

Run: `npx vitest run tests/unpacked-manifest.test.ts --no-cache`
Expected: FAIL (`validateUnpackedConfig is not a function`).

- [ ] **Step 7 (Slice 2 — Green): Implement `isValidOAuthClientIdFormat`, `isPlaceholderOAuthClientId`, `validateUnpackedConfig` in `scripts/unpacked-manifest.mjs`**

Implement exact placeholder pattern `/^YOUR_.*CLIENT_ID/i` and suffix `.apps.googleusercontent.com` (no spaces), returning `{ errors, warnings, derivedExtensionId }`.

- [ ] **Step 8: Run test to verify Slice 2 passes**

Run: `npx vitest run tests/unpacked-manifest.test.ts --no-cache`
Expected: PASS.

- [ ] **Step 9 (Slice 3 — Red): Add failing tests for `buildManifestForTarget`**

Append to `tests/unpacked-manifest.test.ts`:
- `target: "store"` clones manifest, strips any `"key"` field, and preserves `baseManifest.oauth2.client_id` without mutating `baseManifest`.
- `target: "unpacked"` injects `"key": unpackedConfig.publicKey` and sets `oauth2.client_id = unpackedConfig.clientId`.
- `target: "unpacked"` with `strictOAuth: true` throws when `unpackedConfig.clientId` is a placeholder, while `strictOAuth: false` succeeds and injects placeholder.

- [ ] **Step 10: Run test to verify Slice 3 fails**

Run: `npx vitest run tests/unpacked-manifest.test.ts --no-cache`
Expected: FAIL.

- [ ] **Step 11 (Slice 3 — Green): Implement `buildManifestForTarget` in `scripts/unpacked-manifest.mjs`**

Deep-clone `baseManifest` via `structuredClone`; branch strictly on `"store"` vs `"unpacked"`.

- [ ] **Step 12: Run tests & typecheck**

Run: `npx vitest run tests/unpacked-manifest.test.ts --no-cache` and `npm run typecheck`
Expected: PASS with 0 errors.

---

### Task 2: Dual-Target Manifest Validation & Cross-Client Guard (Seam #2)

**Files:**
- Modify: `scripts/validate-manifest.mjs:1-52`
- Test: `tests/package-check.test.ts`

**Interfaces:**
- Consumes: `isPlaceholderOAuthClientId`, `isValidOAuthClientIdFormat`, `deriveExtensionIdFromPublicKey` from `scripts/unpacked-manifest.mjs`.
- Produces (`scripts/validate-manifest.mjs`):
  - `validateManifestForStore(manifest: Record<string, any>, options?: { strictOAuth?: boolean; target?: "store" | "unpacked"; disallowedClientIds?: string[] }): { errors: string[]; warnings: string[] }`

- [ ] **Step 1 (Slice 1 — Red): Add failing tests in `tests/package-check.test.ts`**

Add tests for:
1. `target: "unpacked"` requires a valid base64 `"key"` (errors when missing or malformed) and allows valid `"key"` with zero warnings.
2. `target: "unpacked"` flags `YOUR_UNPACKED_CLIENT_ID.apps.googleusercontent.com` as warning when `strictOAuth: false` and error when `strictOAuth: true`.
3. `target: "store"` rejects `oauth2.client_id` matching an entry in `disallowedClientIds` (preventing unpacked Client ID reuse in Store ZIP).

- [ ] **Step 2: Run test to verify new tests fail**

Run: `npx vitest run tests/package-check.test.ts --no-cache`
Expected: FAIL on the 3 new assertions while existing 3 pass.

- [ ] **Step 3 (Slice 1 — Green): Update `validateManifestForStore` in `scripts/validate-manifest.mjs`**

Preserve default `target = "store"` behavior; enforce `"key"` validation for `target === "unpacked"`, recognize all `YOUR_*CLIENT_ID` placeholders, and check `disallowedClientIds` for `target === "store"`.

- [ ] **Step 4: Run tests & typecheck**

Run: `npx vitest run tests/package-check.test.ts --no-cache` and `npm run typecheck`
Expected: PASS (all tests green).

---

### Task 3: Unpacked Setup CLI Helper & Repo Config Hygiene (Seam #3)

**Files:**
- Create: `scripts/setup-unpacked.mjs`
- Create: `config/unpacked-oauth.example.json`
- Modify: `.gitignore`
- Modify: `public/manifest.json:37-40`
- Test: `tests/setup-unpacked.test.ts`

**Interfaces:**
- Consumes: `deriveExtensionIdFromPublicKey`, `isValidOAuthClientIdFormat`, `UNPACKED_CLIENT_ID_PLACEHOLDER` from `scripts/unpacked-manifest.mjs`.
- Produces (`scripts/setup-unpacked.mjs`):
  - `prepareUnpackedConfig(existingConfig: any, options?: { clientId?: string; resetKey?: boolean; generatePublicKey?: () => string }): { publicKey: string; extensionId: string; clientId: string }`
  - `generateRsaPublicKeyBase64(): string` (exports SPKI DER base64 only; private key discarded in memory)
  - CLI entrypoint guarded by `pathToFileURL(process.argv[1]).href === import.meta.url` supporting `--client-id <id>` and `--reset-key`.

- [ ] **Step 1 (Slice 1 — Red): Write failing tests for `prepareUnpackedConfig`**

In `tests/setup-unpacked.test.ts`:
1. Initializes fresh config using injected `generatePublicKey` (`() => "aGVsbG8="`), derives `"cmpcenlkfplakdaocgoidlckmfljocjo"`, and sets `clientId` to `UNPACKED_CLIENT_ID_PLACEHOLDER`.
2. Re-running without `--reset-key` preserves existing `publicKey`, `extensionId`, and `clientId` without calling `generatePublicKey`.
3. Passing `--client-id` with surrounding whitespace trims and stores it while keeping existing `publicKey`; invalid `clientId` throws a descriptive error.
4. Passing `resetKey: true` without `clientId` rotates `publicKey`, updates `extensionId`, and resets stale `clientId` back to `UNPACKED_CLIENT_ID_PLACEHOLDER`.
5. Passing `resetKey: true` with a new `clientId` rotates `publicKey` and stores the new `clientId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/setup-unpacked.test.ts --no-cache`
Expected: FAIL (`Cannot find module '../scripts/setup-unpacked.mjs'`).

- [ ] **Step 3 (Slice 1 — Green): Implement `scripts/setup-unpacked.mjs`**

Implement `generateRsaPublicKeyBase64()` using `generateKeyPairSync("rsa", { modulusLength: 2048 })` exporting only `publicKey.export({ type: "spki", format: "der" }).toString("base64")`, implement `prepareUnpackedConfig(...)`, and wire CLI argument parsing (`--client-id`, `--reset-key`) reading/writing `config/unpacked-oauth.json` and printing the 3-step Google Cloud Console checklist + backup reminder.

- [ ] **Step 4: Run test to verify Slice 1 passes**

Run: `npx vitest run tests/setup-unpacked.test.ts --no-cache`
Expected: PASS (5 tests).

- [ ] **Step 5: Update repo config hygiene**

- Add `config/unpacked-oauth.json` to `.gitignore`.
- Create `config/unpacked-oauth.example.json` with placeholder values matching the schema.
- Reset `public/manifest.json` line 38 `oauth2.client_id` to `"YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com"`.

- [ ] **Step 6: Verify tests & typecheck**

Run: `npx vitest run tests/setup-unpacked.test.ts tests/package-check.test.ts --no-cache` and `npm run typecheck`
Expected: PASS.

---

### Task 4: Scanner Auth/Empty-SPADA Fixes & Structured Calendar Errors (Seam #4)

**Files:**
- Modify: `src/parsers/spada-html.ts`
- Modify: `src/calendar/google-calendar-rest.ts:10-18,86-93,121-123,164-166,190-192`
- Modify: `src/background/scanner.ts:63-178`
- Test: `tests/scanner.test.ts`, `tests/google-calendar-rest.test.ts`

**Interfaces:**
- Produces:
  - `src/parsers/spada-html.ts`: `isAuthenticatedSpadaDashboardHtml(html: string): boolean`
  - `src/calendar/google-calendar-rest.ts`: `GoogleCalendarApiError(status: number, message: string, reason?: string)` with formatted message `GCAL HTTP <status> [<reason>]: <detail>` (or `GCAL HTTP <status>: <detail>` when no reason).
  - `src/background/scanner.ts`:
    - `isConfiguredOAuthClientId(clientId: string): boolean`
    - `syncAssignmentsToGoogleCalendar(assignments, settings, interactive, deps?: { getToken?: (interactive: boolean) => Promise<string>; removeCachedToken?: (token: string) => Promise<void> }): Promise<SyncSummary>`

- [ ] **Step 1 (Slice 1 — Red): Add failing tests in `tests/scanner.test.ts` for `isConfiguredOAuthClientId`**

Test that `""`, `"YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com"`, `"YOUR_UNPACKED_CLIENT_ID.apps.googleusercontent.com"`, and `"not-a-google-id"` return `false`, while `"123456-abc.apps.googleusercontent.com"` returns `true`.

- [ ] **Step 2: Run test to verify Slice 1 fails**

Run: `npx vitest run tests/scanner.test.ts --no-cache`
Expected: FAIL (`isConfiguredOAuthClientId` not exported).

- [ ] **Step 3 (Slice 1 — Green): Implement `isConfiguredOAuthClientId` and update `isOAuthClientConfigured` in `src/background/scanner.ts`**

Check non-empty trimmed string, `!/^YOUR_.*CLIENT_ID/i`, and `.endsWith(".apps.googleusercontent.com")`.

- [ ] **Step 4: Run test to verify Slice 1 passes**

Run: `npx vitest run tests/scanner.test.ts --no-cache`
Expected: PASS.

- [ ] **Step 5 (Slice 2 — Red): Add failing tests in `tests/scanner.test.ts` for authenticated empty SPADA dashboard**

Add two tests to `scanSpadaWithFetcher`:
1. Returns `{ courses: [], assignments: [] }` (does NOT throw `AUTH_REQUIRED`) when `/my/` returns an authenticated Moodle dashboard (`<div id="nav-drawer"><nav></nav></div>` or `/login/logout.php`) with 0 enrolled courses.
2. Still throws `AUTH_REQUIRED` when `/my/` returns an unexpected unauthenticated page without `#nav-drawer`, `logout.php`, or `sesskey`.

- [ ] **Step 6: Run test to verify Slice 2 fails**

Run: `npx vitest run tests/scanner.test.ts --no-cache`
Expected: FAIL (currently throws `AUTH_REQUIRED` on authenticated empty dashboard).

- [ ] **Step 7 (Slice 2 — Green): Add `isAuthenticatedSpadaDashboardHtml` in `src/parsers/spada-html.ts` and update `scanSpadaWithFetcher` in `src/background/scanner.ts`**

`isAuthenticatedSpadaDashboardHtml(html)` returns `!isSpadaLoginHtml(html) && (/id=["']nav-drawer["']/i.test(html) || /\/login\/logout\.php/i.test(html) || /\bsesskey\b/i.test(html))`. In `scanSpadaWithFetcher`, return `{ courses: [], assignments: [] }` when `courses.length === 0 && isAuthenticatedSpadaDashboardHtml(myHtml)`.

- [ ] **Step 8: Run test to verify Slice 2 passes**

Run: `npx vitest run tests/scanner.test.ts --no-cache`
Expected: PASS.

- [ ] **Step 9 (Slice 3 — Red): Add failing tests in `tests/scanner.test.ts` for `syncAssignmentsToGoogleCalendar` with 0 eligible assignments**

Test that calling `syncAssignmentsToGoogleCalendar([], settings, true, { getToken })`:
1. Calls `getToken(true)` even when `assignments` is empty (0 eligible) and rejects if `getToken` rejects (never returns fake success).
2. Returns `{ created: 0, updated: 0, skipped: 0 }` only after `getToken(true)` resolves with a valid token.

- [ ] **Step 10: Run test to verify Slice 3 fails**

Run: `npx vitest run tests/scanner.test.ts --no-cache`
Expected: FAIL (currently early-returns without calling `getToken`).

- [ ] **Step 11 (Slice 3 — Green): Update `syncAssignmentsToGoogleCalendar` in `src/background/scanner.ts`**

Acquire token via `deps?.getToken ?? getGoogleToken` **before** checking `if (syncable.length === 0) return { created: 0, updated: 0, skipped: 0 };`.

- [ ] **Step 12: Run test to verify Slice 3 passes**

Run: `npx vitest run tests/scanner.test.ts --no-cache`
Expected: PASS.

- [ ] **Step 13 (Slice 4 — Red): Add failing tests in `tests/google-calendar-rest.test.ts` for `GoogleCalendarApiError` formatting**

Test `listRemoteSpadaEvents` against fake fetch responses:
1. HTTP 403 JSON `{ error: { code: 403, message: "Rate Limit Exceeded", errors: [{ reason: "rateLimitExceeded" }] } }` throws `GoogleCalendarApiError` with `status === 403`, `reason === "rateLimitExceeded"`, and `message === "GCAL HTTP 403 [rateLimitExceeded]: Rate Limit Exceeded"`.
2. HTTP 502 plain text `"Bad Gateway"` (non-JSON) does NOT throw `SyntaxError` and throws `GoogleCalendarApiError` with `status === 502`, `reason === undefined`, and `message === "GCAL HTTP 502: Bad Gateway"`.

- [ ] **Step 14: Run test to verify Slice 4 fails**

Run: `npx vitest run tests/google-calendar-rest.test.ts --no-cache`
Expected: FAIL.

- [ ] **Step 15 (Slice 4 — Green): Update `parseErrorResponse` and `GoogleCalendarApiError` in `src/calendar/google-calendar-rest.ts`**

Parse JSON safely inside `try/catch`, extract `reason` (`parsed?.error?.errors?.[0]?.reason`) and `detail` (`parsed?.error?.message ?? rawText ?? res.statusText`), format `GCAL HTTP ${status}${reason ? ` [${reason}]` : ""}: ${detail}`, and pass consistently at all 3 throw sites (`listRemoteSpadaEvents`, `createRemoteEvent`, `patchRemoteEvent`).

- [ ] **Step 16: Run tests & typecheck**

Run: `npx vitest run tests/scanner.test.ts tests/google-calendar-rest.test.ts --no-cache` and `npm run typecheck`
Expected: PASS.

---

### Task 5: Setup Readiness State & Service-Aware Error Diagnostics (Seam #5)

**Files:**
- Modify: `src/shared/storage.ts:16-69`
- Create: `src/setup/setup-diagnostics.ts`
- Test: `tests/setup-diagnostics.test.ts`

**Interfaces:**
- Consumes: `StoredExtensionState` from `src/shared/storage.ts`, `GoogleCalendarApiError` (in integration test) from `src/calendar/google-calendar-rest.ts`.
- Produces:
  - `src/shared/storage.ts`: adds `googleAuthVerified: boolean` (defaults `false`) to `StoredExtensionState`.
  - `src/setup/setup-diagnostics.ts`:
    - `SetupErrorCode = "SPADA_AUTH_REQUIRED" | "SPADA_ACCESS_DENIED" | "OAUTH_NOT_CONFIGURED" | "OAUTH_CANCELLED" | "OAUTH_CLIENT_MISMATCH" | "OAUTH_ACCESS_DENIED" | "GCAL_RATE_LIMITED" | "GCAL_CALENDAR_NOT_FOUND" | "BROWSER_UNSUPPORTED" | "NETWORK_OR_SERVER" | "UNKNOWN"`
    - `diagnoseSetupError(rawError: string): SetupErrorDiagnosis`
    - `evaluateSetupStatus(state: StoredExtensionState, oauthConfigured: boolean): SetupStatus` (returns `{ steps: { spada, google, firstSync }, completedCount, overallReady, hasCompletedInitialSetup, nextStep }`)

- [ ] **Step 1: Add `googleAuthVerified: boolean` to `StoredExtensionState` in `src/shared/storage.ts`**

Default `raw?.googleAuthVerified ?? false` in `getStoredState()`.

- [ ] **Step 2 (Slice 1 — Red): Write failing tests in `tests/setup-diagnostics.test.ts` for `diagnoseSetupError`**

Pin all service-first ordering and edge cases:
1. `"SPADA HTTP 403 untuk https://spada.upnyk.ac.id/mod/assign/index.php?id=52581"` → `SPADA_ACCESS_DENIED` (hint mentions SPADA, NOT Google OAuth).
2. `"SPADA HTTP 401 untuk https://spada.upnyk.ac.id/my/"` and `"AUTH_REQUIRED: ..."` → `SPADA_AUTH_REQUIRED`.
3. `"OAuth2 request failed: access_denied"` → `OAUTH_ACCESS_DENIED` (NOT `OAUTH_CLIENT_MISMATCH`).
4. `"OAuth2 request failed: bad client id"` → `OAUTH_CLIENT_MISMATCH`.
5. `"The user did not approve access."` / `"OAuth2 not granted or revoked."` → `OAUTH_CANCELLED`.
6. Actual `GoogleCalendarApiError` message `"GCAL HTTP 403 [rateLimitExceeded]: Rate Limit Exceeded"`, `"GCAL HTTP 429 [userRateLimitExceeded]: Too Many Requests"`, and plain `"Rate Limit Exceeded"` → `GCAL_RATE_LIMITED` (tells student to retry later, NOT OAuth consent).
7. `"GCAL HTTP 403 [insufficientPermissions]: Insufficient Permission"` → `OAUTH_ACCESS_DENIED`; `"GCAL HTTP 404 [notFound]: Not Found"` → `GCAL_CALENDAR_NOT_FOUND`; `"GCAL HTTP 502: Bad Gateway"` → `NETWORK_OR_SERVER`.
8. `"OAUTH_NOT_CONFIGURED: ..."` → `OAUTH_NOT_CONFIGURED`; Chrome sign-in/unsupported error → `BROWSER_UNSUPPORTED`; unrecognized error → `UNKNOWN`.

- [ ] **Step 3: Run test to verify Slice 1 fails**

Run: `npx vitest run tests/setup-diagnostics.test.ts --no-cache`
Expected: FAIL (`Cannot find module '../src/setup/setup-diagnostics.js'`).

- [ ] **Step 4 (Slice 1 — Green): Implement `diagnoseSetupError` in `src/setup/setup-diagnostics.ts`**

Follow the exact 9-tier priority order in Spec Section 5.4.

- [ ] **Step 5: Run test to verify Slice 1 passes**

Run: `npx vitest run tests/setup-diagnostics.test.ts --no-cache`
Expected: PASS.

- [ ] **Step 6 (Slice 2 — Red): Add failing tests in `tests/setup-diagnostics.test.ts` for `evaluateSetupStatus`**

Cover all state transitions from the spec:
1. Fresh install (`oauthConfigured: true`, all nulls) → `spada: "active"`, `google: "pending"`, `firstSync: "pending"`, `completedCount: 0`, `overallReady: false`, `hasCompletedInitialSetup: false`, `nextStep: "spada"`.
2. Authenticated SPADA with 0 courses (`lastScanAt` set, `courses: []`, `lastScanError: null`) → `spada: "done"` with informative 0-course detail, `google: "active"`, `firstSync: "pending"`, `nextStep: "google"`.
3. `oauthConfigured: false` after SPADA done → `google: "blocked"`, `firstSync: "blocked"`.
4. Synced Account A → disconnected (`lastSyncAt: null`, `googleConnected: false`, `googleAuthVerified: false`) → reconnected Account B (`googleConnected: true`, `googleAuthVerified: true`, `lastSyncAt: null`) → `google: "done"`, `firstSync: "active"`, `overallReady: false`, `hasCompletedInitialSetup: false`.
5. Legacy unverified state (`googleConnected: true`, `googleAuthVerified: false`, `lastSyncAt` set) → `google: "active"` (NOT `"done"`), `firstSync: "pending"`, `hasCompletedInitialSetup: false`.
6. Fully set up (`lastScanAt`, `googleConnected: true`, `googleAuthVerified: true`, `lastSyncAt`) with subsequent transient `lastScanError: "Failed to fetch"` → `spada: "error"`, `overallReady: false`, **while `hasCompletedInitialSetup` remains `true`** so Popup doesn't nag old users with setup banner.

- [ ] **Step 7: Run test to verify Slice 2 fails**

Run: `npx vitest run tests/setup-diagnostics.test.ts --no-cache`
Expected: FAIL.

- [ ] **Step 8 (Slice 2 — Green): Implement `evaluateSetupStatus` in `src/setup/setup-diagnostics.ts`**

Follow the exact transition rules in Spec Section 5.4.

- [ ] **Step 9: Run tests & typecheck**

Run: `npx vitest run tests/setup-diagnostics.test.ts --no-cache` and `npm run typecheck`
Expected: PASS.

---

### Task 6: Install Lifecycle, Disconnect Invalidation & Legacy Auth Revalidation (Seam #6)

**Files:**
- Create: `src/background/install-lifecycle.ts`
- Modify: `src/background/service-worker.ts:59-194`
- Test: `tests/install-lifecycle.test.ts`

**Interfaces:**
- Consumes: `StoredExtensionState` from `src/shared/storage.ts`.
- Produces (`src/background/install-lifecycle.ts`):
  - `buildDisconnectedStatePatch(): Pick<StoredExtensionState, "googleConnected" | "googleAuthVerified" | "lastSyncAt" | "lastSyncSummary" | "lastSyncError">`
  - `revalidateLegacyGoogleAuth(state: StoredExtensionState, deps: { oauthConfigured: boolean; getSilentToken: () => Promise<string | null>; updateState: (patch: Partial<StoredExtensionState>) => Promise<StoredExtensionState> }): Promise<StoredExtensionState>`
  - `handleExtensionInstalled(reason: string, deps: { scheduleAutoScan: () => Promise<void>; getState: () => Promise<StoredExtensionState>; updateBadge: (pendingCount: number) => Promise<void>; openOnboardingTab: () => Promise<void>; revalidateAuth: (state: StoredExtensionState) => Promise<StoredExtensionState> }): Promise<void>`

- [ ] **Step 1 (Slice 1 — Red): Write failing tests in `tests/install-lifecycle.test.ts`**

Test:
1. `buildDisconnectedStatePatch()` returns `{ googleConnected: false, googleAuthVerified: false, lastSyncAt: null, lastSyncSummary: null, lastSyncError: null }`.
2. `revalidateLegacyGoogleAuth`:
   - Upgrades legacy state (`googleConnected: true, googleAuthVerified: false`) to `{ googleAuthVerified: true }` when `getSilentToken()` returns a token.
   - Invalidates legacy state via `buildDisconnectedStatePatch()` when `getSilentToken()` returns `null` or throws `"OAuth2 not granted or revoked."`.
   - Leaves state untouched (does NOT wipe `lastSyncAt` or flip `googleAuthVerified`) when `getSilentToken()` throws `"Failed to fetch"` (offline/transient network error).
   - No-ops when already verified or disconnected.
3. `handleExtensionInstalled`:
   - Calls `openOnboardingTab` when `reason === "install"`, plus `scheduleAutoScan` and `updateBadge`.
   - Does NOT call `openOnboardingTab` when `reason === "update"` or `"chrome_update"`, and runs `revalidateAuth` on `"update"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/install-lifecycle.test.ts --no-cache`
Expected: FAIL.

- [ ] **Step 3 (Slice 1 — Green): Implement `src/background/install-lifecycle.ts`**

Implement `buildDisconnectedStatePatch`, `revalidateLegacyGoogleAuth`, and `handleExtensionInstalled` cleanly using injected adapters.

- [ ] **Step 4: Run test to verify Slice 1 passes**

Run: `npx vitest run tests/install-lifecycle.test.ts --no-cache`
Expected: PASS.

- [ ] **Step 5: Wire `src/background/service-worker.ts`**

Update `service-worker.ts` to:
- Call `handleExtensionInstalled(details.reason, ...)` inside `chrome.runtime.onInstalled` (opening `chrome.runtime.getURL("onboarding/onboarding.html")`).
- Run `revalidateLegacyGoogleAuth` inside `GET_STATE` before returning state.
- Set `googleAuthVerified: true` on successful `CONNECT_GOOGLE` and `performSync`; persist `lastSyncError` when `CONNECT_GOOGLE` throws.
- Use `buildDisconnectedStatePatch()` on `DISCONNECT_GOOGLE`.

- [ ] **Step 6: Run tests & typecheck**

Run: `npx vitest run tests/install-lifecycle.test.ts tests/setup-diagnostics.test.ts --no-cache` and `npm run typecheck`
Expected: PASS.

---

### Task 7: Guided Onboarding UI + Popup & Options UX Integration

**Files:**
- Create: `src/env.d.ts`
- Create: `src/onboarding/onboarding.html`, `src/onboarding/onboarding.css`, `src/onboarding/onboarding.ts`
- Modify: `src/popup/popup.html`, `src/popup/popup.ts`, `src/popup/popup.css`
- Modify: `src/options/options.html`, `src/options/options.ts`, `src/options/options.css`

**Interfaces:**
- Consumes: `evaluateSetupStatus`, `diagnoseSetupError` from `src/setup/setup-diagnostics.ts`; `__BUILD_TARGET__` from `src/env.d.ts`; existing service worker message protocol (`GET_STATE`, `SCAN_NOW`, `CONNECT_GOOGLE`, `SYNC_NOW`).
- Produces: Complete MV3-compliant Onboarding Wizard UI and updated Popup/Options pages (zero inline scripts, zero `innerHTML`).

- [ ] **Step 1: Consult `modern-web-guidance` for accessible wizard/status alerts & clipboard UX before writing HTML/CSS**

Run focused queries (if network available) or apply modern accessible HTML (`<main>`, `<ol>`, `aria-live="polite"`, `:focus-visible`, semantic `<button type="button">`).

- [ ] **Step 2: Create `src/env.d.ts`**

Declare `declare const __BUILD_TARGET__: "store" | "unpacked";`.

- [ ] **Step 3: Build `src/onboarding/onboarding.html`, `onboarding.css`, and `onboarding.ts`**

Implement the 3-step wizard matching the spec mockup (palette `#0f3d6e` / `#f8fafc`):
- Progress header (`0/3` → `3/3` + ready banner).
- Step 1: link to `https://spada.upnyk.ac.id/` (`target="_blank" rel="noopener noreferrer"`) + `Cek Sesi SPADA` button (`SCAN_NOW`).
- Step 2: `Hubungkan Google` button (`CONNECT_GOOGLE`) + unpacked-only info tip (`data-unpacked-only`, hidden when `__BUILD_TARGET__ === "store"`) explaining *"Google hasn't verified this app" → Advanced → Go to...*.
- Step 3: `Scan & Sync Pertama` button (`SYNC_NOW`), `disabled` until Step 1 and Step 2 are `"done"`.
- Tips panel: pin extension icon, unpacked-only *"Jangan hapus folder hasil ekstrak ekstensi ini"* (`data-unpacked-only`), and `Buka Pengaturan ⚙️` button (`chrome.runtime.openOptionsPage()`).
- Render all statuses and `diagnoseSetupError` messages (`title` + `hint`) strictly via `.textContent`.

- [ ] **Step 4: Upgrade `src/popup/popup.html`, `popup.ts`, and `popup.css`**

- Render `lastScanError` / `lastSyncError` through `diagnoseSetupError()` (`title — hint` via `.textContent`).
- Show a compact `"Panduan Setup"` banner/button when `!evaluateSetupStatus(cachedState, cachedOAuthConfigured).hasCompletedInitialSetup`, opening `chrome.runtime.getURL("onboarding/onboarding.html")` via `chrome.tabs.create`.

- [ ] **Step 5: Upgrade `src/options/options.html`, `options.ts`, and `options.css`**

- Add `Salin ID` button next to `#extension-id` using `navigator.clipboard.writeText` with safe status feedback (`Tersalin!` / fallback message).
- Add `Buka Panduan Setup` button opening `onboarding/onboarding.html`.
- Update developer OAuth instructions to reference `npm run setup:unpacked` and `npm run package:unpacked`.

- [ ] **Step 6: Verify TypeScript typecheck**

Run: `npm run typecheck`
Expected: PASS with 0 errors.

---

### Task 8: Dual-Target Build/Package Pipeline, Docs, and Full Verification

**Files:**
- Modify: `scripts/build.mjs`
- Modify: `scripts/package.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHROMEWEBSTORE.md`

**Interfaces:**
- Consumes: `buildManifestForTarget`, `validateUnpackedConfig` from `scripts/unpacked-manifest.mjs`; `validateManifestForStore` from `scripts/validate-manifest.mjs`.
- Produces:
  - `npm run setup:unpacked` → `node scripts/setup-unpacked.mjs`
  - `npm run build` (store default) & `npm run build:unpacked` (`--target=unpacked`)
  - `npm run package` / `npm run package:strict` (`store`) & `npm run package:unpacked` (`--target=unpacked`)

- [ ] **Step 1: Update `scripts/build.mjs`**

- Support `--target=store` (default) and `--target=unpacked`.
- Bundle `onboarding/onboarding: "src/onboarding/onboarding.ts"` and copy `onboarding.html` & `onboarding.css` into `dist/onboarding/`.
- Inject `define: { __BUILD_TARGET__: JSON.stringify(target) }` in `esbuild.build(...)`.
- Compose `dist/manifest.json` using `buildManifestForTarget`:
  - `target === "store"`: strips `"key"`.
  - `target === "unpacked"`: loads `config/unpacked-oauth.json` (fails cleanly with instruction to run `npm run setup:unpacked` if missing), calls `validateUnpackedConfig(..., { strictOAuth: false })` (prints warnings if placeholder), and writes composed manifest.

- [ ] **Step 2: Update `scripts/package.mjs`**

- Support `--target=unpacked` (implies `strictOAuth: true`, output `release/spada-calendar-extension-unpacked-v<version>.zip`) vs default `target=store` (output `release/spada-calendar-extension-v<version>.zip`).
- When `target === "store"` and `config/unpacked-oauth.json` exists locally, pass `disallowedClientIds: [unpackedConfig.clientId]` into `validateManifestForStore` so an unpacked Client ID cannot slip into a Store build.
- Verify `onboarding/onboarding.html`, `onboarding/onboarding.css`, and `onboarding/onboarding.js` exist in `dist/` alongside existing manifest asset checks.

- [ ] **Step 3: Add npm scripts to `package.json`**

Add `setup:unpacked`, `build:unpacked`, and `package:unpacked`.

- [ ] **Step 4: Update `README.md` and `CHROMEWEBSTORE.md`**

- `README.md`: Split clearly into:
  1. **Untuk Mahasiswa (3 Langkah Pasang dari ZIP — Tanpa Node.js & Tanpa Google Cloud Console)** (ready for tutorial video).
  2. **Untuk Developer (Setup Sekali Saja: `npm run setup:unpacked` & `npm run package:unpacked` + Unpacked Release Acceptance Check di profil Chrome baru + catatan backup `config/unpacked-oauth.json`)**.
- `CHROMEWEBSTORE.md`: Add Store sign-in acceptance check from an actual Chrome Web Store installation before publishing to Production, and mention the Onboarding guide in features/how-to-use.

- [ ] **Step 5: Run full verification suite**

Run:
1. `npx vitest run --no-cache` (all unit & integration tests must pass).
2. `npm run typecheck` (0 TypeScript errors).
3. `npm run build` (verify `dist/onboarding/onboarding.html`, `dist/onboarding/onboarding.js`, and `dist/manifest.json` has NO `"key"`).
4. `npm run package` (succeeds with warning on placeholder Store `client_id`) and `npm run package:strict` (MUST fail with error on placeholder Store `client_id` — proving Point 2 protection works!).
5. Smoke test `npm run setup:unpacked` + `npm run build:unpacked` (or temporary dry verification without leaving stray local config if appropriate — check and document clearly).
