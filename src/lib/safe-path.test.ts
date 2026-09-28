import { describe, expect, test } from "bun:test";
import { safeNextPath } from "./safe-path";

describe("safeNextPath", () => {
  test("keeps paths inside the app", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/transactions")).toBe("/transactions");
    expect(safeNextPath("/transactions?tag=goa#top")).toBe(
      "/transactions?tag=goa#top",
    );
  });

  test("falls back to / when missing", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  test("rejects anything that leaves the app", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("/\t/evil.example")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath("transactions")).toBe("/");
  });
});
