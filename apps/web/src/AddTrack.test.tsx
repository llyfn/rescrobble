import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { server } from "./test/server.ts";
import { renderSignedIn, scrobbleEndpoint } from "./test/app.tsx";

const now = new Date("2026-11-06T20:10:30Z");
const nowSeconds = Math.floor(now.getTime() / 1000);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

async function fill(user: Awaited<ReturnType<typeof renderSignedIn>>["user"], fields: Record<string, string>) {
  for (const [label, value] of Object.entries(fields)) {
    const input = screen.getByLabelText(label);
    if (label === "Played at") fireEvent.change(input, { target: { value } });
    else {
      await user.clear(input);
      await user.type(input, value);
    }
  }
}

function sessionList() {
  return within(screen.getByRole("region", { name: "This session" }));
}

describe("adding a Track", () => {
  it("defaults Played at to now and submits one entry", async () => {
    const requests = scrobbleEndpoint();
    const { user } = await renderSignedIn();

    expect(screen.getByLabelText("Played at")).toHaveValue("2026-11-06T20:10");
    await fill(user, { Artist: "Cher", Track: "Believe" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(await sessionList().findByText("Added")).toBeInTheDocument();
    expect(requests).toEqual([[{ artist: "Cher", track: "Believe", timestamp: nowSeconds - 30 }]]);
  });

  it("sends the album only when one is entered", async () => {
    const requests = scrobbleEndpoint();
    const { user } = await renderSignedIn();

    await fill(user, { Artist: "Cher", Track: "Believe", Album: "Believe" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    await sessionList().findByText("Added");
    expect(requests[0]?.[0]).toMatchObject({ album: "Believe" });
  });

  it("keeps the artist and clears the track and album after an accepted Scrobble", async () => {
    scrobbleEndpoint();
    const { user } = await renderSignedIn();

    await fill(user, { Artist: "Cher", Track: "Believe", Album: "Believe" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    await sessionList().findByText("Added");
    expect(screen.getByLabelText("Artist")).toHaveValue("Cher");
    expect(screen.getByLabelText("Track")).toHaveValue("");
    expect(screen.getByLabelText("Album")).toHaveValue("");
  });

  it("flags a missing artist and track on their fields and sends nothing", async () => {
    const requests = scrobbleEndpoint();
    const { user } = await renderSignedIn();

    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(screen.getByLabelText("Artist")).toHaveAccessibleDescription("Enter the artist.");
    expect(screen.getByLabelText("Track")).toHaveAccessibleDescription("Enter the track.");
    expect(requests).toEqual([]);
  });

  it("accepts a time exactly 14 days ago and refuses one a minute older", async () => {
    const requests = scrobbleEndpoint();
    const { user } = await renderSignedIn();
    vi.setSystemTime(new Date("2026-11-06T20:10:00Z"));

    await fill(user, { Artist: "Cher", Track: "Believe", "Played at": "2026-10-23T20:09" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));
    expect(screen.getByLabelText("Played at")).toHaveAccessibleDescription(
      "That's more than 14 days ago. Last.fm only accepts plays from the last 14 days.",
    );
    expect(requests).toEqual([]);

    await fill(user, { "Played at": "2026-10-23T20:10" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));
    await sessionList().findByText("Added");
    expect(requests).toHaveLength(1);
  });

  it("refuses a time in the future", async () => {
    const requests = scrobbleEndpoint();
    const { user } = await renderSignedIn();

    await fill(user, { Artist: "Cher", Track: "Believe", "Played at": "2026-11-06T20:12" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(screen.getByLabelText("Played at")).toHaveAccessibleDescription("That time is in the future.");
    expect(requests).toEqual([]);
  });

  it("is busy while sending and ignores a second press", async () => {
    let calls = 0;
    server.use(http.post("/api/scrobbles", async () => {
      calls++;
      await delay(50);
      return HttpResponse.json({ results: [{ status: "accepted", artist: "Cher", artistCorrected: false, track: "Believe", trackCorrected: false }] });
    }));
    const { user } = await renderSignedIn();

    await fill(user, { Artist: "Cher", Track: "Believe" });
    const button = screen.getByRole("button", { name: "Add scrobble" });
    await user.click(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);

    await sessionList().findByText("Added");
    expect(calls).toBe(1);
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("sends and shows non-Latin names exactly as typed", async () => {
    const requests = scrobbleEndpoint();
    const { user } = await renderSignedIn();

    await fill(user, { Artist: "아이유", Track: "밤편지", Album: "팔레트" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));
    await fill(user, { Artist: "Sigur Rós", Track: "Hoppípolla" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(await sessionList().findByText("Sigur Rós — Hoppípolla")).toBeInTheDocument();
    expect(sessionList().getByText("아이유 — 밤편지")).toBeInTheDocument();
    expect(requests.map((r) => r[0])).toMatchObject([{ artist: "아이유", track: "밤편지", album: "팔레트" }, { artist: "Sigur Rós", track: "Hoppípolla" }]);
  });
});

describe("This session", () => {
  it("shows Last.fm's correction as an edit record", async () => {
    scrobbleEndpoint(() => ({ results: [{ status: "accepted", artist: "Sigur Rós", artistCorrected: true, track: "Hoppípolla", trackCorrected: false }] }));
    const { user } = await renderSignedIn();

    await fill(user, { Artist: "sigur ros", Track: "Hoppípolla" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    const list = sessionList();
    expect(await list.findByText("Sigur Rós", { selector: "ins" })).toBeInTheDocument();
    expect(list.getByText("sigur ros", { selector: "del" })).toBeInTheDocument();
    expect(list.getByText(/Last\.fm corrected the name\./)).toBeInTheDocument();
  });

  it.each([
    [1, "Last.fm ignored this artist."],
    [2, "Last.fm ignored this track."],
    [3, "Last.fm ignored it: the time is too old. Plays must be from the last 14 days."],
    [4, "Last.fm ignored it: the time is too far ahead."],
    [5, "Last.fm ignored it: you've reached today's scrobble limit."],
  ])("explains ignored code %i plainly", async (code, explanation) => {
    scrobbleEndpoint(() => ({ results: [{ status: "ignored", code, message: "raw Last.fm text" }] }));
    const { user } = await renderSignedIn();

    await fill(user, { Artist: "Cher", Track: "Believe" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(await sessionList().findByText("Ignored")).toBeInTheDocument();
    expect(sessionList().getByText(explanation)).toBeInTheDocument();
    expect(screen.getByLabelText("Track")).toHaveValue("Believe");
  });

  it("lists the newest result first and survives a reload", async () => {
    scrobbleEndpoint();
    const { user, unmount } = await renderSignedIn();
    await fill(user, { Artist: "Cher", Track: "Believe" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));
    await sessionList().findByText("Cher — Believe");
    await fill(user, { Track: "Strong Enough" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));
    await sessionList().findByText("Cher — Strong Enough");

    unmount();
    await renderSignedIn();

    const items = sessionList().getAllByRole("listitem").map((li) => li.querySelector(".what")?.textContent);
    expect(items).toEqual(["Cher — Strong Enough", "Cher — Believe"]);
  });

  it("announces the latest result to assistive technology", async () => {
    scrobbleEndpoint();
    const { user } = await renderSignedIn();

    await fill(user, { Artist: "Cher", Track: "Believe" });
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Cher — Believe: Added");
  });
});
