// Regressions for the Oct 2026 audit findings (audit-output/BUGS.md in the auditor's copy).
// The tutor's tool calls are made directly, as the voice agent would; no provider is called.
import { expect, test, type Page } from "@playwright/test";


// These tests aren't about the first-time tour (its own test is in audit.spec.ts): mark it as seen.
test.beforeEach(async ({ page }, info) => {
  if (info.title.includes("guided tour")) return;
  await page.addInitScript(() => {
    localStorage.setItem("shikshak.tour.home.v1", "1");
    localStorage.setItem("shikshak.tour.class.v1", "1");
  });
});

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

test("BUG-07: the first screen says what Shikshak is", async ({ page }) => {
  await page.goto("/");
  const pitch = page.locator(".home-empty");
  await expect(pitch).toContainText(/voice maths tutor/i);
  await expect(pitch).toContainText(/handwritten/i);
  await expect(page.getByText(/Physics/)).toHaveCount(0);
});

test("BUG-11: a class can't be created without a topic", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /New session/ }).first().click();
  const create = page.getByRole("button", { name: "Create session" });
  await expect(create).toBeDisabled();
  await page.getByPlaceholder("e.g. Quadratic equations").fill("Quadratic equations");
  await expect(create).toBeEnabled();
});

test("BUG-09: Start with no voice on the server stays Start, never 'Paused' or 'Resume'", async ({ page }) => {
  await openClass(page);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByText(/Voice isn't set up/)).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Resume" })).toHaveCount(0);
  await expect(page.getByText("Paused", { exact: true })).toHaveCount(0);
});

test("no quick-check pop-up when a new class opens", async ({ page }) => {
  await openClass(page);
  await page.waitForTimeout(1500);
  await expect(page.getByText("New topic?")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start quick check" })).toHaveCount(0);
});

test("BUG-03 + BUG-12: a quick check the tutor starts wants an expanded answer and shows an example of the right shape", async ({ page }) => {
  const id = await openClass(page);
  // The pop-up is gone; the voice tutor can still start one if the student asks to be tested.
  await tool(page, "diagnostic", { session_code: id, action: "start", chapter: "quadratic" });
  await expect(page.getByText(/Expand/).first()).toBeVisible();
  const box = page.getByRole("textbox", { name: "Your answer" });
  await expect(box).toHaveAttribute("placeholder", /x\^2/);
  await expect(page.getByText("Rough work here; type your answer in the box below")).toBeVisible();
  await box.fill("(x+3)(x+3)");
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText(/not expanded yet/)).toBeVisible();
});

test("BUG-18: a fake check is labelled as simulated on the student's screen", async ({ page }) => {
  const id = await openClass(page);
  await tool(page, "next_problem", { session_code: id, problem_id: "quad.fact.01" });
  const at = (await page.getByText("Write here, one step per line").boundingBox())!;
  for (let i = 0; i < 3; i++) await scribble(page, at.x + 10, at.y + 15 + i * 55, 200);
  await page.locator("button.btn-done").click();
  const card = page.locator(".submission");
  await expect(card).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  await expect(card).toContainText("Simulated check");
});

test("the Student / Teacher switch wipes the board and changes mode, both ways", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("switch", { name: "Teacher mode" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(page.locator(".duster-wipe")).toBeAttached();
  await expect(page).toHaveURL(/#\/teacher$/);
  await expect(page.getByRole("heading", { name: "Teacher view" })).toBeVisible();
  await expect(page.locator(".duster-wipe")).toHaveCount(0, { timeout: 5000 });
  await page.getByRole("switch", { name: "Teacher mode" }).click();
  await expect(page).toHaveURL(/#\/$/, { timeout: 5000 });
  await expect(page.getByRole("switch", { name: "Teacher mode" })).toHaveAttribute("aria-checked", "false");
});

test("Scan a question: under From paper, and says clearly when the reader isn't set up", async ({ page }) => {
  await openClass(page);
  await page.getByRole("button", { name: "From paper" }).click();
  await expect(page.getByRole("menuitem", { name: /Add a question/ })).toBeVisible();
  await page.keyboard.press("Escape");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator('input[data-paper="question"]').setInputFiles({ name: "q.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText(/Couldn't scan it: .*isn't set up/)).toBeVisible();
});

test("Paper mode: a photo of my working is pinned on the board, checked, and marked on the photo", async ({ page }) => {
  const id = await openClass(page);
  await tool(page, "next_problem", { session_code: id, problem_id: "quad.fact.01" });
  await page.getByRole("button", { name: "From paper" }).click();
  await expect(page.getByRole("menuitem", { name: /Send my working/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator('input[data-paper="work"]').setInputFiles("e2e/paper-working.jpg");
  const photo = page.locator(".photo-page");
  await expect(photo.locator("img")).toBeVisible({ timeout: 15_000 });
  await expect(photo).toContainText("Your working");
  const card = page.locator(".submission");
  await expect(card).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  await expect(card).toContainText("Simulated check");
  // The circle sits on the photo.
  const circle = page.locator(".mark-note");
  await expect(circle).toBeVisible();
  const [p, c] = [(await photo.boundingBox())!, (await circle.boundingBox())!];
  expect(c.y).toBeGreaterThan(p.y);
  expect(c.y).toBeLessThan(p.y + p.height);
});

test("guided tour: the first visit walks through the controls, once, and can be replayed", async ({ page }) => {
  await page.goto("/");
  const bubble = page.locator(".tour-bubble");
  await expect(bubble).toContainText("Namaste", { timeout: 5000 });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(bubble).toContainText("Student or Teacher");
  await expect(page.locator(".tour-spot")).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.locator(".tour")).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.locator(".tour")).toHaveCount(0);
  // The first class has its own tour, ending with how a class goes.
  await page.getByRole("button", { name: /New session/ }).first().click();
  await page.getByPlaceholder("e.g. Quadratic equations").fill("Quadratic equations");
  await page.getByRole("button", { name: "Create session" }).click();
  await expect(bubble).toContainText("This is our blackboard", { timeout: 10_000 });
  for (let i = 0; i < 12 && !(await bubble.textContent())?.includes("How we'll learn"); i++) await page.getByRole("button", { name: "Next" }).click();
  await expect(bubble).toContainText("I explain on the board");
  await page.getByRole("button", { name: "Let's start" }).click();
  await expect(page.locator(".tour")).toHaveCount(0);
  await page.getByRole("button", { name: "Session menu" }).click();
  await page.getByRole("menuitem", { name: "Show me around" }).click();
  await expect(bubble).toBeVisible();
});
