import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { lastFmHistory, type Play } from "./test/lastfmHistory.ts";
import { renderSignedIn } from "./test/extension.tsx";

const library: Play[] = [
  { timestamp: 1_790_000_600, artist: "Radiohead", track: "Paranoid Android - Remastered", album: "OK Computer OKNOTOK" },
  { timestamp: 1_790_000_300, artist: "Radiohead", track: "Airbag - Remastered", album: "OK Computer OKNOTOK" },
  { timestamp: 1_790_000_000, artist: "Radiohead", track: "Let Down", album: "" },
  { timestamp: 1_780_000_000, artist: "Cher", track: "Believe", album: "Believe" },
  { timestamp: 1_780_000_020, artist: "Cher", track: "Believe", album: "Believe" },
];

const fact = (name: string) => screen.queryByText(name, { selector: "dt" })?.nextElementSibling?.textContent;
const table = () => within(screen.getByRole("table", { name: "Scrobbles" }));
/** The Track column's text in each row, found by its header so the checkbox column doesn't shift it. */
const trackCells = () => {
  const rows = table().getAllByRole("row") as HTMLTableRowElement[];
  const column = [...rows[0]!.cells].findIndex((c) => c.textContent === "Track");
  return rows.slice(1).map((r) => r.cells[column]?.textContent);
};

async function open() {
  lastFmHistory(library);
  const view = await renderSignedIn();
  await waitFor(() => expect(fact("Scrobbles")).toBe("5"));
  return view;
}

async function addFilter(user: Awaited<ReturnType<typeof open>>["user"], options: { field?: string; mode?: string; value?: string; caseSensitive?: boolean }) {
  await user.click(screen.getByRole("button", { name: "Filter" }));
  const editor = within(screen.getByRole("form", { name: "New filter" }));
  if (options.field) await user.selectOptions(editor.getByLabelText("Field"), options.field);
  if (options.mode) await user.selectOptions(editor.getByLabelText("Match"), options.mode);
  if (options.value !== undefined) await user.type(editor.getByLabelText("Value"), options.value);
  if (options.caseSensitive) await user.click(editor.getByLabelText("Match case"));
  return editor;
}

describe("filtering History", () => {
  it("narrows the table to matches, marks why each matched, and counts them", async () => {
    const { user } = await open();

    const editor = await addFilter(user, { value: "remastered" });
    await user.click(editor.getByRole("button", { name: "Add filter" }));

    expect(screen.getByText("Track contains “remastered”")).toBeInTheDocument();
    expect(fact("Matching")).toBe("2");
    expect(trackCells()).toEqual(["Paranoid Android - Remastered", "Airbag - Remastered"]);
    expect(table().getAllByText("Remastered", { selector: "mark" })).toHaveLength(2);
  });

  it("combines conditions and restores everything when they are removed", async () => {
    const { user } = await open();
    let editor = await addFilter(user, { field: "artist", mode: "exact", value: "radiohead" });
    await user.click(editor.getByRole("button", { name: "Add filter" }));
    editor = await addFilter(user, { field: "album", mode: "empty" });
    await user.click(editor.getByRole("button", { name: "Add filter" }));

    expect(trackCells()).toEqual(["Let Down"]);

    await user.click(screen.getByRole("button", { name: "Remove filter: Album is empty" }));
    await user.click(screen.getByRole("button", { name: "Remove filter: Artist is “radiohead”" }));
    expect(fact("Matching")).toBeUndefined();
    expect(trackCells()).toHaveLength(5);
  });

  it("respects Match case", async () => {
    const { user } = await open();

    const editor = await addFilter(user, { value: "remastered", caseSensitive: true });
    await user.click(editor.getByRole("button", { name: "Add filter" }));

    expect(screen.getByText("Track contains “remastered” (case)")).toBeInTheDocument();
    expect(screen.getByText("No scrobbles match")).toBeInTheDocument();
  });

  it("flags an invalid regex on its chip and matches nothing", async () => {
    const { user } = await open();

    const editor = await addFilter(user, { mode: "regex", value: "Remaster(" });
    await user.click(editor.getByRole("button", { name: "Add filter" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/^Not a valid regex:/);
    expect(screen.getByText("No scrobbles match")).toBeInTheDocument();
  });

  it("filters by when a Scrobble was played", async () => {
    const { user } = await open();

    const editor = await addFilter(user, { field: "played" });
    fireEvent.change(editor.getByLabelText("From"), { target: { value: "2026-09-21T00:00" } });
    await user.click(editor.getByRole("button", { name: "Add filter" }));

    expect(fact("Matching")).toBe("3");
    expect(trackCells()).not.toContain("Believe");
  });

  it("finds Duplicates and keeps the first play", async () => {
    const { user } = await open();

    const editor = await addFilter(user, { field: "duplicates" });
    expect(editor.getByLabelText("Within seconds")).toHaveValue(30);
    await user.click(editor.getByRole("button", { name: "Add filter" }));

    expect(screen.getByText("Duplicates within 30 s")).toBeInTheDocument();
    expect(fact("Matching")).toBe("1");
    expect(within(table().getAllByRole("row")[1]!).getByText("28 May 2026 20:27")).toBeInTheDocument();
  });
});

describe("selecting Scrobbles", () => {
  it("starts with nothing selected and lets rows be checked without a Filter", async () => {
    const { user } = await open();

    expect(fact("Selected")).toBeUndefined();
    expect(screen.queryByRole("toolbar", { name: "Actions for the selection" })).not.toBeInTheDocument();

    await user.click(screen.getAllByRole("checkbox", { name: /^Select Cher — Believe/ })[0]!);

    expect(fact("Selected")).toBe("1");
    expect(screen.getByRole("button", { name: "Delete 1 scrobble" })).toBeInTheDocument();
  });

  it("selects every row with the header checkbox when there is no Filter", async () => {
    const { user } = await open();

    await user.click(screen.getByRole("checkbox", { name: "Select all scrobbles" }));

    expect(fact("Selected")).toBe("5");
  });

  it("selects nothing when a Filter is added, and lets matches be checked one by one or all at once", async () => {
    const { user } = await open();
    const editor = await addFilter(user, { field: "artist", mode: "exact", value: "Radiohead" });
    await user.click(editor.getByRole("button", { name: "Add filter" }));

    expect(fact("Matching")).toBe("3");
    expect(fact("Selected")).toBeUndefined();
    const selectAll = screen.getByRole("checkbox", { name: "Select all matching scrobbles" });
    expect(selectAll).not.toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: /^Select Radiohead — Let Down/ }));

    expect(fact("Selected")).toBe("1");
    expect(selectAll).toHaveProperty("indeterminate", true);
    expect(table().getAllByRole("row").filter((r) => r.getAttribute("aria-selected") === "true")).toHaveLength(1);

    await user.click(selectAll);
    expect(fact("Selected")).toBe("3");
    expect(selectAll).toBeChecked();
    await user.click(selectAll);
    expect(fact("Selected")).toBeUndefined();
  });

  it("unchecks rows that a new Filter hides", async () => {
    const { user } = await open();
    await user.click(screen.getByRole("checkbox", { name: /^Select Radiohead — Let Down/ }));
    await user.click(screen.getAllByRole("checkbox", { name: /^Select Cher — Believe/ })[0]!);
    expect(fact("Selected")).toBe("2");

    const editor = await addFilter(user, { field: "artist", mode: "exact", value: "Radiohead" });
    await user.click(editor.getByRole("button", { name: "Add filter" }));
    expect(fact("Selected")).toBe("1");

    await user.click(screen.getByRole("button", { name: /^Remove filter/ }));
    expect(fact("Selected")).toBe("1");
    expect(screen.getAllByRole("checkbox", { name: /^Select Cher — Believe/ }).every((c) => !(c as HTMLInputElement).checked)).toBe(true);
  });
});
