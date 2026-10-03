import { existsSync } from "node:fs";
import type { SummonSpec } from "@lfg/shared";

/**
 * Renders designs the way players will see them, for agents to look at while they iterate
 * (render_design): the model viewer page in headless Chromium, six views plus the check report,
 * in a world's colours and model style. Optional: without playwright-core and a Chromium the
 * tool says so, and checks still work.
 */
type Browser = { newPage(o: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void> };
type Page = {
  goto(url: string): Promise<unknown>;
  waitForFunction(fn: string, arg: unknown, o: { timeout: number }): Promise<unknown>;
  evaluate<T>(fn: string): Promise<T>;
  screenshot(o: { type: "jpeg"; quality: number }): Promise<Buffer>;
  on(ev: "pageerror", fn: (e: Error) => void): void;
  close(): Promise<void>;
};

const CANDIDATES = [process.env.CHROMIUM, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].filter(Boolean) as string[];

export class DesignRenderer {
  private browser: Promise<Browser> | null = null;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private baseUrl: string) {}

  private launch(): Promise<Browser> {
    this.browser ??= (async () => {
      const pw = (await import("playwright-core").catch(() => null)) as { chromium: { launch(o: object): Promise<Browser> } } | null;
      if (!pw) throw new Error("rendering isn't available on this server (no playwright-core)");
      const executablePath = CANDIDATES.find((p) => existsSync(p));
      return pw.chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
      });
    })();
    this.browser.catch(() => { this.browser = null; });
    return this.browser;
  }

  /** One JPEG (six views and the report) and the viewer's own check results. Renders one at a time. */
  render(spec: SummonSpec, rules: [string, number | boolean | string][], style?: string, pose?: number): Promise<{ jpeg: Buffer; report: unknown }> {
    const job = this.busy.then(async () => {
      const browser = await this.launch();
      const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
        const hash = new URLSearchParams({ spec: b64(spec), rules: b64(rules), ...(style ? { style } : {}), ...(pose ? { t: String(pose) } : {}) });
        await page.goto(`${this.baseUrl}/viewer.html#${hash}`);
        await page.waitForFunction("window.viewerReady === true || document.getElementById('report')?.textContent?.length > 0", null, { timeout: 30000 });
        await page.waitForFunction("window.viewerReady === true", null, { timeout: 5000 }).catch(() => {});
        if (errors.length) throw new Error(`the viewer failed: ${errors.join("; ")}`);
        const report = await page.evaluate<unknown>("window.viewerReport ?? null");
        return { jpeg: await page.screenshot({ type: "jpeg", quality: 80 }), report };
      } finally {
        await page.close();
      }
    });
    this.busy = job.catch(() => {});
    return job;
  }

  async close(): Promise<void> {
    const b = await this.browser?.catch(() => null);
    await b?.close();
  }
}
