import { expect, test, type Page } from "@playwright/test";


// These tests aren't about the first-time tour (its own test is in audit.spec.ts): mark it as seen.
test.beforeEach(async ({ page }, info) => {
  // The start screen has its own test.
  if (!info.title.includes("start screen")) await page.addInitScript(() => sessionStorage.setItem("shikshak.splashSeen", "1"));
  if (info.title.includes("guided tour")) return;
  await page.addInitScript(() => {
    localStorage.setItem("shikshak.tour.home.v1", "1");
    localStorage.setItem("shikshak.tour.class.v1", "1");
  });
});

async function addLearner(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Add learner" }).click();
  await page.getByPlaceholder("Asha").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  // Learners are profiles: the new one is picked and shows as the profile button, with "My progress".
  await expect(page.getByRole("button", { name: `Profile: ${name}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "My progress" })).toBeVisible();
}

test("a learner can be added and a class created and opened, with no horizontal scrolling", async ({ page }) => {
  await addLearner(page, "Asha");
  await page.getByRole("button", { name: /New session/ }).first().click();
  await page.getByPlaceholder("e.g. Quadratic equations").fill("Arithmetic progressions");
  await page.getByRole("button", { name: "Create session" }).click();
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("the progress page is honest with no evidence and shows phone revision as off", async ({ page }) => {
  await addLearner(page, "Ravi");
  await page.getByRole("button", { name: "My progress" }).click();
  await expect(page.getByRole("heading", { name: "Phone revision" })).toBeVisible();
  await expect(page.getByText("Phone calls are switched off on this server")).toBeVisible();
  await expect(page.getByText(/mastered|excellent/i)).toHaveCount(0);
});

test("teacher view asks for a code; pilot tools require consent", async ({ page }) => {
  await page.goto("/#/teacher");
  await page.getByLabel("Access code").fill("123456");
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByRole("heading", { name: "Teacher view" })).toBeVisible();
  await expect(page.getByText(/code/i).first()).toBeVisible();
  await page.goto("/#/pilot");
  await expect(page.getByText(/consent/i).first()).toBeVisible();
});

test("health says what is configured without claiming providers work", async ({ request }) => {
  const h = await (await request.get("/api/health")).json();
  expect(h.configured).toMatchObject({ checker: false, voice: false, phone: false });
  const p = await (await request.get("/api/health/providers")).json();
  expect(p.checker.gemini).toMatchObject({ configured: false, verified: false });
  expect(p.voice.bolna).toMatchObject({ configured: false, verified: false });
});

test("practice question, write on the board, press Done: marked, with practice marks labelled as not official", async ({ page }) => {
  await addLearner(page, "Meera");
  await page.getByRole("button", { name: /New session/ }).first().click();
  await page.getByPlaceholder("e.g. Quadratic equations").fill("Arithmetic progressions");
  await page.getByRole("button", { name: "Create session" }).click();
  const ink = page.locator("canvas.board-ink");
  await expect(ink).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Session menu" }).click();
  await page.getByRole("menuitem", { name: /Give me a practice question/ }).click();
  await expect(page.locator(".submission, .btn-done").first()).toBeVisible();
  await expect(page.getByText(/term|AP/).first()).toBeVisible();
  // Three lines of "working" (the test server's fake checker reads any two or more lines as working).
  const box = (await ink.boundingBox())!;
  for (let i = 0; i < 3; i++) {
    const y = box.y + box.height * (0.45 + i * 0.08);
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.35, y + 6, { steps: 8 });
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 8 });
    await page.mouse.up();
  }
  await page.locator("button.btn-done").click();
  const card = page.locator(".submission");
  await expect(card).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  await expect(card.locator(".submission-marks")).toContainText("Practice marks");
  await expect(card.locator(".submission-marks")).toContainText(/not official|provisional/);
});
