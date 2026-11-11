import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { checkTimestamp } from "@rescrobble/core";
import fixture from "../../../fixtures/timestamp-rule-cases.json";
import { browser, signInWithBearer, signInWithCookie } from "./browser.ts";
import { HOUR_AGO, NOW, freezeClock } from "./clock.ts";
import { lastFmDown, lastFmError, lastFmJson, network, scrobbleEntryJson, scrobblesJson, scrobblingLastFm } from "./lastfm.ts";

const clock = freezeClock();
const WINDOW = 14 * 24 * 60 * 60;

type Entry = Record<string, unknown>;
const entry = (fields: Entry = {}): Entry => ({ artist: "Cher", track: "Believe", timestamp: HOUR_AGO, ...fields });
const submit = (scrobbles: unknown[], headers: Record<string, string> = {}) => browser().post("/api/scrobbles", { headers, body: { scrobbles } });
const results = async (response: Response) => ((await response.json()) as { results: Record<string, unknown>[] }).results;
const asBearer = async () => ({ Authorization: await signInWithBearer() });

describe("submitting Scrobbles", () => {
  it("submits a single Scrobble and reports it accepted", async () => {
    const lastFm = scrobblingLastFm();

    const response = await submit([entry()], await asBearer());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"results":[{"status":"accepted","artist":"Cher","artistCorrected":false,"track":"Believe","trackCorrected":false}]}');
    const form = lastFm.scrobbleForms()[0]!;
    expect(lastFm.scrobbleForms()).toHaveLength(1);
    expect(form.get("sk")).toBe("session-key-123");
    expect(form.get("artist[0]")).toBe("Cher");
    expect(form.get("track[0]")).toBe("Believe");
    expect(form.get("timestamp[0]")).toBe(String(HOUR_AGO));
  });

  it("submits the same way with the cookie and the bearer token", async () => {
    const lastFm = scrobblingLastFm();

    const viaCookie = await submit([entry()], { Cookie: await signInWithCookie() });
    const viaBearer = await submit([entry()], await asBearer());

    expect(viaCookie.status).toBe(200);
    expect(await viaCookie.text()).toBe(await viaBearer.text());
    expect(lastFm.scrobbleForms().map((f) => f.get("sk"))).toEqual(["session-key-123", "session-key-123"]);
  });

  it("is unauthorized without signing in and reaches nothing", async () => {
    const lastFm = scrobblingLastFm();

    expect((await submit([entry()])).status).toBe(401);
    expect(lastFm.requests).toHaveLength(0);
  });

  it("refuses an empty batch or one over 50 whole", async () => {
    const lastFm = scrobblingLastFm();
    const auth = await asBearer();

    const empty = await submit([], auth);
    const tooMany = await submit(Array.from({ length: 51 }, (_, i) => entry({ track: `Track ${i}` })), auth);

    expect(empty.status).toBe(400);
    expect(tooMany.status).toBe(400);
    expect(await tooMany.json()).toEqual({ error: "batchSize" });
    expect(lastFm.scrobbleForms()).toHaveLength(0);
  });

  it("sends a batch of exactly 50 to Last.fm as one request", async () => {
    const lastFm = scrobblingLastFm();

    const response = await submit(Array.from({ length: 50 }, (_, i) => entry({ track: `Track ${i}`, timestamp: HOUR_AGO + i })), await asBearer());

    expect((await results(response)).filter((r) => r.status === "accepted")).toHaveLength(50);
    expect(lastFm.scrobbleForms()).toHaveLength(1);
  });

  it("rejects entries missing a required field, naming that field", async () => {
    const lastFm = scrobblingLastFm();

    const response = await submit(
      [{ track: "Believe", timestamp: HOUR_AGO }, { artist: "Cher", track: "  ", timestamp: HOUR_AGO }, { artist: "Cher", track: "Believe" }],
      await asBearer(),
    );

    const list = await results(response);
    expect(list.map((r) => r.field)).toEqual(["artist", "track", "timestamp"]);
    expect(list.every((r) => r.status === "rejected" && r.reason === "missingField")).toBe(true);
    expect(lastFm.scrobbleForms()).toHaveLength(0);
  });

  it("rejects timestamps outside the window before reaching Last.fm", async () => {
    const lastFm = scrobblingLastFm();

    const response = await submit(
      [entry({ timestamp: NOW - WINDOW }), entry({ timestamp: NOW - WINDOW - 1 }), entry({ timestamp: NOW }), entry({ timestamp: NOW + 1 })],
      await asBearer(),
    );

    expect((await results(response)).map((r) => (r.status === "rejected" ? r.reason : r.status))).toEqual(["accepted", "tooOld", "accepted", "inFuture"]);
    const form = lastFm.scrobbleForms()[0]!;
    expect([form.get("timestamp[0]"), form.get("timestamp[1]"), form.get("timestamp[2]")]).toEqual([String(NOW - WINDOW), String(NOW), null]);
  });

  it("moves the window with the clock", async () => {
    scrobblingLastFm();
    const auth = await asBearer();
    const [first] = await results(await submit([entry()], auth));

    clock.advance(WINDOW);
    const [later] = await results(await submit([entry()], auth));

    expect(first!.status).toBe("accepted");
    expect(later!.reason).toBe("tooOld");
  });

  it("classifies every shared timestamp case the way core does", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
    for (const c of fixture.cases) expect(checkTimestamp(c.timestamp, c.now), c.name).toBe(c.expected);
  });

  it("still submits valid entries when others in the batch are rejected, keeping request order", async () => {
    const lastFm = scrobblingLastFm();

    const response = await submit(
      [entry({ track: "One" }), entry({ track: "Too old", timestamp: 0 }), entry({ track: "Two" }), entry({ artist: "", track: "No artist" }), entry({ track: "Three" })],
      await asBearer(),
    );

    const list = await results(response);
    expect(list.map((r) => r.status)).toEqual(["accepted", "rejected", "accepted", "rejected", "accepted"]);
    expect(list.filter((r) => r.status === "accepted").map((r) => r.track)).toEqual(["One", "Two", "Three"]);
    const form = lastFm.scrobbleForms()[0]!;
    expect([0, 1, 2].map((i) => form.get(`track[${i}]`))).toEqual(["One", "Two", "Three"]);
  });

  it("sends the optional album and album artist only when present", async () => {
    const lastFm = scrobblingLastFm();

    await submit([entry({ album: "Believe", albumArtist: "Cher" }), entry({ album: "", albumArtist: null })], await asBearer());

    const form = lastFm.scrobbleForms()[0]!;
    expect(form.get("album[0]")).toBe("Believe");
    expect(form.get("albumArtist[0]")).toBe("Cher");
    expect(form.has("album[1]")).toBe(false);
    expect(form.has("albumArtist[1]")).toBe(false);
  });

  it("signs a batch with indexed parameters sorted in code-unit order", async () => {
    const lastFm = scrobblingLastFm();

    await submit(Array.from({ length: 11 }, (_, i) => entry({ artist: `Artist ${i}`, track: `Track ${i}`, timestamp: HOUR_AGO + i * 60 })), await asBearer());

    // Expected value computed independently of the application code, so that artist[10] precedes artist[1].
    expect(lastFm.scrobbleForms()[0]!.get("api_sig")).toBe("c60ca5971e3bd2f1bde20f3fcfa27c1e");
  });

  it("reports Last.fm's corrections on accepted results", async () => {
    scrobblingLastFm((form) => lastFmJson(scrobblesJson([scrobbleEntryJson("Cher", "Believe", form.get("timestamp[0]")!, { artistCorrected: true })])));

    const [result] = await results(await submit([entry({ artist: "cher" })], await asBearer()));

    expect(result).toMatchObject({ artist: "Cher", artistCorrected: true, trackCorrected: false });
  });

  it("reports each Last.fm ignored code as ignored with its message", async () => {
    const messages: [number, string][] = [
      [1, "Artist was ignored"],
      [2, "Track was ignored"],
      [3, "Timestamp was too old"],
      [4, "Timestamp was too new"],
      [5, "Daily scrobble limit exceeded"],
    ];
    scrobblingLastFm((form) => lastFmJson(scrobblesJson(messages.map(([code, message], i) =>
      scrobbleEntryJson(form.get(`artist[${i}]`)!, form.get(`track[${i}]`)!, form.get(`timestamp[${i}]`)!, { ignoredCode: code, ignoredMessage: message })))));

    const list = await results(await submit(messages.map(([code]) => entry({ track: `Track ${code}` })), await asBearer()));

    expect(list.every((r) => r.status === "ignored")).toBe(true);
    expect(list.map((r) => [r.code, r.message])).toEqual(messages);
  });

  it("sends non-Latin names to Last.fm exactly as given", async () => {
    const lastFm = scrobblingLastFm();

    const response = await submit(
      [entry({ artist: "아이유", track: "밤편지", album: "팔레트" }), entry({ artist: "宇多田ヒカル", track: "First Love" }), entry({ artist: "Sigur Rós", track: "Hoppípolla", albumArtist: "Björk" })],
      await asBearer(),
    );

    const form = lastFm.scrobbleForms()[0]!;
    expect([0, 1, 2].map((i) => form.get(`artist[${i}]`))).toEqual(["아이유", "宇多田ヒカル", "Sigur Rós"]);
    expect(form.get("track[0]")).toBe("밤편지");
    expect(form.get("album[0]")).toBe("팔레트");
    expect(form.get("track[2]")).toBe("Hoppípolla");
    expect(form.get("albumArtist[2]")).toBe("Björk");
    expect((await results(response))[0]!.track).toBe("밤편지");
  });
});

describe("Last.fm failing during a submission", () => {
  const submitOne = async () => submit([entry()], await asBearer());
  const expectRetryLater = async (response: Response) => {
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.json()).toEqual({ error: "lastFmUnavailable" });
  };

  it("asks the client to retry later when Last.fm rate-limits the submission", async () => {
    scrobblingLastFm(() => lastFmError(29, "Rate limit exceeded"));
    await expectRetryLater(await submitOne());
  });

  it("asks the client to retry later on a Last.fm server error", async () => {
    scrobblingLastFm(lastFmDown);
    await expectRetryLater(await submitOne());
  });

  it("asks the client to retry later when Last.fm reports itself offline", async () => {
    scrobblingLastFm(() => lastFmError(11, "Service Offline - This service is temporarily offline. Try again later."));
    await expectRetryLater(await submitOne());
  });

  it("asks the client to retry later when Last.fm can't be reached", async () => {
    scrobblingLastFm();
    const auth = await asBearer();
    network.use(http.all("https://ws.audioscrobbler.com/2.0/", () => HttpResponse.error()));

    await expectRetryLater(await submit([entry()], auth));
  });

  it("means signing in again when the session was revoked", async () => {
    scrobblingLastFm(() => lastFmError(9, "Invalid session key - Please re-authenticate"));

    const response = await submitOne();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "sessionInvalid" });
  });
});
