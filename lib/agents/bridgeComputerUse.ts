import { chromium, type Browser, type Page } from "playwright";
import { getAnthropicClient } from "@/lib/anthropic";

// Computer-use tool support is tied to specific dated model snapshots, not
// every model alias — claude-sonnet-4-5-20250929 supports computer_20250124;
// the plain "claude-sonnet-4-6" alias used elsewhere in this app does not.
const COMPUTER_USE_MODEL = "claude-sonnet-4-5-20250929";

// Bridge Agent's computer-use step: Claude looks at real screenshots of a
// live browser and drives mouse/keyboard to find an open teletherapy slot
// and pre-fill the booking form — then stops. It is instructed, and this
// code independently guarantees, that it never clicks the final "Request
// booking" button. That click only ever happens in confirmSession(), which
// is only reachable after Guardian records a human approval.

const DISPLAY_WIDTH = 1024;
const DISPLAY_HEIGHT = 768;
const MAX_ITERATIONS = 12;
const COMPUTER_USE_BETA = "computer-use-2025-01-24";

type LiveSession = { browser: Browser; page: Page };
const sessions = new Map<string, LiveSession>();

export type ComputerUseStep = { iteration: number; action: string; detail?: string };

export type BridgeDraft = {
  actionId: string;
  selectedSlotLabel: string | null;
  nameFilled: string | null;
  screenshotBase64: string;
  steps: ComputerUseStep[];
  usedLiveModel: boolean;
  modelNote?: string;
};

function systemPrompt(userFirstName: string): string {
  return `You are operating a real web browser via screenshots to book a teletherapy appointment on behalf of a user named ${userFirstName}.

Steps:
1. Take a screenshot to see the current page.
2. Click the radio button for the EARLIEST available appointment slot (top of the list).
3. Click the "Full name" text field and type exactly: ${userFirstName}
4. Take a screenshot to confirm the slot is selected and the name field is filled.
5. Stop there. Send a final plain-text message (no more tool calls) summarizing which slot you selected and confirming the name is filled in.

Hard rule: never click the "Request booking" button, no matter what. That confirmation step is reserved for a human to click themselves. If you accidentally start to, stop immediately instead.`;
}

async function screenshotBase64(page: Page): Promise<string> {
  const buf = await page.screenshot({ type: "png" });
  return buf.toString("base64");
}

function mapKey(text: string): string {
  const map: Record<string, string> = {
    Return: "Enter",
    Escape: "Escape",
    Tab: "Tab",
    BackSpace: "Backspace",
    Delete: "Delete",
  };
  return map[text] ?? text;
}

async function executeAction(page: Page, input: Record<string, unknown>): Promise<void> {
  const action = input.action as string;
  const coordinate = input.coordinate as [number, number] | undefined;
  switch (action) {
    case "left_click":
    case "left_click_drag":
      if (coordinate) await page.mouse.click(coordinate[0], coordinate[1]);
      break;
    case "double_click":
      if (coordinate) await page.mouse.dblclick(coordinate[0], coordinate[1]);
      break;
    case "right_click":
      if (coordinate) await page.mouse.click(coordinate[0], coordinate[1], { button: "right" });
      break;
    case "mouse_move":
      if (coordinate) await page.mouse.move(coordinate[0], coordinate[1]);
      break;
    case "type":
      if (typeof input.text === "string") await page.keyboard.type(input.text, { delay: 15 });
      break;
    case "key":
      if (typeof input.text === "string") {
        for (const part of input.text.split("+")) await page.keyboard.down(mapKey(part));
        for (const part of input.text.split("+").reverse()) await page.keyboard.up(mapKey(part));
      }
      break;
    case "scroll": {
      const amount = (Number(input.scroll_amount) || 3) * 60;
      const dir = input.scroll_direction as string;
      const dx = dir === "left" ? -amount : dir === "right" ? amount : 0;
      const dy = dir === "up" ? -amount : dir === "down" ? amount : 0;
      if (coordinate) await page.mouse.move(coordinate[0], coordinate[1]);
      await page.mouse.wheel(dx, dy);
      break;
    }
    case "wait":
      await page.waitForTimeout(Math.min((Number(input.duration) || 1) * 1000, 3000));
      break;
    case "screenshot":
    case "cursor_position":
    default:
      break; // no-op; a fresh screenshot is taken after every step regardless
  }
}

async function scriptedFallback(page: Page, userFirstName: string, note: string): Promise<BridgeDraft> {
  await page.getByTestId("slot-card-slot-1").click();
  await page.getByTestId("full-name-input").fill(userFirstName);
  const screenshot = await screenshotBase64(page);
  return {
    actionId: "",
    selectedSlotLabel: "Dr. Renata Osei, LMFT — Tomorrow 10:00 AM",
    nameFilled: userFirstName,
    screenshotBase64: screenshot,
    steps: [{ iteration: 0, action: "scripted_fallback", detail: note }],
    usedLiveModel: false,
    modelNote: note,
  };
}

async function readFormState(page: Page): Promise<{ selectedSlotLabel: string | null; nameFilled: string | null }> {
  const selectedSlotLabel = await page
    .evaluate(() => {
      const checked = document.querySelector('input[name="slot"]:checked') as HTMLInputElement | null;
      const label = checked?.closest("label");
      return label ? label.textContent?.replace(/\s+/g, " ").trim() ?? null : null;
    })
    .catch(() => null);
  const nameFilled = await page.getByTestId("full-name-input").inputValue().catch(() => "");
  return { selectedSlotLabel, nameFilled: nameFilled || null };
}

/**
 * Launches a real (headed by default) Chromium browser, navigates to the
 * mock teletherapy scheduler, and lets Claude drive it via the computer-use
 * tool from real screenshots. The browser is kept open (keyed by actionId)
 * so a later human-approved confirmSession() can click the real "Request
 * booking" button in the same live page.
 */
export async function findAndPrefillSession(actionId: string, userFirstName: string, baseUrl: string): Promise<BridgeDraft> {
  const browser = await chromium.launch({ headless: process.env.BRIDGE_HEADLESS === "true" });
  const context = await browser.newContext({ viewport: { width: DISPLAY_WIDTH, height: DISPLAY_HEIGHT } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/mock-teletherapy`, { waitUntil: "networkidle" });

  const client = getAnthropicClient();
  if (!client) {
    const draft = await scriptedFallback(page, userFirstName, "ANTHROPIC_API_KEY not set — used a scripted fallback instead of live computer-use.");
    sessions.set(actionId, { browser, page });
    return { ...draft, actionId };
  }

  const steps: ComputerUseStep[] = [];
  type ContentBlock = Record<string, unknown>;
  type Msg = { role: "user" | "assistant"; content: string | ContentBlock[] };
  const messages: Msg[] = [
    { role: "user", content: `Book an appointment for ${userFirstName}. Start by taking a screenshot.` },
  ];

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await client.beta.messages.create({
        model: COMPUTER_USE_MODEL,
        max_tokens: 1024,
        betas: [COMPUTER_USE_BETA],
        system: systemPrompt(userFirstName),
        tools: [
          { type: "computer_20250124", name: "computer", display_width_px: DISPLAY_WIDTH, display_height_px: DISPLAY_HEIGHT },
        ],
        messages: messages as never,
      });

      messages.push({ role: "assistant", content: response.content as unknown as ContentBlock[] });

      const toolUses = response.content.filter((b) => b.type === "tool_use");
      if (toolUses.length === 0) break;

      const toolResults: ContentBlock[] = [];
      for (const toolUse of toolUses) {
        const tu = toolUse as unknown as { id: string; input: Record<string, unknown> };
        const input = tu.input;
        steps.push({ iteration: i, action: String(input.action ?? "unknown"), detail: JSON.stringify(input).slice(0, 200) });

        // Hard safety net: independently refuse to ever click the confirm
        // button, regardless of what the model decides to do.
        const clickedConfirm = await page
          .evaluate((coord: [number, number] | undefined) => {
            if (!coord) return false;
            const el = document.elementFromPoint(coord[0], coord[1]);
            return Boolean(el?.closest('[data-testid="request-booking-button"]'));
          }, input.coordinate as [number, number] | undefined)
          .catch(() => false);

        if (!clickedConfirm) {
          await executeAction(page, input);
        }
        await page.waitForTimeout(150);

        const screenshot = await screenshotBase64(page);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: screenshot } }],
        });
      }
      messages.push({ role: "user", content: toolResults });

      if (response.stop_reason !== "tool_use") break;
    }
  } catch (err) {
    const draft = await scriptedFallback(page, userFirstName, `Live computer-use call failed (${(err as Error).message}); fell back to a scripted selection.`);
    sessions.set(actionId, { browser, page });
    return { ...draft, actionId };
  }

  const { selectedSlotLabel, nameFilled } = await readFormState(page);
  const screenshot = await screenshotBase64(page);
  sessions.set(actionId, { browser, page });

  return { actionId, selectedSlotLabel, nameFilled, screenshotBase64: screenshot, steps, usedLiveModel: true };
}

export function hasLiveSession(actionId: string): boolean {
  return sessions.has(actionId);
}

export async function confirmSession(actionId: string): Promise<{ confirmed: boolean; screenshotBase64: string }> {
  const session = sessions.get(actionId);
  if (!session) throw new Error(`No live Bridge browser session for action ${actionId} (already closed, or the dev server restarted — cancel and retry from the ladder buttons).`);
  const { browser, page } = session;

  try {
    await page.getByTestId("request-booking-button").click({ timeout: 10000 });
    await page.waitForSelector('[data-testid="booking-confirmed"]', { timeout: 5000 }).catch(() => null);
    const screenshot = await screenshotBase64(page);

    await browser.close();
    sessions.delete(actionId);
    return { confirmed: true, screenshotBase64: screenshot };
  } catch (err) {
    // Keep the session alive so a retry (or cancel) is still possible —
    // this is a transient browser/page failure, not a decision to revert.
    throw new Error(`Could not click "Request booking" in the live browser session: ${(err as Error).message}`);
  }
}

export async function discardSession(actionId: string): Promise<void> {
  const session = sessions.get(actionId);
  if (session) {
    await session.browser.close();
    sessions.delete(actionId);
  }
}
