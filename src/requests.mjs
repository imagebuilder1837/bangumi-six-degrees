import { OperationError } from "./errors.mjs";

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
class RequestError extends OperationError {
  constructor(
    message,
    { code = "http", retryable = false, status, url, cause } = {},
  ) {
    super(code, message, cause);
    this.retryable = retryable;
    this.status = status;
    this.url = url;
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
}) {
  let active = 0,
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
  async function attempt(url, signal, acceptRedirect) {
    await acquire(signal);
    try {
      while (now() < limitedUntil) await sleep(limitedUntil - now(), signal);
      signal.throwIfAborted();
      const controller = new AbortController();
      const cancel = () => controller.abort(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(
        () =>
          controller.abort(
            new RequestError("请求超时", { code: "timeout", retryable: true }),
          ),
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
            let response;
            try {
              response = await fetch(url, {
                credentials: "same-origin",
                signal: controller.signal,
              });
            } catch (error) {
              controller.signal.throwIfAborted();
              throw new RequestError(error.message, {
                code: "network",
                retryable: true,
                cause: error,
              });
            }
            controller.signal.throwIfAborted();
            const finalUrl = response.url || url;
            if (finalUrl !== url && !acceptRedirect(finalUrl)) {
              const target = new URL(finalUrl);
              const login =
                target.origin === new URL(url).origin &&
                /^\/login\/?$/.test(target.pathname);
              throw new RequestError(
                login
                  ? "请求跳转到登录页面，请检查登录状态"
                  : "请求跳转到非预期页面",
                { code: login ? "login-redirect" : "unexpected-redirect" },
              );
            }
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
                {
                  retryable:
                    response.status === 408 ||
                    response.status === 429 ||
                    (response.status >= 500 && response.status <= 599),
                  status: response.status,
                  url: finalUrl,
                },
              );
            try {
              return { text: await response.text(), url: finalUrl };
            } catch (error) {
              controller.signal.throwIfAborted();
              throw new RequestError(error.message, {
                code: "body-read",
                retryable: true,
                cause: error,
              });
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
  async function page(
    url,
    {
      signal = new AbortController().signal,
      acceptRedirect = () => false,
    } = {},
  ) {
    for (let retry = 0; ; retry++) {
      try {
        return await attempt(url, signal, acceptRedirect);
      } catch (error) {
        signal.throwIfAborted();
        if (!error.retryable || retry === 2) throw error;
        await sleep(Math.max(1000 * 2 ** retry, limitedUntil - now()), signal);
      }
    }
  }
  return {
    async text(url, options) {
      return (await page(url, options)).text;
    },
    page,
  };
}
