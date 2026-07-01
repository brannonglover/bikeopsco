export function encodeSseEvent(event: string, data: unknown, id?: string): string {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  lines.push("");
  return lines.join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PollingSseOptions<T> = {
  pollIntervalMs?: number;
  maxConnectionMs?: number;
  signal?: AbortSignal;
  getFingerprint: () => Promise<string>;
  getPayload: () => Promise<T>;
};

export function createPollingSseResponse<T>(options: PollingSseOptions<T>): Response {
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const maxConnectionMs = options.maxConnectionMs ?? 55_000;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastFingerprint = "";
      const startedAt = Date.now();

      const closeStream = () => {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      const abortHandler = () => closeStream();
      options.signal?.addEventListener("abort", abortHandler);

      try {
        const initialPayload = await options.getPayload();
        lastFingerprint = await options.getFingerprint();
        controller.enqueue(encoder.encode(encodeSseEvent("update", initialPayload)));

        while (Date.now() - startedAt < maxConnectionMs) {
          if (options.signal?.aborted) break;

          await sleep(pollIntervalMs);
          if (options.signal?.aborted) break;

          const fingerprint = await options.getFingerprint();
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            const payload = await options.getPayload();
            controller.enqueue(encoder.encode(encodeSseEvent("update", payload)));
          } else {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          }
        }
      } catch (error) {
        console.error("[sse] stream error:", error);
        controller.enqueue(
          encoder.encode(
            encodeSseEvent("error", {
              message: error instanceof Error ? error.message : "stream_error",
            })
          )
        );
      } finally {
        options.signal?.removeEventListener("abort", abortHandler);
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
