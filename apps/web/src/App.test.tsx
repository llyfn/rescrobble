import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App.tsx";

describe("signed out", () => {
  it("explains rescrobble and offers Log in with Last.fm", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Add the plays Last.fm missed" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in with Last.fm" })).toBeInTheDocument();
    expect(screen.getByText("Powered by AudioScrobbler · Not affiliated with Last.fm")).toBeInTheDocument();
  });
});
