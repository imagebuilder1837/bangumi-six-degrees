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
  await until(() => session.state.endpoints.every(Boolean));
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

test("新页面首次打开只使用完整缓存，失败搜索不覆盖上次成功条件", async () => {
  const first = browser();
  const session = initialize(first.window, { fetch: first.fetch });
  first.window.document.querySelector('[aria-label="六度分隔"]').click();
  input(first.window, "起点用户", "alice");
  input(first.window, "终点用户", "bob");
  await until(() => session.state.endpoints.every(Boolean));
  first.window.document.querySelector('[data-action="explore"]').click();
  await until(() => session.state.result?.status === "found");
  const storage = Object.fromEntries(Object.entries(first.window.localStorage));
  const second = browser({ indexedDB: first.indexedDB, storage });
  const restored = initialize(second.window, { fetch: second.fetch });
  second.window.document.querySelector('[aria-label="六度分隔"]').click();
  await until(() => restored.state.result?.status === "found");
  assert.equal(second.urls.length, 0);
  assert.equal(
    second.window.document
      .querySelectorAll(".bsd-path img")[1]
      .getAttribute("src"),
    "https://lain.bgm.tv/bob.jpg",
  );
  input(second.window, "起点用户", "isolated");
  await until(() => restored.state.endpoints[0]?.id === "isolated");
  const mode = second.window.document.querySelector("select");
  mode.value = "directed";
  mode.dispatchEvent(new second.window.Event("change"));
  second.window.document.querySelector('[data-action="explore"]').click();
  await until(() => restored.state.result?.status === "unreachable");
  const third = browser({
    indexedDB: first.indexedDB,
    storage: Object.fromEntries(Object.entries(second.window.localStorage)),
  });
  const thirdSession = initialize(third.window, { fetch: third.fetch });
  third.window.document.querySelector('[aria-label="六度分隔"]').click();
  await until(() => thirdSession.state.phase === "complete");
  assert.deepEqual(thirdSession.state.inputs, ["alice", "bob"]);
  for (const env of [first, second, third]) env.window.close();
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
  await until(() => session.state.endpoints.every(Boolean));
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
  await until(() => session.state.endpoints[0]?.id === "bob");
  gate.resolve();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(session.state.inputs[0], "bob");
  const count = env.urls.length;
  const mode = document.querySelector("select");
  mode.value = "mutual";
  mode.dispatchEvent(new env.window.Event("change"));
  document.querySelector('[data-action="swap"]').click();
  assert.equal(env.urls.length, count);
  assert.deepEqual(session.state.inputs, ["", "bob"]);
  env.window.close();
});

test("缓存不可用时不自动联网，用户主动探索仍可成功", async () => {
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
  await until(() => session.state.phase === "error");
  assert.equal(env.urls.length, 0);
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
  assert.match(document.querySelector(".bsd-error").textContent, /请先填入/);
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
  input(env.window, "起点用户", "alice");
  input(env.window, "终点用户", "bob");
  await until(() => session.state.endpoints.every(Boolean));
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
