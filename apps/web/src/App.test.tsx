import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "./test/server.ts";
import { App } from "./App.tsx";

function signedInAs(username: string) {
  server.use(http.get("/api/me", () => HttpResponse.json({ username, pro: false })));
}

describe("signed out", () => {
  it("explains rescrobble and offers Log in with Last.fm", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Add the plays Last.fm missed" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in with Last.fm" })).toHaveAttribute("href", "/auth/login");
    expect(screen.getByText("Powered by AudioScrobbler")).toBeInTheDocument();
  });

  it("shows a notice after a failed sign-in and clears the flag from the URL", async () => {
    window.history.replaceState(null, "", "/?signIn=failed&tab=album");

    render(<StrictMode><App /></StrictMode>);

    expect(await screen.findByText("Sign-in didn't complete. Try again.")).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe("?tab=album"));
    window.history.replaceState(null, "", "/");
  });

  it("shows no notice on an ordinary visit", async () => {
    render(<App />);

    await screen.findByRole("heading", { name: "Add the plays Last.fm missed" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("signed in", () => {
  it("shows the Last.fm username and a sign-out control", async () => {
    signedInAs("rj");

    render(<App />);

    expect(await screen.findByText("rj")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add scrobbles" })).toBeInTheDocument();
  });

  it("signs out through the backend and returns to the signed-out page", async () => {
    signedInAs("rj");
    let loggedOut = false;
    server.use(http.post("/auth/logout", () => {
      loggedOut = true;
      return new HttpResponse(null, { status: 204 });
    }));
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(loggedOut).toBe(true);
    expect(await screen.findByRole("link", { name: "Log in with Last.fm" })).toBeInTheDocument();
    expect(screen.queryByText("rj")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("returns to the signed-out page with an explanation when a later call finds the session ended", async () => {
    signedInAs("rj");
    server.use(http.post("/auth/logout", () => HttpResponse.json({ error: "sessionInvalid" }, { status: 401 })));
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByText("Your Last.fm session has ended. Log in again.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in with Last.fm" })).toBeInTheDocument();
  });
});
