import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createRelationshipStore } from "../vendor/bangumi-relationship-store/src/index.mjs";
import { createSession } from "../src/session.mjs";
import { graphSource } from "./support/graphs.mjs";
import { deferred, until } from "./support/async.mjs";

function setup(overrides = {}) {
  const values = new Map();
  const source = graphSource({ alice: ["bob"], bob: ["alice"] });
  const options = {
    current: {
      id: "alice",
      name: "爱丽丝",
      avatar: "https://lain.bgm.tv/alice.jpg",
    },
    site: {
      resolve: async (id) => ({
        id,
        name: "班友 " + id,
        avatar: "https://lain.bgm.tv/" + id + ".jpg",
      }),
      relationships: async (id, direction) => {
        const [record] = await source.load([[id, direction]]);
        return { ...record, users: [] };
      },
    },
    store: createRelationshipStore({ indexedDB: new IDBFactory() }),
    storage: () => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    }),
    now: () => 1000,
    ...overrides,
  };
  return { session: createSession(options), options, values };
}

test("成功探索留下简要历史，新会话恢复摘要和共享资料但不恢复当前条件或结果", async () => {
  const { session, options } = setup();
  await session.fill(1, "bob");
  await session.run();
  assert.equal(session.state.history.entries.length, 1);
  assert.deepEqual(session.state.history.entries[0], {
    start: "alice",
    end: "bob",
    status: "found",
    hops: 1,
    mode: "mutual",
    hasExclusions: false,
    completedAt: 1000,
  });
  await until(() => session.state.history.users.bob?.name === "班友 bob");
  let cached;
  for (let attempt = 0; attempt < 100; attempt++) {
    cached = (await options.store.read({ users: ["bob"] })).users.bob;
    if (cached) break;
    await new Promise(setImmediate);
  }
  assert.equal(cached?.name, "班友 bob");
  const next = createSession({
    ...options,
    site: { resolve: () => assert.fail("恢复摘要不得访问网络") },
  });
  assert.deepEqual(next.state.history.entries, session.state.history.entries);
  await until(() => next.state.history.users.bob?.name === "班友 bob");
  assert.deepEqual(
    next.state.endpoints.map(({ input }) => input),
    ["alice", ""],
  );
  assert.equal(next.state.mode, "mutual");
  assert.equal(next.state.result, null);
  assert.equal(
    next.state.history.users.alice.avatar,
    "https://lain.bgm.tv/alice.jpg",
  );
});

test("历史最多五条，重复端点和模式按最新结局替换前移，换模式或方向另计", async () => {
  let time = 1000;
  const { session, options } = setup({ now: () => time++ });
  for (const id of ["bob", "carol", "dave", "erin", "frank", "grace"]) {
    await session.fill(1, id);
    await session.run();
  }
  assert.deepEqual(
    session.state.history.entries.map(({ end }) => end),
    ["grace", "frank", "erin", "dave", "carol"],
  );
  await session.fill(1, "erin");
  session.setExcludedInput("hub");
  await session.addExcluded();
  await session.run();
  assert.deepEqual(
    session.state.history.entries.map(({ end }) => end),
    ["erin", "grace", "frank", "dave", "carol"],
  );
  const latest = session.state.history.entries[0];
  assert.equal(latest.status, "unreachable");
  assert.equal(latest.hops, null);
  assert.equal(latest.hasExclusions, true);
  await session.run();
  assert.equal(session.state.history.entries.length, 5);
  assert.ok(session.state.history.entries[0].completedAt > latest.completedAt);
  session.setMode("directed");
  await session.run();
  session.swap();
  await session.run();
  assert.deepEqual(
    session.state.history.entries
      .slice(0, 3)
      .map(({ start, end, mode }) => [start, end, mode]),
    [
      ["erin", "alice", "directed"],
      ["alice", "erin", "directed"],
      ["alice", "erin", "mutual"],
    ],
  );
  assert.deepEqual(
    createSession(options).state.history.entries,
    session.state.history.entries,
  );
});

test("零跳可记录，失败、无效端点及停止不覆盖成功摘要，迟到响应也不新增", async () => {
  let outcome = "normal";
  const gate = deferred();
  const { session } = setup({
    site: {
      resolve: async (id) => ({ id, name: id, avatar: "" }),
      relationships: async () => {
        if (outcome === "error") throw new Error("网络失败");
        if (outcome === "slow") await gate.promise;
        return {
          users: [],
          snapshot:
            outcome === "invalid"
              ? {
                  status: "unavailable",
                  fetchedAt: 1,
                  issue: { code: "deleted-display-name-page-unavailable" },
                }
              : { status: "available", fetchedAt: 1, members: [] },
        };
      },
    },
  });
  await session.fill(1, "alice");
  await session.run();
  assert.equal(session.state.history.entries[0].hops, 0);
  const saved = session.state.history.entries;
  await session.fill(1, "bob");
  outcome = "invalid";
  await session.run();
  assert.equal(session.state.result.status, "invalid");
  assert.deepEqual(session.state.history.entries, saved);
  outcome = "error";
  await session.run();
  assert.equal(session.state.phase, "error");
  assert.deepEqual(session.state.history.entries, saved);
  outcome = "slow";
  const pending = session.run();
  await until(() => session.state.phase === "running");
  session.stop();
  gate.resolve();
  await pending;
  assert.equal(session.state.phase, "stopped");
  assert.deepEqual(session.state.history.entries, saved);
  session.setInput(1, "");
  await session.run();
  assert.deepEqual(session.state.history.entries, saved);
});

test("清空只移除历史，保留当前结果、排除名单和共享资料，下一次成功仍可记入", async () => {
  const { session, options } = setup();
  session.setExcludedInput("hub");
  await session.addExcluded();
  await session.fill(1, "alice");
  await session.run();
  const result = session.state.result;
  session.clearHistory();
  assert.deepEqual(session.state.history.entries, []);
  assert.equal(session.state.result, result);
  assert.equal(session.state.exclusions.users[0].id, "hub");
  assert.deepEqual(createSession(options).state.history.entries, []);
  assert.equal(
    (await options.store.read({ users: ["hub"] })).users.hub.name,
    "班友 hub",
  );
  await session.run();
  assert.equal(session.state.history.entries.length, 1);
});

test("损坏摘要被明确降级为空历史，不影响继续探索", async () => {
  const { session: initial, options, values } = setup();
  await initial.fill(1, "alice");
  await initial.run();
  const key = "bangumi-six-degrees:recent-explorations";
  const valid = JSON.parse(values.get(key));
  const entry = valid.entries[0];
  for (const raw of [
    "",
    "null",
    "{}",
    JSON.stringify({ version: 2, entries: [] }),
    JSON.stringify({ version: 1, entries: null }),
    ...[
      null,
      { ...entry, start: "@alice" },
      { ...entry, end: "bad/name" },
      { ...entry, status: "incomplete" },
      { ...entry, hops: -1 },
      { ...entry, mode: "other" },
      { ...entry, completedAt: -1 },
      { ...entry, hasExclusions: "false" },
      { ...entry, path: ["alice", "bob"] },
    ].map((item) => JSON.stringify({ version: 1, entries: [item] })),
  ]) {
    values.set(key, raw);
    const next = createSession(options);
    assert.deepEqual(next.state.history.entries, [], raw);
    assert.match(next.state.history.storageWarning, /无法读取探索记录/, raw);
    await next.fill(1, "alice");
    await next.run();
    assert.equal(next.state.result.status, "found");
    assert.equal(next.state.history.entries.length, 1);
    assert.equal(next.state.history.storageWarning, "");
  }
});

test("存储拒绝或共享资料故障不影响成功结果和本页摘要，清空失败也保留明确提示", async () => {
  const { session } = setup({
    storage: () => {
      throw new Error("denied");
    },
    store: {
      read: async () => ({ users: {} }),
      commit: async () => {
        throw new Error("cache unavailable");
      },
    },
  });
  assert.match(session.state.history.storageWarning, /无法读取探索记录/);
  await session.fill(1, "alice");
  await session.run();
  await until(() => session.state.history.cacheWarning);
  assert.equal(session.state.phase, "complete");
  assert.equal(session.state.result.status, "found");
  assert.equal(session.state.history.entries[0].hops, 0);
  assert.match(
    session.state.history.storageWarning,
    /未能保存.*刷新后可能丢失/,
  );
  session.clearHistory();
  assert.deepEqual(session.state.history.entries, []);
  assert.match(session.state.history.storageWarning, /未能清空.*重新出现/);
});

test("本轮列表更新端点资料后，成功摘要和刷新恢复均采用新资料而非旧端点确认", async () => {
  const source = graphSource({ alice: ["bob"], bob: ["alice"] });
  const { session, options } = setup({
    site: {
      resolve: async (id) => ({ id, name: "旧昵称 " + id, avatar: "" }),
      relationships: async (id, direction) => {
        const [record] = await source.load([[id, direction]]);
        return {
          ...record,
          users: ["alice", "bob", "isolated"].map((userId) => ({
            id: userId,
            name: "新昵称 " + userId,
            avatar: "https://lain.bgm.tv/new-" + userId + ".jpg",
            fetchedAt: 2000,
          })),
        };
      },
    },
  });
  for (const end of ["bob", "isolated"]) {
    await session.fill(1, end);
    await session.run();
    assert.equal(session.state.history.users[end].name, "新昵称 " + end);
    assert.equal(
      session.state.history.users[end].avatar,
      "https://lain.bgm.tv/new-" + end + ".jpg",
    );
    const next = createSession(options);
    await until(() => next.state.history.users[end]);
    assert.equal(next.state.history.users[end].name, "新昵称 " + end);
  }
});

test("零跳探索复用更新的共享资料，不把较早页面资料写回覆盖，并可刷新恢复", async () => {
  const { session, options } = setup();
  await options.store.commit({
    users: {
      alice: {
        name: "共享库的新昵称",
        avatar: "https://lain.bgm.tv/new-alice.jpg",
        fetchedAt: 3000,
      },
    },
  });
  await session.fill(1, "alice");
  await session.run();
  await until(
    () => session.state.history.users.alice?.name === "共享库的新昵称",
  );
  assert.equal(session.state.result.path[0].name, "班友 alice");
  assert.equal(session.state.history.entries[0].hops, 0);
  assert.equal(
    (await options.store.read({ users: ["alice"] })).users.alice.name,
    "共享库的新昵称",
  );
  const next = createSession(options);
  await until(() => next.state.history.users.alice?.name === "共享库的新昵称");
});

test("清空期间迟到的资料读取不能恢复已清除的历史，也不覆盖新端点资料", async () => {
  const { session: initial, options } = setup();
  await initial.fill(1, "alice");
  await initial.run();
  const gate = deferred();
  const next = createSession({
    ...options,
    now: () => 2000,
    site: {
      ...options.site,
      resolve: async (id) => ({ id, name: "新昵称", avatar: "" }),
    },
    store: { read: () => gate.promise, commit: async () => {} },
    current: { id: "alice", name: "新昵称", avatar: "" },
  });
  await Promise.resolve();
  next.clearHistory();
  await next.fill(1, "alice");
  await next.run();
  gate.resolve({
    users: { alice: { name: "旧昵称", avatar: "", fetchedAt: 1 } },
  });
  await gate.promise;
  await Promise.resolve();
  assert.equal(next.state.history.entries.length, 1);
  assert.equal(next.state.history.users.alice.name, "新昵称");
  assert.equal(next.state.history.entries[0].completedAt, 2000);
});
