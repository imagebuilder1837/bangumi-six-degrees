import test from "node:test";
import assert from "node:assert/strict";
import { createRequests } from "../src/requests.mjs";
import { deferred, until } from "./support/async.mjs";

test("429 的等待约束所有新请求和重试", async () => {
  let time = 0,
    attempts = 0;
  const starts = [],
    waits = [];
  const requests = createRequests({
    concurrency: 1,
    now: () => time,
    sleep: async (ms) => {
      waits.push(ms);
      time += ms;
    },
    fetch: async () => {
      starts.push(time);
      return ++attempts === 1
        ? new Response("", { status: 429, headers: { "Retry-After": "5" } })
        : new Response("ok");
    },
  });
  assert.deepEqual(
    await Promise.all([
      requests.text("https://bgm.tv/a"),
      requests.text("https://bgm.tv/b"),
    ]),
    ["ok", "ok"],
  );
  assert.ok(starts.slice(1).every((start) => start >= 5000));
  assert.ok(waits.includes(5000));
});

test("无效 Retry-After 等待六十秒，连续限流也只能总共尝试三次", async () => {
  let time = 0;
  const calls = [];
  const waits = [];
  const requests = createRequests({
    now: () => time,
    sleep: async (ms) => {
      waits.push(ms);
      time += ms;
    },
    fetch: async (url) => {
      calls.push(url);
      return new Response("", {
        status: 429,
        headers: { "Retry-After": "invalid" },
      });
    },
  });
  await assert.rejects(requests.text("https://bgm.tv/a"), /429/);
  assert.deepEqual(waits, [60000, 60000]);
  assert.equal(calls.length, 3);
});

test("同一队列最多四个并发请求，取消队列任务不会占用后续名额", async () => {
  const gates = [];
  const requests = createRequests({
    fetch: async () => {
      const gate = deferred();
      gates.push(gate);
      await gate.promise;
      return new Response("ok");
    },
  });
  const pending = Array.from({ length: 4 }, (_, i) =>
    requests.text("https://bgm.tv/" + i),
  );
  const abort = new AbortController();
  const cancelled = requests.text("https://bgm.tv/cancel", {
    signal: abort.signal,
  });
  const rejected = assert.rejects(cancelled, { name: "AbortError" });
  const fifth = requests.text("https://bgm.tv/fifth");
  await until(() => gates.length === 4);
  abort.abort();
  await rejected;
  gates[0].resolve();
  await until(() => gates.length === 5);
  for (const gate of gates) gate.resolve();
  await Promise.all([...pending, fifth]);
  assert.equal(gates.length, 5);
});

test("取消和超时能终止不遵守 abort 的 fetch", async () => {
  const started = deferred();
  const requests = createRequests({
    fetch: () => {
      started.resolve();
      return new Promise(() => {});
    },
  });
  const abort = new AbortController();
  const pending = requests.text("https://bgm.tv/a", { signal: abort.signal });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await started.promise;
  abort.abort();
  await rejected;
  const calls = [];
  const timeout = createRequests({
    fetch: (url) => {
      calls.push(url);
      return new Promise(() => {});
    },
    timeout: 5,
    sleep: async () => {},
  });
  await assert.rejects(timeout.text("https://bgm.tv/b"), {
    code: "timeout",
    message: "请求超时",
  });
  assert.equal(calls.length, 3);
});

test("普通 4xx 与登录跳转不重试，正文读取失败仍可重试", async () => {
  const calls = [];
  const requests = createRequests({
    fetch: async (url) => {
      calls.push(url);
      return new Response("", { status: 403 });
    },
  });
  await assert.rejects(requests.text("https://bgm.tv/a"), /403/);
  assert.equal(calls.length, 1);
  const redirect = createRequests({
    fetch: async () => ({ ok: true, url: "https://bgm.tv/login" }),
  });
  await assert.rejects(redirect.text("https://bgm.tv/a"), /跳转/);
  let attempt = 0;
  const body = createRequests({
    sleep: async () => {},
    fetch: async () => ({
      ok: true,
      text: async () => {
        if (++attempt < 3) throw new Error("body");
        return "ok";
      },
    }),
  });
  assert.equal(await body.text("https://bgm.tv/a"), "ok");
  assert.equal(attempt, 3);
});

test("跳转后的 503 和 429 不重试，也不污染后续请求的全局等待", async () => {
  for (const status of [503, 429]) {
    let time = 0;
    const waits = [];
    const calls = [];
    const requests = createRequests({
      now: () => time,
      sleep: async (ms) => {
        waits.push(ms);
        time += ms;
      },
      fetch: async (url) => {
        calls.push(url);
        return url.endsWith("/a")
          ? {
              ok: false,
              status,
              url: "https://bgm.tv/login",
              headers: new Headers({ "Retry-After": "60" }),
            }
          : new Response("ok");
      },
    });
    await assert.rejects(requests.text("https://bgm.tv/a"), /跳转/);
    assert.equal(calls.length, 1);
    assert.equal(await requests.text("https://bgm.tv/b"), "ok");
    assert.deepEqual(waits, []);
  }
});

test("暂时失败最多重试两次，分别等待一秒和两秒", async () => {
  const delays = [];
  let count = 0;
  const requests = createRequests({
    fetch: async () => {
      count++;
      if (count < 3) throw new Error("offline");
      return new Response("ok");
    },
    sleep: async (delay) => {
      delays.push(delay);
    },
  });
  assert.equal(await requests.text("https://bgm.tv/user/a"), "ok");
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(count, 3);
});

test("网络和正文失败按稳定原因分类，重试耗尽仍保留原始消息与异常", async () => {
  for (const code of ["network", "body-read"]) {
    const cause = new Error("任意变更的底层消息");
    let attempts = 0;
    const requests = createRequests({
      fetch: async () => {
        attempts++;
        if (code === "network") throw cause;
        return {
          ok: true,
          text: async () => {
            throw cause;
          },
        };
      },
      sleep: async () => {},
    });
    await assert.rejects(
      requests.text("https://bgm.tv/user/alice"),
      (error) => {
        assert.equal(error.code, code);
        assert.equal(error.message, cause.message);
        assert.equal(error.cause, cause);
        return true;
      },
    );
    assert.equal(attempts, 3);
  }
});
