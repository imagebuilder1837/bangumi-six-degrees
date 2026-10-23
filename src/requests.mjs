export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const until = Date.now() + ms;
    let timer;
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const wake = () => {
      const remaining = until - Date.now();
      if (remaining > 0)
        timer = setTimeout(wake, Math.min(remaining, 2147483647));
      else {
        signal?.removeEventListener("abort", abort);
        resolve();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    wake();
  });
}
class RequestError extends Error {
  constructor(message, retryable = false) {
    super(message);
    this.retryable = retryable;
  }
}
function retryAt(value, now) {
  if (typeof value !== "string" || !value.trim()) return now + 60000;
  const text = value.trim();
  if (/^\d+$/.test(text) && Number.isFinite(Number(text) * 1000))
    return now + Number(text) * 1000;
  const time = Date.parse(text);
  return Number.isFinite(time) && new Date(time).toUTCString() === text
    ? Math.max(now, time)
    : now + 60000;
}

export function createRequests({
  fetch,
  now = Date.now,
  sleep = delay,
  timeout = 30000,
  concurrency = 4,
  onRequest = () => {},
}) {
  let active = 0,
    count = 0,
    limitedUntil = 0;
  const waiting = [];
  function acquire(signal) {
    signal.throwIfAborted();
    if (active < concurrency) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: () => {
          signal.removeEventListener("abort", abort);
          resolve();
        },
      };
      const abort = () => {
        waiting.splice(waiting.indexOf(entry), 1);
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      waiting.push(entry);
    });
  }
  function release() {
    const next = waiting.shift();
    if (next) next.resolve();
    else active--;
  }
  async function attempt(url, signal) {
    await acquire(signal);
    try {
      while (now() < limitedUntil) await sleep(limitedUntil - now(), signal);
      signal.throwIfAborted();
      const controller = new AbortController();
      const cancel = () => controller.abort(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(
        () => controller.abort(new RequestError("请求超时", true)),
        timeout,
      );
      let aborted;
      const cancelled = new Promise((_, reject) => {
        aborted = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", aborted, { once: true });
      });
      try {
        return await Promise.race([
          cancelled,
          (async () => {
            count++;
            onRequest(count);
            let response;
            try {
              response = await fetch(url, {
                credentials: "same-origin",
                signal: controller.signal,
              });
            } catch (error) {
              controller.signal.throwIfAborted();
              throw new RequestError(error.message, true);
            }
            controller.signal.throwIfAborted();
            if (response.status === 429)
              limitedUntil = Math.max(
                limitedUntil,
                retryAt(response.headers?.get("Retry-After"), now()),
              );
            if (!response.ok)
              throw new RequestError(
                response.status === 429
                  ? "HTTP 429：原站限流"
                  : `HTTP ${response.status}：读取失败`,
                response.status === 408 ||
                  response.status === 429 ||
                  (response.status >= 500 && response.status <= 599),
              );
            if (response.url && response.url !== url)
              throw new RequestError("请求跳转到其他页面，请检查登录状态");
            try {
              return await response.text();
            } catch (error) {
              controller.signal.throwIfAborted();
              throw new RequestError(error.message, true);
            }
          })(),
        ]);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        controller.signal.removeEventListener("abort", aborted);
      }
    } finally {
      release();
    }
  }
  return {
    get count() {
      return count;
    },
    async text(url, { signal = new AbortController().signal } = {}) {
      for (let retry = 0; ; retry++) {
        try {
          return await attempt(url, signal);
        } catch (error) {
          signal.throwIfAborted();
          if (!error.retryable || retry === 2) throw error;
          await sleep(
            Math.max(1000 * 2 ** retry, limitedUntil - now()),
            signal,
          );
        }
      }
    },
  };
}
