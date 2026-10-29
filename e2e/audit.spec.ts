// Regressions for the Oct 2026 audit findings (audit-output/BUGS.md in the auditor's copy).
// The tutor's tool calls are made directly, as the voice agent would; no provider is called.
import { expect, test, type Page } from "@playwright/test";

async function openClass(page: Page, topic = "Quadratic equations") {
  await page.goto("/");
  await page.getByRole("button", { name: /New session/ }).first().click();
  await page.getByPlaceholder("e.g. Quadratic equations").fill(topic);
  await page.getByRole("button", { name: "Create session" }).click();
  await expect(page.locator("canvas.board-ink")).toBeVisible({ timeout: 20_000 });
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  // The tools take the server's session id (what the voice agent is given), not the short code in the URL.
  return page.evaluate(async () => {
    const short = location.hash.split("/s/")[1];
    const token = localStorage.getItem("shikshak.device");
    const { sessions } = await (await fetch("/api/sessions", { headers: { authorization: `Bearer ${token}` } })).json();
    return (sessions.find((s: { id: string }) => JSON.stringify(s).includes(short)) ?? sessions[0]).id as string;
  });
}

async function tool(page: Page, name: string, body: Record<string, unknown>) {
  return (await page.request.post(`/tools/${name}`, { data: body })).json();
}

/** A wavy line of "handwriting" starting at (x, y) in page pixels; returns its box. */
async function scribble(page: Page, x: number, y: number, w: number) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 0; i <= w; i += 10) await page.mouse.move(x + i, y + Math.sin(i / 9) * 9);
  await page.mouse.up();
  return { x, y: y - 10, w, h: 20 };
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.width && a.y < b.y + b.h && b.y < a.y + a.height;

for (const delay of [100, 600, 1500]) {
  test(`BUG-01: a hint never lands on writing the student starts ${delay} ms after it was sent`, async ({ page }) => {
    const id = await openClass(page);
    await tool(page, "next_problem", { session_code: id, problem_id: "quad.fact.01" });
    const writeHere = page.getByText("Write here, one step per line");
    await expect(writeHere).toBeVisible();
    await page.waitForTimeout(1500);
    await tool(page, "give_hint", { session_code: id });
    await page.waitForTimeout(delay);
    // The student writes where the board tells them to.
    const at = (await writeHere.boundingBox())!;
    const width = Math.min(380, (page.viewportSize()?.width ?? 400) - at.x - 20);
    const ink = [await scribble(page, at.x + 10, at.y + 15, width), await scribble(page, at.x + 10, at.y + 70, width)];
    const hint = page.locator(".tblock").filter({ hasText: "Nudge 1 of 3" });
    await expect(hint).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500); // fully revealed and laid out
    const box = (await hint.boundingBox())!;
    for (const stroke of ink) expect(overlaps(box, stroke), `hint ${JSON.stringify(box)} vs ink ${JSON.stringify(stroke)}`).toBe(false);
  });
}

test("BUG-06: after three hints the question is still on screen", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 900, "desktop layout");
  const id = await openClass(page);
  await tool(page, "next_problem", { session_code: id, problem_id: "quad.fact.01" });
  const at = (await page.getByText("Write here, one step per line").boundingBox())!;
  await scribble(page, at.x + 10, at.y + 15, 380);
  await scribble(page, at.x + 10, at.y + 70, 380);
  for (let i = 0; i < 3; i++) {
    await tool(page, "give_hint", { session_code: id });
    await page.waitForTimeout(2500);
  }
  await expect(page.locator(".tblock").filter({ hasText: "One step 3 of 3" })).toBeInViewport();
  // Either the question is still on screen, or it's pinned at the top and one tap brings it back.
  const question = page.locator(".tblock-problem").last();
  const ratio = await question.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight ? 1 : 0;
  });
  if (!ratio) {
    const pinned = page.locator(".board-pill-question");
    await expect(pinned).toBeVisible();
    await expect(pinned).toContainText("Solve by factorisation");
    await pinned.click();
    await expect(question).toBeInViewport();
    await expect(pinned).toBeHidden();
  }
});
