import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outputServerEntry = resolve(process.cwd(), ".output/server/index.mjs");
if (!existsSync(outputServerEntry)) {
  throw new Error(
    `Built Nitro server entry not found at ${outputServerEntry}. Run "npm run build" before verifying the Playwright runtime.`,
  );
}

function resolveProjectBrowsersPath() {
  const candidates = [resolve(process.cwd(), ".playwright-browsers")];
  let current = dirname(outputServerEntry);
  for (let i = 0; i < 4; i++) {
    const candidate = resolve(current, ".playwright-browsers");
    if (!candidates.includes(candidate)) candidates.push(candidate);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  const configured = process.env["PLAYWRIGHT_BROWSERS_PATH"]?.trim();
  if (configured && configured !== "0") {
    const resolvedConfigured = resolve(process.cwd(), configured);
    if (existsSync(resolvedConfigured)) {
      return resolvedConfigured;
    }
  }

  return candidates[0];
}

const browsersPath = resolveProjectBrowsersPath();
process.env["PLAYWRIGHT_BROWSERS_PATH"] = browsersPath;

const serverRequire = createRequire(outputServerEntry);
const playwrightPkgPath = serverRequire.resolve("playwright/package.json");
const playwrightCorePkgPath = serverRequire.resolve("playwright-core/package.json");
const playwrightPkg = JSON.parse(readFileSync(playwrightPkgPath, "utf8"));
const esmEntryRel =
  typeof playwrightPkg?.exports?.["."]?.import === "string"
    ? playwrightPkg.exports["."].import
    : "./index.mjs";
const resolvedPlaywrightEntry = resolve(dirname(playwrightPkgPath), esmEntryRel);

console.info("[verify-playwright-runtime] Resolved modules from built Nitro server:", {
  outputServerEntry,
  resolvedPlaywrightEntry,
  playwrightCoreDir: dirname(playwrightCorePkgPath),
  PLAYWRIGHT_BROWSERS_PATH: process.env["PLAYWRIGHT_BROWSERS_PATH"],
});

const { chromium } = await import(pathToFileURL(resolvedPlaywrightEntry).href);
const executablePath = chromium.executablePath();
console.info("[verify-playwright-runtime] Computed Chromium executablePath:", executablePath);

if (!existsSync(executablePath)) {
  throw new Error(
    `Chromium executable missing at ${executablePath} (PLAYWRIGHT_BROWSERS_PATH=${browsersPath}, playwright-core=${dirname(playwrightCorePkgPath)}).`,
  );
}

const browser = await chromium.launch({
  headless: true,
  channel: "chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  const context = await browser.newContext();
  await context.close();
} finally {
  await browser.close();
}

console.log("LinkedIn Chromium runtime verification successful");
