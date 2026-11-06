import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { server } from "./test/server.ts";
import { acceptAll, renderSignedIn } from "./test/app.tsx";

function failWith(status: number, body?: object, retryAfter?: string) {
  server.use(http.post("/api/scrobbles", () =>
    HttpResponse.json(body ?? {}, { status, headers: retryAfter ? { "Retry-After": retryAfter } : {} })));
}

async function submitBelieve() {
  const view = await renderSignedIn();
  await view.user.type(screen.getByLabelText("Artist"), "Cher");
  await view.user.type(screen.getByLabelText("Track"), "Believe");
  await view.user.type(screen.getByLabelText("Album"), "Believe");
  await view.user.click(screen.getByRole("button", { name: "Add scrobble" }));
  return view;
}

function expectFormKept() {
  expect(screen.getByLabelText("Artist")).toHaveValue("Cher");
  expect(screen.getByLabelText("Track")).toHaveValue("Believe");
  expect(screen.getByLabelText("Album")).toHaveValue("Believe");
  expect(within(screen.getByRole("region", { name: "This session" })).queryAllByRole("listitem")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Add scrobble" })).not.toHaveAttribute("aria-busy");
}

describe("when a submission fails", () => {
  it("says how long to wait after too many requests, keeping the form", async () => {
    failWith(429, { error: "tooManyRequests" }, "8");
    await submitBelieve();

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests. Try again in 8 seconds.");
    expectFormKept();
  });

  it("says roughly how many hours until the daily allowance frees up", async () => {
    failWith(429, { error: "dailyLimit" }, "9000");
    await submitBelieve();

    expect(await screen.findByRole("alert")).toHaveTextContent("You've reached today's scrobble allowance. Try again in about 3 hours.");
    expectFormKept();
  });

  it("counts in minutes when the allowance frees up within the hour", async () => {
    failWith(429, { error: "dailyLimit" }, "125");
    await submitBelieve();

    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in about 3 minutes.");
  });

  it("says Last.fm isn't responding when it is unavailable, keeping the form", async () => {
    failWith(503, { error: "lastFmUnavailable" }, "60");
    await submitBelieve();

    expect(await screen.findByRole("alert")).toHaveTextContent("Last.fm isn't responding. Try again in a minute.");
    expectFormKept();
  });

  it("clears the notice once a retry succeeds", async () => {
    failWith(503, { error: "lastFmUnavailable" });
    const { user } = await submitBelieve();
    await screen.findByRole("alert");

    server.use(http.post("/api/scrobbles", async ({ request }) => {
      const body = await request.json() as { scrobbles: Parameters<typeof acceptAll>[0] };
      return HttpResponse.json(acceptAll(body.scrobbles));
    }));
    await user.click(screen.getByRole("button", { name: "Add scrobble" }));

    expect(await within(screen.getByRole("region", { name: "This session" })).findByText("Added")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
