import { isDeviceOnline } from "@/lib/connectivity";
import {
  recordServiceFailure,
  recordServiceResponse,
} from "@/lib/service-health";

const activeNetworkControllers = new Set<AbortController>();

export function isNetworkCancellation(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function abortNetworkRequests() {
  for (const controller of activeNetworkControllers) {
    controller.abort(new DOMException("Device went offline", "AbortError"));
  }
  activeNetworkControllers.clear();
}

export async function abortableFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  const controller = new AbortController();
  const sourceSignal = init.signal;
  const forwardAbort = () => {
    controller.abort(sourceSignal?.reason);
  };

  if (sourceSignal?.aborted) {
    forwardAbort();
  } else {
    sourceSignal?.addEventListener("abort", forwardAbort, { once: true });
  }
  activeNetworkControllers.add(controller);

  const release = () => {
    activeNetworkControllers.delete(controller);
    sourceSignal?.removeEventListener("abort", forwardAbort);
  };

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    recordServiceResponse(input, response.status);
    if (
      !response.body
      || response.status === 204
      || response.status === 205
      || response.status === 304
      || init.method?.toUpperCase() === "HEAD"
    ) {
      release();
      return response;
    }

    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const result = await reader.read();
          if (result.done) {
            release();
            streamController.close();
          } else {
            streamController.enqueue(result.value);
          }
        } catch (error) {
          release();
          if (isDeviceOnline() && !isNetworkCancellation(error)) {
            recordServiceFailure(input);
          }
          streamController.error(error);
        }
      },
      async cancel(reason) {
        release();
        await reader.cancel(reason);
      },
    });
    const trackedResponse = new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });

    return new Proxy(trackedResponse, {
      get(target, property) {
        if (property === "url" || property === "redirected" || property === "type") {
          return response[property];
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  } catch (error) {
    release();
    if (isDeviceOnline() && !isNetworkCancellation(error)) {
      recordServiceFailure(input);
    }
    throw error;
  }
}
