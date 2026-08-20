import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

describe("design system tokens", () => {
  it.each([
    "--radius-xs",
    "--radius-xl",
    "--space-1",
    "--space-7",
    "--text-primary",
    "--text-muted",
    "--surface-0",
    "--surface-2",
    "--surface-hover",
    "--surface-active",
    "--border-subtle",
    "--border-strong",
    "--shadow-sm",
    "--shadow-lg",
    "--motion-fast",
    "--motion-normal",
    "--motion-slow",
  ])("defines %s", (token) => {
    expect(tokensCss).toContain(`${token}:`);
  });

  it("keeps established feature variables as semantic aliases", () => {
    expect(tokensCss).toContain("--surface: var(--surface-1)");
    expect(tokensCss).toContain("--border: var(--border-subtle)");
    expect(tokensCss).toContain("--muted: var(--text-muted)");
  });
});
