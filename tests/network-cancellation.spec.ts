import { expect, test } from "@playwright/test";
import {
  abortableFetch,
  abortNetworkRequests,
} from "@/lib/network-abort";
import {
  getServiceUnavailableSnapshot,
  recordServiceResponse,
} from "@/lib/service-health";

test("keeps a request abortable until its response body finishes", async () => {
  const originalFetch = globalThis.fetch;
  let abortObserved = false;
  globalThis.fetch = async (_input, init) => {
    const signal = init?.signal;
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        signal?.addEventListener("abort", () => {
          abortObserved = true;
          controller.error(signal.reason);
        }, { once: true });
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await abortableFetch("http://lanflow.test/slow-body");
    const bodyPromise = response.text();
    await new Promise((resolve) => setTimeout(resolve, 0));
    abortNetworkRequests();

    await expect(bodyPromise).rejects.toMatchObject({ name: "AbortError" });
    expect(abortObserved).toBe(true);
  } finally {
    recordServiceResponse("http://lanflow.test/broken-body", 200);
    globalThis.fetch = originalFetch;
  }
});

test("preserves a successful null-body response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 204 });

  try {
    const response = await abortableFetch("http://lanflow.test/no-content", {
      method: "POST",
    });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("marks the service unavailable when an online response body fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalOnLine = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => true,
  });
  globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new TypeError("stream terminated"));
    },
  }), { status: 200 });

  try {
    const response = await abortableFetch("http://lanflow.test/broken-body");
    await expect(response.text()).rejects.toThrow("stream terminated");
    expect(getServiceUnavailableSnapshot()).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalOnLine) {
      Object.defineProperty(navigator, "onLine", originalOnLine);
    } else {
      Reflect.deleteProperty(navigator, "onLine");
    }
  }
});

test.describe("offline network cancellation", () => {
  test.use({ storageState: "playwright/.auth/super_admin.json" });

  test("aborts an in-flight Dashboard query on the app offline transition", async ({
    page,
  }) => {
    let requestStarted = false;
    let requestAborted = false;
    let releaseRequest!: () => void;
    const requestBlocked = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });

    page.on("requestfailed", (request) => {
      if (request.url().includes("/api/lanflow/dashboard/snapshot")) {
        requestAborted = true;
      }
    });
    await page.route("**/api/lanflow/dashboard/snapshot?**", async (route) => {
      requestStarted = true;
      await requestBlocked;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          locationId: "held-request",
          status: "idle",
          summary: null,
        }),
      }).catch(() => {});
    });

    try {
      await page.goto("/");
      await expect(page.getByText("ออนไลน์", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect.poll(() => requestStarted).toBe(true);

      await page.evaluate(() => {
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          get: () => false,
        });
        window.dispatchEvent(new Event("offline"));
      });

      await expect(page.getByText("ไม่มีอินเทอร์เน็ต", { exact: true })).toBeVisible();
      await expect.poll(() => requestAborted, { timeout: 2_000 }).toBe(true);
    } finally {
      releaseRequest();
      await page.evaluate(() => {
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          get: () => true,
        });
        window.dispatchEvent(new Event("online"));
      }).catch(() => {});
    }
  });

  test("does not show an error toast when an action is cancelled by going offline", async ({
    page,
  }) => {
    let refreshStarted = false;
    let releaseRefresh!: () => void;
    const refreshBlocked = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    await page.route("**/api/lanflow/dashboard/refresh", async (route) => {
      refreshStarted = true;
      await refreshBlocked;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "queued" }),
      }).catch(() => {});
    });

    try {
      await page.goto("/");
      const refreshButton = page.getByRole("button", {
        name: "คำนวณสาขานี้ใหม่",
        exact: true,
      });
      await expect(refreshButton).toBeVisible({ timeout: 15_000 });
      await refreshButton.click();
      await expect.poll(() => refreshStarted).toBe(true);

      await page.evaluate(() => {
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          get: () => false,
        });
        window.dispatchEvent(new Event("offline"));
      });

      await expect(page.getByText("ไม่มีอินเทอร์เน็ต", { exact: true })).toBeVisible();
      await expect(page.getByText("Device went offline", { exact: true })).toHaveCount(0);
    } finally {
      releaseRefresh();
      await page.evaluate(() => {
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          get: () => true,
        });
      }).catch(() => {});
    }
  });
});
