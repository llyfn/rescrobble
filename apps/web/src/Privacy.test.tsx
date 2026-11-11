import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App.tsx";
import { Privacy } from "./Privacy.tsx";

describe("privacy", () => {
  it("is linked from the footer", async () => {
    render(<App />);

    expect(await screen.findByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });

  it("explains what rescrobble keeps and links back to the Web App", () => {
    render(<Privacy />);

    expect(screen.getByRole("heading", { level: 1, name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "What the server keeps" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "rescrobble" })).toHaveAttribute("href", "/");
    expect(screen.getByText("Powered by AudioScrobbler")).toBeInTheDocument();
  });
});
