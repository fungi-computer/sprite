/* global clearTimeout, console, document, setTimeout */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ladleBin = resolve(packageRoot, "node_modules/.bin/ladle");
const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || !Object.hasOwn(address, "port"))
  throw new Error("Could not allocate a Ladle port");
const port = address.port;
server.close();
await once(server, "close");

const ladle = spawn(
  ladleBin,
  ["serve", "--host", "127.0.0.1", "--port", String(port)],
  { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] },
);
const ready = new Promise((resolveReady, rejectReady) => {
  let output = "";
  const record = (chunk) => {
    output += String(chunk);
    if (output.includes(`http://127.0.0.1:${String(port)}/`)) resolveReady();
  };
  ladle.stdout.on("data", record);
  ladle.stderr.on("data", record);
  ladle.once("exit", (code) =>
    rejectReady(new Error(`Ladle exited (${String(code)}): ${output}`)),
  );
});
let browser;
try {
  let startupTimer;
  try {
    await Promise.race([
      ready,
      new Promise((_, reject) => {
        startupTimer = setTimeout(
          () => reject(new Error("Ladle startup timed out")),
          30_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(startupTimer);
  }
  browser = await chromium.launch();
  const url = `http://127.0.0.1:${String(port)}/?story=sprite--media--muse-video&mode=preview`;
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes(".mp4")) requests.push(request.url());
  });
  await page.goto(url);
  const avatar = page.getByTestId("muse-video-avatar");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="muse-video-avatar"]')
        ?.getAttribute("data-sprite-status") === "ready",
  );
  const frame = async () =>
    avatar.locator("video").evaluate((video) => ({
      src: video.currentSrc,
      width: video.videoWidth,
      height: video.videoHeight,
      muted: video.muted,
      loop: video.loop,
      paused: video.paused,
    }));
  const idle = await frame();
  assert(idle.width > 0 && idle.height > 0, "MP4 decoded a first frame");
  assert(idle.muted && idle.loop, "MP4 plays silently and loops");
  const initialRequests = requests.length;
  assert(initialRequests >= 2, "both clips were admitted");
  await page.getByRole("button", { name: "Thinking" }).click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector('[data-testid="muse-video-avatar"] video')
        ?.currentSrc !== previous,
    idle.src,
  );
  const thinking = await frame();
  assert(thinking.width > 0 && thinking.height > 0, "working clip decoded");
  await page.getByRole("button", { name: "Streaming" }).click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="muse-video-avatar"] video')
        ?.currentSrc === expected,
    idle.src,
  );
  assert.equal(
    requests.length,
    initialRequests,
    "activity changes reuse the admitted clips",
  );
  assert.deepEqual(errors, [], "MP4 story has no page errors");

  const reduced = await browser.newPage({ reducedMotion: "reduce" });
  await reduced.goto(url);
  await reduced.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="muse-video-avatar"]')
        ?.getAttribute("data-sprite-status") === "ready",
  );
  assert.equal(
    await reduced
      .locator('[data-testid="muse-video-avatar"] video')
      .evaluate((video) => video.paused),
    true,
    "reduced motion keeps the decoded first frame paused",
  );
  console.log(
    "PASS: MP4 decoding, semantic activity switching, no refetch, reduced motion",
  );
} finally {
  await browser?.close();
  if (ladle.exitCode === null) {
    ladle.kill("SIGTERM");
    await once(ladle, "exit");
  }
}
