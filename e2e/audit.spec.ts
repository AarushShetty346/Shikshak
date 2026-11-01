// Regressions for the Oct 2026 audit findings (audit-output/BUGS.md in the auditor's copy).
// The tutor's tool calls are made directly, as the voice agent would; no provider is called.
import { expect, test, type Page } from "@playwright/test";


// These tests aren't about the first-time tour (its own test is in audit.spec.ts): mark it as seen.
test.beforeEach(async ({ page }, info) => {
  // The start screen has its own test.
  if (!info.title.includes("start screen")) await page.addInitScript(() => sessionStorage.setItem("shikshak.test.skipSplash", "1"));
  if (info.title.includes("guided tour")) return;
  await page.addInitScript(() => {
    localStorage.setItem("shikshak.tour.home.v1", "1");
    localStorage.setItem("shikshak.tour.class.v1", "1");
  });
});

/** No account on this device: the home screen asks for one first (classes belong to an account). */
async function ensureAccount(page: Page, name = "Tester") {
  const form = page.getByRole("heading", { name: "Create your account" });
  await expect(page.getByRole("button", { name: /New session/ }).first().or(form)).toBeVisible({ timeout: 15_000 });
  if (await form.isVisible()) {
    await page.getByLabel("Name or nickname").fill(name);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("button", { name: /New session/ }).first()).toBeVisible();
  }
}

async function openClass(page: Page, topic = "Quadratic equations") {
  await page.goto("/");
  await ensureAccount(page);
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
  await ensureAccount(page);
  const pitch = page.locator(".home-empty");
  await expect(pitch).toContainText(/I am Shikshak, your tutor/);
  await expect(pitch).toContainText(/handwritten/i);
  await expect(page.getByText(/Physics/)).toHaveCount(0);
});

test("BUG-11: a class can't be created without a topic", async ({ page }) => {
  await page.goto("/");
  await ensureAccount(page);
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

test("a new session: the duster wipes the board, then the class opens", async ({ page }) => {
  await page.goto("/");
  await ensureAccount(page);
  await page.getByRole("button", { name: /New session/ }).first().click();
  await page.getByPlaceholder("e.g. Quadratic equations").fill("Quadratic equations");
  await page.getByRole("button", { name: "Create session" }).click();
  await expect(page.locator(".duster-wipe")).toBeAttached();
  await expect(page.locator("canvas.board-ink")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".duster-wipe")).toHaveCount(0, { timeout: 5000 });
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

test("Fix it on a photo: the slips are marked on the photo and the answer is written exam-style", async ({ page }) => {
  await openClass(page);
  await page.locator('input[data-paper="work"]').setInputFiles("e2e/paper-working.jpg");
  const photo = page.locator(".photo-page");
  await expect(photo.locator("img")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".submission")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  // The button sits under the ink layer; a tap on it presses it rather than drawing.
  const fix = photo.getByRole("button", { name: "Fix it" });
  await fix.scrollIntoViewIfNeeded();
  const at = (await fix.boundingBox())!;
  await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
  const block = page.locator(".fix-block");
  await expect(block).toBeVisible({ timeout: 15_000 });
  await expect(block).toContainText("(simulated)");
  await expect(block.locator(".fix-band")).toHaveCount(1);
  await expect(block.locator(".fix-photo img")).toBeVisible();
  // Exam layout: steps with ⇒ and ∵, ending in a boxed "∴" answer.
  await expect(block.locator(".exam-line").filter({ hasText: "⇒" }).first()).toBeVisible();
  await expect(block.locator(".exam-line").filter({ hasText: "∵" })).toHaveCount(1);
  await expect(block.locator(".exam-final")).toHaveText("∴ x = 2 or x = 3");
  await expect(block).toContainText("Not checked by the maths engine");
});

test("ink drawn over a photo is sent with the photo, so the reader sees what I marked", async ({ page }) => {
  await openClass(page);
  await page.locator('input[data-paper="work"]').setInputFiles("e2e/paper-working.jpg");
  const img = page.locator(".photo-page img");
  await expect(img).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".submission")).toHaveAttribute("data-state", "done", { timeout: 20_000 });
  const sent: { photoLabel?: string; png?: string; lineCount?: number }[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => typeof f.payload === "string" && f.payload.includes('"capture"') && sent.push(JSON.parse(f.payload))));
  await page.reload();
  await expect(img).toBeVisible({ timeout: 15_000 });
  await img.scrollIntoViewIfNeeded();
  const box = (await img.boundingBox())!;
  await scribble(page, box.x + box.width * 0.55, box.y + box.height * 0.4, 120);
  await page.locator("button.btn-done").click();
  await expect.poll(() => sent.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(sent[0].photoLabel).toMatch(/^B\d+$/);
  expect(sent[0].lineCount).toBe(0);
  expect(sent[0].png).toMatch(/^data:image\/jpeg;base64,/);
  await expect(page.locator(".submission")).toContainText("Simulated check", { timeout: 20_000 });
});

test("Type tool: typed steps go on the board as my lines and are checked like handwriting", async ({ page }) => {
  const id = await openClass(page);
  await tool(page, "next_problem", { session_code: id, problem_id: "quad.fact.01" });
  await page.getByRole("button", { name: "Type", exact: true }).click();
  const box = page.getByRole("textbox", { name: "Your working" });
  await box.fill("x² − 5x + 6 = 0\n(x − 2)(x − 3) = 0\n");
  await page.getByRole("button", { name: "Insert ∴" }).click();
  await box.press("End");
  await box.pressSequentially(" x = 2 or x = 3");
  await expect(page.getByText("3 lines")).toBeVisible();
  await page.getByRole("button", { name: "Put on the board" }).click();
  await expect(box).toHaveCount(0);
  // They're the student's own lines now: Done sends them, numbered, like handwriting.
  const sent: { lineCount?: number }[] = [];
  page.on("websocket", (ws) => ws.on("framesent", (f) => typeof f.payload === "string" && f.payload.includes('"capture"') && sent.push(JSON.parse(f.payload))));
  await page.reload();
  await expect(page.locator("canvas.board-ink")).toBeVisible();
  const done = page.locator("button.btn-done");
  await expect(done).toBeEnabled();
  await done.click();
  await expect.poll(() => sent[0]?.lineCount, { timeout: 10_000 }).toBe(3);
  await expect(page.locator(".submission")).toContainText("Simulated check", { timeout: 20_000 });
});

test("a graph with sliders: moving a slider redraws the curve and where it crosses the x-axis", async ({ page }) => {
  const id = await openClass(page);
  const r = await tool(page, "draw", { session_code: id, diagram: "graph: y = a x^2 + b x + c | params: a = 1 (-3..3), b = -1 (-6..6), c = -6 (-6..6) | x: -5..5", caption: "Move a, b and c" });
  expect(r.ok).toBe(true);
  const graph = page.locator(".editable-graph");
  await expect(graph).toBeVisible({ timeout: 10_000 });
  await expect(graph.locator(".graph-root")).toHaveCount(2);
  await expect(graph.locator(".graph-root text")).toHaveText(["−2", "3"]);
  // Drag c to the far right (under the ink layer, so it goes through the board).
  const c = graph.getByRole("slider", { name: "Change c" });
  await c.scrollIntoViewIfNeeded();
  const box = (await c.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(c).toHaveValue("6");
  // y = x² − x + 6 never touches the x-axis.
  await expect(graph.locator(".graph-root")).toHaveCount(0);
  await expect(graph.locator("text").filter({ hasText: /^y = / })).toHaveText(/^y = x² [−-] x \+ 6$/);
  await graph.getByRole("button", { name: "Reset" }).evaluate((b: HTMLButtonElement) => b.click());
  await expect(c).toHaveValue("-6");
});

test("download notes: the whole class prints as a PDF, board only, with my ink", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void ((window as unknown as { printed: number }).printed += 1);
  });
  await openClass(page);
  const at = (await page.locator("canvas.board-ink").boundingBox())!;
  await scribble(page, at.x + 80, at.y + 200, 160);
  await page.getByRole("button", { name: "Download notes as PDF" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await expect(page.locator(".print-ink")).not.toHaveCount(0);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".class-dock")).toBeHidden();
  await expect(page.locator(".print-ink").first()).toBeVisible();
});

test("session layout: start, the typing field and the mic at the bottom; the pen button hides the tools", async ({ page }) => {
  await openClass(page);
  const dock = page.locator(".class-dock");
  await expect(dock.getByRole("button", { name: /^(Start|Resume)$/ })).toBeVisible();
  await expect(dock.getByRole("textbox", { name: "Type a step" })).toBeVisible();
  await expect(dock.getByRole("button", { name: "Start talking" })).toBeVisible();
  // The tray starts open on a big screen and closed on a phone (so it doesn't cover the board).
  const tools = page.getByRole("toolbar", { name: "Board tools" });
  if (test.info().project.name === "phone") {
    await expect(tools).toBeHidden();
    await page.getByRole("button", { name: "Show the drawing tools" }).click();
  }
  await expect(tools).toBeVisible();
  await page.getByRole("button", { name: "Hide the drawing tools" }).click();
  await expect(page.getByRole("toolbar", { name: "Board tools" })).toBeHidden();
  await page.getByRole("button", { name: "Show the drawing tools" }).click();
  // One step typed in the bar goes on the board as my line.
  await dock.getByRole("textbox", { name: "Type a step" }).fill("x = 2");
  await page.keyboard.press("Enter");
  await expect(page.locator("button.btn-done")).toBeEnabled();
  // The + holds paper and books.
  await dock.getByRole("button", { name: "Add from paper or a book" }).click();
  await expect(page.getByRole("menuitem", { name: /Upload my book or notes/ })).toBeVisible();
});

test("start screen: Shikshak in the middle, Start Shiksha, then a new device makes its account", async ({ page }) => {
  // A tab from an older version still carries its old "seen" mark: the start screen shows anyway.
  await page.addInitScript(() => sessionStorage.setItem("shikshak.splashSeen", "1"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Shikshak" })).toBeVisible();
  await expect(page.getByText("Shikshak, your own tutor")).toBeVisible();
  await page.getByRole("button", { name: /Start Shiksha/ }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await page.getByLabel("Name or nickname").fill("Meera");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Meera's classes" })).toBeVisible();
  // Every time the site is opened or reloaded, the start screen comes first; Start goes to the classes.
  await page.reload();
  await expect(page.getByRole("button", { name: /Start Shiksha/ })).toBeVisible();
  await page.getByRole("button", { name: /Start Shiksha/ }).click();
  await expect(page.getByRole("heading", { name: "Meera's classes" })).toBeVisible();
});

test("hide the controls: just the board, and one button brings them back", async ({ page }) => {
  await openClass(page);
  await page.getByRole("button", { name: "Hide the controls" }).click();
  await expect(page.locator(".class-dock")).toBeHidden();
  await expect(page.locator(".class-pill")).toBeHidden();
  await expect(page.getByRole("toolbar", { name: "Board tools" })).toBeHidden();
  await page.getByRole("button", { name: "Show the controls" }).click();
  await expect(page.locator(".class-dock")).toBeVisible();
});

test("focus mode: pick a time from 30 minutes, and leaving the class gets a call back", async ({ page }) => {
  await openClass(page);
  await page.getByRole("button", { name: "Session menu" }).click();
  await page.getByRole("menuitem", { name: "Focus mode" }).click();
  await expect(page.getByRole("radio", { name: "30 min" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio")).toHaveCount(5);
  await page.getByRole("radio", { name: "45 min" }).click();
  await page.getByRole("button", { name: "Start focus" }).click();
  await expect(page.getByRole("timer")).toContainText(/4[45]:\d\d/);
  // Switching to another tab and back.
  const flip = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await flip(true);
  await flip(false);
  await expect(page.getByRole("alertdialog")).toContainText(/board|class|work/i);
  await expect(page.getByRole("timer")).toContainText("left 1×");
  await page.getByRole("button", { name: "I'm back" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  // It can be ended from the timer, or from the class menu.
  await page.getByRole("button", { name: "Session menu" }).click();
  await expect(page.getByRole("menuitem", { name: "End focus mode" })).toBeVisible();
  await page.keyboard.press("Escape");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "End focus mode" }).click();
  await expect(page.getByRole("timer")).toHaveCount(0);
});

test("study group: start one, a friend joins with the link, and opens my notes, reports and progress", async ({ browser }) => {
  const device = async (name: string) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      sessionStorage.setItem("shikshak.test.skipSplash", "1");
      localStorage.setItem("shikshak.tour.home.v1", "1");
      localStorage.setItem("shikshak.tour.class.v1", "1");
    });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "Add learner" }).click();
    await page.getByPlaceholder("Asha").fill(name);
    await page.getByRole("button", { name: /^(Add|Create account)$/ }).click();
    await expect(page.getByRole("button", { name: `Profile: ${name}` })).toBeVisible();
    return { ctx, page };
  };
  const asha = await device("Asha");
  // Asha has a class with something on the board.
  const id = await openClass(asha.page, "Quadratic equations");
  await tool(asha.page, "write", { session_code: id, style: "heading", lines: ["Roots of a quadratic"] });
  await asha.page.goto("/");
  await asha.page.getByRole("button", { name: /Study group/ }).click();
  await expect(asha.page.getByRole("heading", { name: "Study together" })).toBeVisible();
  await asha.page.getByRole("button", { name: /Start a group/ }).click();
  await expect(asha.page.getByRole("heading", { name: "Asha's study group" })).toBeVisible();
  await asha.page.getByRole("button", { name: "Invite" }).click();
  await expect(asha.page.getByRole("img", { name: "QR code to join" })).toBeVisible();
  const code = (await asha.page.locator(".group-code").innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  const ravi = await device("Ravi");
  await ravi.page.goto(`/#/join/${code}`);
  await expect(ravi.page.getByRole("heading", { name: "Join Asha's study group?" })).toBeVisible();
  await expect(ravi.page.getByText(/see your name.*notes.*reports.*progress/)).toBeVisible();
  await ravi.page.getByRole("button", { name: "Join as Ravi" }).click();
  await expect(ravi.page.getByRole("heading", { name: "Asha's study group" })).toBeVisible();
  await expect(ravi.page.locator(".group-member")).toHaveCount(2);
  await ravi.page.locator(".group-member", { hasText: "Asha" }).click();
  await expect(ravi.page.getByRole("heading", { name: "Asha's study" })).toBeVisible();
  await ravi.page.getByRole("button", { name: /Quadratic equations/ }).click();
  await expect(ravi.page.getByText("Roots of a quadratic")).toBeVisible();
  await ravi.page.getByRole("button", { name: /Back$/ }).first().click();
  await ravi.page.getByRole("tab", { name: /Reports/ }).click();
  await expect(ravi.page.locator(".group-report")).toHaveCount(1);
  await ravi.page.getByRole("tab", { name: /Progress/ }).click();
  await expect(ravi.page.getByText(/Nothing recorded yet/)).toBeVisible();

  // Ravi leaves; Asha's page shows just her.
  await ravi.page.getByRole("button", { name: /Back$/ }).first().click();
  ravi.page.once("dialog", (d) => d.accept());
  await ravi.page.getByRole("button", { name: "Leave" }).click();
  await expect(ravi.page.getByRole("heading", { name: "Study together" })).toBeVisible();
  await asha.ctx.close();
  await ravi.ctx.close();
});

test("study group: a friend on a new device makes their account right on the join screen", async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    sessionStorage.setItem("shikshak.test.skipSplash", "1");
    localStorage.setItem("shikshak.tour.home.v1", "1");
    localStorage.setItem("shikshak.tour.class.v1", "1");
  });
  const host = await ctx.newPage();
  // Starting a group with no profile asks for the account first, then starts it.
  await host.goto("/#/group");
  await host.getByRole("button", { name: /Start a group/ }).click();
  await host.getByLabel("Name or nickname").fill("Asha");
  await host.getByRole("button", { name: "Create account and start" }).click();
  await expect(host.getByRole("heading", { name: "Asha's study group" })).toBeVisible();
  await host.getByRole("button", { name: "Invite" }).click();
  const code = (await host.locator(".group-code").innerText()).trim();

  const other = await browser.newContext();
  const friend = await other.newPage();
  await friend.goto(`/#/join/${code}`);
  await expect(friend.getByRole("heading", { name: "Join Asha's study group?" })).toBeVisible();
  await friend.getByLabel("Name or nickname").fill("Ravi");
  await friend.getByRole("button", { name: "Create account and join" }).click();
  await expect(friend.getByRole("heading", { name: "Asha's study group" })).toBeVisible();
  await expect(friend.locator(".group-member")).toHaveCount(2);
  await ctx.close();
  await other.close();
});

test("classes belong to an account: a class with no account is cleared, the account's own stay", async ({ page }) => {
  await page.goto("/");
  // A class left on the device from before (no account), like after the server was reset.
  await page.evaluate(() => {
    const t = Date.now();
    const stray = { id: "OLD123", name: "Old class", studentName: "", grade: "10", language: "hinglish", topic: "Old class", createdAt: t, updatedAt: t, archived: false, started: false, learnerId: null };
    localStorage.setItem("shikshak.sessions", JSON.stringify([stray]));
  });
  await page.reload();
  // No account: making one comes first, and there's no way round it.
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await ensureAccount(page, "Harsh");
  await expect(page.getByText("Old class")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("shikshak.sessions") ?? "")).not.toContain("OLD123");
  // A class made by this account stays after a reload.
  await page.getByRole("button", { name: /New session/ }).first().click();
  await page.getByPlaceholder("e.g. Quadratic equations").fill("Arithmetic progressions");
  await page.getByRole("button", { name: "Create session" }).click();
  await expect(page.locator("canvas.board-ink")).toBeVisible({ timeout: 20_000 });
  await page.goto("/");
  await expect(page.getByText("Arithmetic progressions").first()).toBeVisible();
});

test("no wrong screen flashes: account first on a new device, and a group page never shows the start page", async ({ page }) => {
  // Every heading the page ever shows, in order (even for one frame), with a slow server.
  await page.addInitScript(() => {
    const w = window as unknown as { __seen: string[] };
    w.__seen = [];
    const look = () => {
      for (const h of document.querySelectorAll("h1, h2")) {
        const t = (h.textContent || "").trim();
        if (t && w.__seen.at(-1) !== t) w.__seen.push(t);
      }
    };
    new MutationObserver(look).observe(document, { subtree: true, childList: true, characterData: true });
  });
  await page.route("**/api/**", async (r) => {
    await new Promise((x) => setTimeout(x, 500));
    await r.continue();
  });
  const seen = () => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  await page.goto("/");
  await page.getByLabel("Name or nickname").fill("Harsh");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Harsh's classes" })).toBeVisible();
  expect(await seen()).not.toContain("Your classes");
  await page.goto("/#/group");
  await page.getByRole("button", { name: /Start a group/ }).click();
  await expect(page.getByRole("heading", { name: "Harsh's study group" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Harsh's study group" })).toBeVisible();
  expect(await seen()).not.toContain("Study together");
});

test("the board keeps everything the tutor corrects, and rubs out only what the student asks her to erase", async ({ page }) => {
  const id = await openClass(page);
  const written = await tool(page, "write", { session_code: id, style: "heading", lines: ["First idea"] });
  const label = written.label as string;
  expect(label).toMatch(/^B\d+$/);
  const first = page.locator(".tblock", { hasText: "First idea" });
  await expect(first).toBeVisible();
  // A correction goes below and the old line stays.
  await tool(page, "write", { session_code: id, style: "heading", lines: ["Second idea"], replace: label });
  const second = page.locator(".tblock", { hasText: "Second idea" });
  await expect(second).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(first).toBeVisible();
  expect(await first.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  const [a, b] = [(await first.boundingBox())!, (await second.boundingBox())!];
  expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  // "Isse mita do": the erase really rubs it off the board.
  const rubbed = await tool(page, "erase", { session_code: id, target: label });
  expect(rubbed.ok).toBe(true);
  await expect(first).toBeHidden();
  await expect(second).toBeVisible();
});


test("the board never ends: scrolling to the bottom adds more blank board", async ({ page }) => {
  await openClass(page);
  const scroller = page.locator(".board-scroll");
  const before = await scroller.evaluate((el) => el.scrollHeight);
  for (let i = 0; i < 3; i++) {
    await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.waitForTimeout(150);
  }
  const after = await scroller.evaluate((el) => el.scrollHeight);
  expect(after).toBeGreaterThan(before + 2 * (await scroller.evaluate((el) => el.clientHeight)) - 10);
});

test("study group: after joining, My classes takes you to your own classes", async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    sessionStorage.setItem("shikshak.test.skipSplash", "1");
    localStorage.setItem("shikshak.tour.home.v1", "1");
  });
  const host = await ctx.newPage();
  await host.goto("/#/group");
  await host.getByRole("button", { name: /Start a group/ }).click();
  await host.getByLabel("Name or nickname").fill("Asha");
  await host.getByRole("button", { name: "Create account and start" }).click();
  await host.getByRole("button", { name: "Invite" }).click();
  const code = (await host.locator(".group-code").innerText()).trim();
  const other = await browser.newContext();
  await other.addInitScript(() => localStorage.setItem("shikshak.tour.home.v1", "1"));
  const friend = await other.newPage();
  await friend.goto(`/#/join/${code}`);
  await friend.getByLabel("Name or nickname").fill("Ravi");
  await friend.getByRole("button", { name: "Create account and join" }).click();
  await expect(friend.getByRole("heading", { name: "Asha's study group" })).toBeVisible();
  await friend.getByRole("button", { name: "My classes" }).click();
  await expect(friend.getByRole("heading", { name: "Ravi's classes" })).toBeVisible();
  await expect(friend.getByRole("heading", { name: "Who's learning?" })).toHaveCount(0);
  await expect(friend.getByRole("button", { name: /New session/ }).first()).toBeEnabled();
  await ctx.close();
  await other.close();
});

// Exams: a 1x1 PNG stands in for a photo of an answer sheet.
const SHEET = { name: "page1.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") };

test("mock exam: a board-style paper to read and download, then marked like a board exam, then a class on it", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void ((window as unknown as { printed: number }).printed += 1);
  });
  await page.goto("/");
  await ensureAccount(page);
  await page.getByRole("button", { name: /Exam/ }).first().click();
  await expect(page.getByRole("heading", { name: "Exams" })).toBeVisible();
  await page.getByRole("button", { name: "Quadratic equations" }).click();
  await page.getByRole("radio", { name: "5", exact: true }).click();
  await page.getByRole("radio", { name: "30 min", exact: true }).click();
  await page.getByRole("radio", { name: /Mock exam/ }).click();
  await page.getByRole("button", { name: /Make my paper/ }).click();
  const paper = page.getByRole("article", { name: "Question paper" });
  await expect(paper).toBeVisible({ timeout: 15_000 });
  await expect(paper).toContainText("Time allowed: 30 min");
  await expect(paper).toContainText("Maximum Marks: 15");
  for (const sec of ["SECTION A", "SECTION B", "SECTION C", "SECTION D", "SECTION E"]) await expect(paper).toContainText(sec);
  await page.getByRole("button", { name: /Download PDF/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  // Answer sheets, marked.
  await page.getByRole("button", { name: /Upload my answers/ }).click();
  await page.locator('input[data-exam="answers"]').setInputFiles([SHEET, { ...SHEET, name: "page2.png" }]);
  await expect(page.getByRole("img", { name: "Page 2" })).toBeVisible();
  await page.getByRole("button", { name: /Mark my 2 pages/ }).click();
  await expect(page.getByRole("heading", { name: "Your marks" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Practice marks from Shikshak, not official marks.")).toBeVisible();
  await expect(page.getByText("Neatness")).toBeVisible();
  await expect(page.locator(".exam-qmarks > li")).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "Invigilator's report" })).toHaveCount(0);
  // Learn from it with the tutor: a class opens with the weakest question on the board.
  await page.getByRole("button", { name: /Learn from this with the tutor/ }).click();
  await expect(page.locator("canvas.board-ink")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".tblock-problem")).toBeVisible({ timeout: 10_000 });
});

test("exam with an invigilator: questions hidden until start, camera and whole screen needed, what it notices is in the report", async ({ page }) => {
  // Test browsers have no camera or screen to share: stand-ins that behave like the real thing.
  await page.addInitScript(() => {
    const fake = (surface?: string) => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 48;
      c.getContext("2d")!.fillRect(0, 0, 64, 48);
      const stream = c.captureStream(5);
      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings.bind(track);
      track.getSettings = () => ({ ...settings(), ...(surface ? { displaySurface: surface } : {}) });
      (window as unknown as { tracks: MediaStreamTrack[] }).tracks ??= [];
      (window as unknown as { tracks: MediaStreamTrack[] }).tracks.push(track);
      return stream;
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => fake(), getDisplayMedia: async () => fake("monitor") },
    });
  });
  await page.goto("/");
  await ensureAccount(page);
  await page.goto("/#/exam");
  await page.getByPlaceholder("e.g. Quadratic equations").fill("Triangles");
  await page.getByRole("radio", { name: "5", exact: true }).click();
  await page.getByRole("radio", { name: /^Exam/ }).click();
  await page.getByRole("button", { name: /Make my paper/ }).click();
  await expect(page.getByText("The questions appear when you start the exam.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Download PDF/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Start exam/ }).click();
  const start = page.getByRole("button", { name: "Start the exam" });
  await expect(start).toBeDisabled();
  await page.getByRole("button", { name: "Turn on camera" }).click();
  await page.getByRole("button", { name: "Share screen" }).click();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByRole("timer", { name: "Time left" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Question paper" })).toContainText("SECTION A");
  await expect(page.getByText("The questions appear when you start the exam.")).toHaveCount(0);
  // Leaving the screen: the invigilator calls it out, out loud (her recorded voice) and on screen.
  const clips: string[] = [];
  page.on("request", (r) => r.url().includes("/tour/") && clips.push(r.url()));
  const hide = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await hide(true);
  await expect.poll(() => clips.length).toBeGreaterThan(0);
  await hide(false);
  const warning = page.getByRole("alertdialog");
  await expect(warning).toContainText("Warning 1");
  await expect(warning).toContainText("Eyes on your paper");
  await expect(warning).toContainText("Switching screens isn't allowed");
  await page.getByRole("button", { name: "Back to my paper" }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByText("Invigilator on · 1 warning")).toBeVisible();
  // Stopping the screen share: called out, and it can be shared again from the warning.
  await page.evaluate(() => {
    const share = (window as unknown as { tracks: MediaStreamTrack[] }).tracks[1];
    share.stop();
    share.onended?.(new Event("ended"));
  });
  await expect(warning).toContainText("Screen sharing stopped");
  await page.getByRole("button", { name: "Share screen again" }).click();
  await expect(warning).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "I've finished" }).click();
  await page.locator('input[data-exam="answers"]').setInputFiles(SHEET);
  await page.getByRole("button", { name: /Mark my/ }).click();
  await expect(page.getByRole("heading", { name: "Your marks" })).toBeVisible({ timeout: 15_000 });
  const report = page.locator(".exam-panel", { has: page.getByRole("heading", { name: "Invigilator's report" }) });
  await expect(report).toContainText("Left the exam tab or app");
  await expect(report).toContainText("Stopped sharing the screen");
});

test("guided tour: the first visit walks through the controls, once, and can be replayed", async ({ page }) => {
  const clips: string[] = [];
  page.on("request", (r) => r.url().includes("/tour/") && clips.push(r.url()));
  await page.goto("/");
  await ensureAccount(page);
  const bubble = page.locator(".tour-bubble");
  await expect(bubble).toContainText("Namaste", { timeout: 5000 });
  await page.getByRole("button", { name: "Next" }).click();
  await expect(bubble).toContainText("Start a class");
  // Each step asks for its recorded clip; a missing clip is just silence. The voice can be muted.
  await expect.poll(() => clips.some((u) => /\/tour\/tour-[0-9a-f]{8}\.mp3$/.test(u))).toBe(true);
  const mute = page.getByRole("button", { name: "Mute the teacher's voice" });
  await mute.click();
  await expect(page.getByRole("button", { name: "Turn the teacher's voice on" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Turn the teacher's voice on" }).click();
  await expect(page.locator(".tour-spot")).toBeVisible();
  await page.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.locator(".tour")).toHaveCount(0);
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.locator(".tour")).toHaveCount(0);
  // The first class has its own tour, ending with how a class goes.
  await ensureAccount(page);
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

test("ink on the tutor's own line: Done sends which line was marked, so the reader knows what was circled", async ({ page }) => {
  await page.addInitScript(() => {
    const sent: string[] = [];
    (window as unknown as { __sent: string[] }).__sent = sent;
    const orig = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") sent.push(data);
      return orig.call(this, data);
    };
  });
  const id = await openClass(page, "Trigonometry");
  await tool(page, "write", { session_code: id, kind: "steps", content: "sin A = BC/AC || cos A = AB/AC" });
  const line = page.locator(".tblock [data-line='2']", { hasText: "cos A = AB/AC" });
  await expect(line).toHaveClass(/chalk-write/, { timeout: 15_000 });
  const b = (await line.boundingBox())!;
  await scribble(page, b.x + 4, b.y + b.height / 2, Math.min(160, b.width - 8));
  await page.getByRole("button", { name: "Done" }).click();
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __sent: string[] }).__sent.filter((m) => m.includes('"capture"') && m.includes('"done"'))))
    .toHaveLength(1);
  const msg = JSON.parse(await page.evaluate(() => (window as unknown as { __sent: string[] }).__sent.find((m) => m.includes('"capture"') && m.includes('"done"'))!));
  expect(msg.marked).toEqual([expect.objectContaining({ line: 2, text: expect.stringContaining("cos A") })]);
});

for (const [name, w, h] of [["iPad portrait", 820, 1050], ["iPad landscape", 1180, 700], ["iPad mini", 744, 1000], ["iPad Pro 13", 1024, 1250]] as const) {
  test(`${name}: every main screen fits the width (no sideways scroll)`, async ({ browser }, info) => {
    test.skip(info.project.name !== "desktop");
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => {
      sessionStorage.setItem("shikshak.test.skipSplash", "1");
      for (const k of ["shikshak.tour.home.v1", "shikshak.tour.class.v1"]) localStorage.setItem(k, "1");
    });
    const page = await ctx.newPage();
    const fits = async (where: string) => {
      const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(sw, where).toBeLessThanOrEqual(cw);
    };
    await openClass(page, "Trigonometry");
    await fits("class");
    for (const hash of ["", "#/exam", "#/progress", "#/group"]) {
      await page.goto(`/${hash}`);
      await page.waitForTimeout(500);
      await fits(hash || "home");
    }
    await ctx.close();
  });
}

test("a flick with the scroll tool keeps the board gliding after you let go, like an iPad page", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  const id = await openClass(page);
  for (let i = 0; i < 6; i++) await tool(page, "write", { session_code: id, kind: "steps", content: "line one || line two || line three || line four" });
  await page.getByRole("button", { name: "Scroll" }).click();
  const scroller = page.locator(".board-scroll");
  const box = (await page.locator("canvas.board-ink").boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height * 0.8);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x, box.y + box.height * 0.8 - i * 40);
  await page.mouse.up();
  const atRelease = await scroller.evaluate((el) => el.scrollTop);
  await page.waitForTimeout(400);
  expect(await scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(atRelease + 20);
});
