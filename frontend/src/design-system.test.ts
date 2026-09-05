import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
const exportCss = readFileSync(
  resolve(process.cwd(), "../design-system-export/tokens.css"),
  "utf8",
);
const exportJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "../design-system-export/tokens.json"), "utf8"),
) as Record<string, unknown>;

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
    "--focus-ring-color",
    "--focus-ring-width",
    "--focus-ring-offset",
  ])("defines %s", (token) => {
    expect(tokensCss).toContain(`${token}:`);
  });

  it("keeps established feature variables as semantic aliases", () => {
    expect(tokensCss).toContain("--surface: var(--surface-card)");
    expect(tokensCss).toContain("--border: var(--border-default)");
    expect(tokensCss).toContain("--muted: var(--text-muted)");
  });

  it("ships a standalone export without Meme Vault component selectors", () => {
    expect(exportCss).toContain("--surface-card: var(--color-neutral-900)");
    expect(exportCss).toContain("--focus-ring-shadow:");
    expect(exportCss).not.toMatch(/\.(?:meme|library|inspector|immersive)-/);
  });

  it("ships valid machine-readable token categories", () => {
    expect(exportJson).toMatchObject({
      color: { primitive: {}, semantic: {} },
      typography: {},
      spacing: {},
      radius: {},
      border: {},
      shadow: {},
      motion: {},
      focus: {},
      control: {},
    });
  });
});
