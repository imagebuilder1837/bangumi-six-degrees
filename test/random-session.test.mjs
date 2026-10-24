import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/session.mjs";
import { createSite, readUser } from "../src/site.mjs";
import { createRequests } from "../src/requests.mjs";
import { browserStore } from "../src/data.mjs";
import { createRandomUsers } from "../src/random-users.mjs";
import { OperationError } from "../src/errors.mjs";
import { mountView } from "../src/view.mjs";
import { browser, input, until } from "./support/browser.mjs";
import { deferred } from "./support/async.mjs";

function setup() {
  const gates = [];
  const session = createSession({
    current: { id: "home", name: "主页用户", avatar: "" },
    site: { resolve: async (id) => ({ id, name: id }) },
    store: {},
    randomUsers: {
      pick: ({ signal }) => {
        const gate = deferred();
        gates.push({ ...gate, signal });
        return gate.promise;
      },
      cancel() {},
    },
  });
  return { session, gates };
}

test("抽取失败保留原输入和已确认用户，不自动探索", async () => {
  const { session, gates } = setup();
  const pending = session.random(0);
  gates[0].reject(new OperationError("network", "网络暂时不可用"));
  await pending;
  assert.deepEqual(
    session.state.endpoints.map(({ input }) => input),
    ["home", ""],
  );
  assert.equal(session.state.endpoints[0].user.id, "home");
  assert.match(session.state.endpoints[0].error.message, /网络/);
  assert.equal(session.state.phase, "idle");
  assert.equal(session.state.result, null);
});

test("重新抽取、手输、交换及停止均使旧抽取失效", async () => {
  for (const action of ["again", "input", "swap", "stop"]) {
    const { session, gates } = setup();
    const old = session.random(0);
    let next;
    if (action === "again") {
      next = session.random(0);
      gates[1].resolve({ id: "new" });
      await next;
    } else if (action === "input") {
      session.setInput(0, "typed");
      await session.resolve(0);
    } else if (action === "swap") session.swap();
    else session.stop();
    assert.equal(gates[0].signal.aborted, true);
    const expected = [...session.state.endpoints.map(({ input }) => input)];
    gates[0].resolve({ id: "late" });
    await old;
    assert.deepEqual(
      session.state.endpoints.map(({ input }) => input),
      expected,
    );
    assert.equal(
      session.state.endpoints.some(
        ({ activity }) => activity === "randomizing",
      ),
      false,
    );
  }
});

test("两端同时抽到同一用户时，后提交的一侧重新抽取", async () => {
  const { session, gates } = setup();
  const first = session.random(0);
  const second = session.random(1);
  gates[0].resolve({ id: "same" });
  gates[1].resolve({ id: "same" });
  await until(() => gates.length === 3);
  gates[2].resolve({ id: "other" });
  await Promise.all([first, second]);
  assert.deepEqual(
    session.state.endpoints.map(({ input }) => input),
    ["same", "other"],
  );
});

test("关闭重开不会重抽，抽取期间可停止且不能开始探索", async () => {
  const { session, gates } = setup();
  session.open();
  const pending = session.random(1);
  session.close();
  session.open();
  await session.run();
  assert.equal(gates.length, 1);
  assert.equal(session.state.phase, "idle");
  gates[0].resolve({ id: "picked" });
  await pending;
  assert.deepEqual(
    session.state.endpoints.map(({ input }) => input),
    ["home", "picked"],
  );
});

test("抽取状态与错误统一显示在左下角，完成或停止后恢复提示", async (t) => {
  const env = browser();
  t.after(() => env.window.close());
  const { session, gates } = setup();
  const document = env.window.document;
  mountView(env.window, session, {
    self: "home",
    services: document.querySelector(".network_service"),
  });
  session.open();
  const hint = document.querySelector(".bsd-hint");
  const idleHint = hint.textContent;
  const endpoints = [...document.querySelectorAll(".bsd-endpoint")];
  const first = session.random(0);
  const second = session.random(1);
  assert.equal(hint.textContent, "正在抽取班友…");
  assert.ok(
    endpoints.every((endpoint) => !endpoint.textContent.includes("正在抽取")),
  );
  gates[0].resolve({ id: "first" });
  await first;
  assert.equal(hint.textContent, "正在抽取班友…");
  gates[1].reject(new OperationError("network", "网络暂时不可用"));
  await second;
  assert.equal(hint.textContent, "暂时无法获取终点用户，请稍后重试");
  assert.doesNotMatch(endpoints[1].textContent, /网络暂时不可用/);
  const stopped = session.random(1);
  session.stop();
  assert.equal(hint.textContent, idleHint);
  assert.equal(document.querySelector('[data-action="stop"]').hidden, true);
  gates[2].resolve({ id: "late" });
  await stopped;
  assert.equal(hint.textContent, idleHint);
  const next = session.random(1);
  gates[3].resolve({ id: "picked" });
  await next;
  assert.equal(hint.textContent, idleHint);
});

test("随机班友按钮只填入端点，探索重新请求网络关系", async (t) => {
  const env = browser({
    aliases: { 1: "alice", 2: "bob" },
    profiles: { bob: { name: "抽到的班友" } },
    beforeFetch: async (url) => {
      const id = new URL(url).pathname.split("/")[2];
      if (/^\d+$/.test(id) && Number(id) > 2)
        return new Response("", { status: 404 });
    },
  });
  t.after(() => env.window.close());
  const site = createSite({
    window: env.window,
    requests: createRequests({ fetch: env.fetch }),
  });
  const store = browserStore(env.window);
  const randomUsers = createRandomUsers({
    site,
    store,
    seed: { range: 2, observed: 2, checkedAt: 0 },
    now: () => 0,
    random: () => 0.75,
  });
  const session = createSession({
    site,
    store,
    randomUsers,
    current: readUser(env.window.document, env.window.location.href),
  });
  const document = env.window.document;
  mountView(env.window, session, {
    self: "self",
    services: document.querySelector(".network_service"),
  });
  document.querySelector('[aria-label="六度分隔"]').click();
  document.querySelector('[data-endpoint="1"] [data-action="random"]').click();
  await until(() => session.state.endpoints[1].user?.id === "bob");
  const endInput = document.querySelector('input[aria-label="终点用户"]');
  const randomlyFilled = endInput.value;
  assert.equal(randomlyFilled, "bob");
  assert.equal(
    document.querySelector('[data-endpoint="1"] .bsd-endpoint-name')
      .textContent,
    "抽到的班友",
  );
  assert.equal(
    document
      .querySelector('[data-endpoint="1"] .bsd-avatar-link')
      .getAttribute("href"),
    "/user/bob",
  );
  input(env.window, "终点用户", "2");
  await until(() => session.state.endpoints[1].user?.id === "bob");
  assert.equal(endInput.value, randomlyFilled);
  assert.equal(session.state.result, null);
  assert.equal(session.state.phase, "idle");
  for (const direction of ["friends", "rev_friends"]) {
    assert.equal(
      env.urls.filter((url) => url.endsWith(`/bob/${direction}`)).length,
      1,
    );
  }
  await session.run();
  assert.equal(session.state.result.status, "found");
  assert.ok(env.urls.filter((url) => url.endsWith("/bob/friends")).length > 1);
  input(env.window, "终点用户", "other");
  await until(() => session.state.endpoints[1].user?.id === "other");
  assert.equal(session.state.result, null);
  assert.equal(document.querySelector(".bsd-path"), null);
  env.window.close();
});
