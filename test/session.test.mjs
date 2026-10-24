import test from "node:test";
import assert from "node:assert/strict";
import { initialize } from "../src/entry.mjs";
import { browser, input, until } from "./support/browser.mjs";
import { deferred } from "./support/async.mjs";

test("停止后立即重开探索，旧任务的收尾不能解锁或覆盖新任务", async () => {
  const gates = [];
  const env = browser({
    beforeFetch: async (url) => {
      if (url.endsWith("/alice/friends")) {
        const gate = deferred();
        gates.push(gate);
        await gate.promise;
      }
    },
  });
  const session = initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  input(env.window, "起点用户", "alice");
  input(env.window, "终点用户", "bob");
  await until(() => session.state.endpoints.every(({ user }) => !!user));
  document.querySelector('[data-action="explore"]').click();
  await until(() => gates.length === 1);
  document.querySelector('[data-action="stop"]').click();
  document.querySelector('[data-action="explore"]').click();
  await until(() => gates.length === 2);
  const locked = document.querySelector(
    'input[aria-label="起点用户"]',
  ).disabled;
  gates.forEach((gate) => gate.resolve());
  await until(() => document.querySelector('[data-result="found"]'));
  env.window.close();
  assert.equal(locked, true);
});

test("修改端点、交换或切换模式立即清空结果与旧状态，重跑不展示旧路径", async () => {
  const env = browser();
  const session = initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  await session.fill(1, "bob");
  await session.run();
  assert.equal(session.state.result.status, "found");
  const assertCleared = () => {
    assert.equal(session.state.result, null);
    assert.equal(document.querySelector(".bsd-output").childElementCount, 0);
    assert.equal(
      document.querySelector(".bsd-output").hasAttribute("data-result"),
      false,
    );
    assert.doesNotMatch(
      document.querySelector(".bsd-message").textContent,
      /已确认最短路径|没有可达路径/,
    );
  };
  input(env.window, "终点用户", "alice");
  assertCleared();
  await until(() => session.state.endpoints[1].user?.id === "alice");
  await session.run();
  assert.equal(session.state.result.status, "found");
  session.swap();
  assertCleared();
  await session.fill(1, "bob");
  await session.run();
  const count = env.urls.length;
  session.setMode("directed");
  assertCleared();
  assert.equal(env.urls.length, count);
  await session.run();
  assert.equal(session.state.result.status, "found");
  const rerun = session.run();
  assertCleared();
  await rerun;
  assert.equal(session.state.result.status, "found");
  await session.fill(1, "isolated");
  await session.run();
  assert.equal(session.state.result.status, "unreachable");
  input(env.window, "终点用户", "");
  assertCleared();
  env.window.close();
});

test("新页面忽略并精确清理旧成功条件，不恢复结果或自动取数", async () => {
  const key = "bangumi-six-degrees:last-success";
  const first = browser({
    storage: {
      [key]: JSON.stringify({ start: "old", end: "bob", mode: "undirected" }),
      unrelated: "保留",
    },
  });
  const session = initialize(first.window, { fetch: first.fetch });
  first.window.document.querySelector('[aria-label="六度分隔"]').click();
  assert.deepEqual(
    session.state.endpoints.map(({ input }) => input),
    ["alice", ""],
  );
  assert.equal(session.state.mode, "mutual");
  assert.equal(session.state.result, null);
  assert.equal(first.urls.length, 0);
  assert.equal(first.window.localStorage.getItem(key), null);
  assert.equal(first.window.localStorage.getItem("unrelated"), "保留");
  input(first.window, "终点用户", "bob");
  await until(() => session.state.endpoints.every(({ user }) => !!user));
  await session.run();
  assert.equal(session.state.result.status, "found");
  assert.equal(first.window.localStorage.getItem(key), null);
  const second = browser({ indexedDB: first.indexedDB });
  const fresh = initialize(second.window, { fetch: second.fetch });
  await fresh.open();
  assert.deepEqual(
    fresh.state.endpoints.map(({ input }) => input),
    ["alice", ""],
  );
  assert.equal(fresh.state.result, null);
  assert.equal(second.urls.length, 0);
  first.window.close();
  second.window.close();
});

test("关闭仅隐藏正在进行的搜索，重开不会重复请求", async () => {
  const gate = deferred();
  let waiting = false;
  const env = browser({
    beforeFetch: async (url) => {
      if (url.endsWith("/alice/friends")) {
        waiting = true;
        await gate.promise;
      }
    },
  });
  const session = initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  input(env.window, "起点用户", "alice");
  input(env.window, "终点用户", "bob");
  await until(() => session.state.endpoints.every(({ user }) => !!user));
  document.querySelector('[data-action="explore"]').click();
  await until(() => waiting);
  document.querySelector('[aria-label="关闭六度分隔"]').click();
  const count = env.urls.length;
  assert.equal(session.state.phase, "running");
  assert.equal(document.querySelector('[role="dialog"]').hidden, true);
  document.querySelector('[aria-label="六度分隔"]').click();
  assert.equal(env.urls.length, count);
  gate.resolve();
  await until(() => session.state.result?.status === "found");
  env.window.close();
});

test("较慢的旧端点解析不能覆盖新的输入，切换模式和交换不自动探索", async () => {
  const gate = deferred();
  const env = browser({
    beforeFetch: async (url) => {
      if (url.endsWith("/user/slow")) await gate.promise;
    },
  });
  const session = initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  input(env.window, "起点用户", "slow");
  await until(() => env.urls.length === 1);
  input(env.window, "起点用户", "bob");
  await until(() => session.state.endpoints[0].user?.id === "bob");
  gate.resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(session.state.endpoints[0].input, "bob");
  const count = env.urls.length;
  document.querySelector('[role="combobox"]').click();
  document.querySelectorAll('[role="option"]')[1].click();
  assert.equal(session.state.mode, "directed");
  document.querySelector('[data-action="swap"]').click();
  assert.equal(env.urls.length, count);
  assert.deepEqual(
    session.state.endpoints.map(({ input }) => input),
    ["", "bob"],
  );
  env.window.close();
});

test("缓存不可用时首次打开不取数，用户主动探索仍可成功", async () => {
  const env = browser({
    indexedDB: null,
    storage: {
      "bangumi-six-degrees:last-success": JSON.stringify({
        start: "alice",
        end: "bob",
        mode: "undirected",
      }),
    },
  });
  const session = initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  assert.equal(session.state.phase, "idle");
  assert.equal(env.urls.length, 0);
  input(env.window, "终点用户", "bob");
  await until(() => session.state.endpoints.every(({ user }) => !!user));
  document.querySelector('[data-action="explore"]').click();
  await until(() => session.state.result?.status === "found");
  assert.match(session.state.warning, /缓存/);
  env.window.close();
});

test("入口只挂载一次，匿名快捷项禁用且空输入不会发出请求", async () => {
  const env = browser();
  env.window.document.querySelector("#dock").remove();
  initialize(env.window, { fetch: env.fetch });
  initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  assert.equal(document.querySelectorAll('[aria-label="六度分隔"]').length, 1);
  document.querySelector('[aria-label="六度分隔"]').click();
  assert.equal(document.querySelector('[data-fill="self"]').disabled, true);
  document.querySelector('[data-action="explore"]').click();
  assert.equal(env.urls.length, 0);
  assert.match(document.querySelector(".bsd-hint").textContent, /请先填入/);
  env.window.close();
});

test("最终中间用户直接展示扫描头像昵称，不额外请求其主页", async () => {
  const env = browser({
    edges: { alice: ["carol"], carol: ["bob"], bob: [] },
    profiles: { carol: { name: "路过的班友" } },
  });
  const session = initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  session.setMode("directed");
  input(env.window, "起点用户", "alice");
  input(env.window, "终点用户", "bob");
  await until(() => session.state.endpoints.every(({ user }) => !!user));
  document.querySelector('[data-action="explore"]').click();
  await until(() => session.state.result?.status === "found");
  const links = [...document.querySelectorAll(".bsd-path a")];
  assert.equal(links[1].querySelector("strong").textContent, "路过的班友");
  assert.equal(
    links[1].querySelector("img").getAttribute("src"),
    "https://lain.bgm.tv/carol.jpg",
  );
  assert.equal(env.urls.includes("https://bgm.tv/user/carol"), false);
  env.window.close();
});

test("主动输入归一身份并探索，关闭重开不会再次搜索", async () => {
  const env = browser();
  initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  input(env.window, "起点用户", "1");
  input(env.window, "终点用户", "bob");
  await until(
    () =>
      document.querySelector('input[aria-label="起点用户"]').value === "alice",
  );
  document.querySelector('[data-action="explore"]').click();
  await until(() => document.querySelector('[data-result="found"]'));
  assert.equal(document.querySelectorAll(".bsd-path a").length, 2);
  const count = env.urls.length;
  document.querySelector('[aria-label="关闭六度分隔"]').click();
  document.querySelector('[aria-label="六度分隔"]').click();
  assert.equal(env.urls.length, count);
  assert.equal(document.querySelector('[role="dialog"]').hidden, false);
  env.window.close();
});
