import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createRelationshipStore } from "../vendor/bangumi-relationship-store/src/index.mjs";
import { createSession } from "../src/session.mjs";
import { deferred, until } from "./support/async.mjs";
import { graphSource } from "./support/graphs.mjs";

function setup(overrides = {}) {
  const values = new Map();
  const storage = () => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  });
  const store = createRelationshipStore({ indexedDB: new IDBFactory() });
  const options = {
    current: { id: "alice", name: "爱丽丝", avatar: "" },
    site: { resolve: async () => ({ id: "hub", name: "班友", avatar: "" }) },
    store,
    storage,
    ...overrides,
  };
  return { session: createSession(options), options, values };
}

test("添加先归一身份，名单跨会话保留，共享库保存资料且移除不删除资料", async () => {
  const { session, options, values } = setup();
  session.setExcludedInput("https://bgm.tv/user/123");
  await session.addExcluded();
  assert.deepEqual(
    session.state.exclusions.users.map((user) => user.id),
    ["hub"],
  );
  assert.equal(session.state.exclusions.input, "");
  const restored = createSession(options);
  assert.deepEqual(
    restored.state.exclusions.users.map((user) => user.id),
    ["hub"],
  );
  await until(() => restored.state.exclusions.users[0]?.name === "班友");
  const cached = await options.store.read({ users: ["hub"] });
  assert.equal(cached.users.hub.name, "班友");
  const persisted = [...values.values()].join("");
  assert.ok(persisted.includes("hub"));
  assert.ok(!persisted.includes("班友"));
  session.removeExcluded("hub");
  assert.equal(createSession(options).state.exclusions.users.length, 0);
  assert.equal(
    (await options.store.read({ users: ["hub"] })).users.hub.name,
    "班友",
  );
});

test("探索固定排除条件并锁定增删，原始关系列表不删除排除项", async () => {
  const gate = deferred();
  const source = graphSource({
    alice: ["hub", "carol"],
    hub: ["alice", "bob"],
    carol: ["alice", "dave"],
    dave: ["carol", "bob"],
    bob: ["hub", "dave"],
  });
  const { session, options } = setup({
    site: {
      resolve: async (id) => ({ id, name: id, avatar: "" }),
      relationships: async (id, direction) => {
        await gate.promise;
        const [record] = await source.load([[id, direction]]);
        return { ...record, users: [] };
      },
    },
  });
  await session.fill(1, "bob");
  session.setExcludedInput("hub");
  await session.addExcluded();
  const running = session.run();
  await until(() => session.state.phase === "running");
  session.removeExcluded("hub");
  session.setExcludedInput("another");
  await session.addExcluded();
  assert.deepEqual(
    session.state.exclusions.users.map(({ id }) => id),
    ["hub"],
  );
  gate.resolve();
  await running;
  assert.deepEqual(
    session.state.result.path.map(({ id }) => id),
    ["alice", "carol", "dave", "bob"],
  );
  assert.deepEqual(session.state.result.conditions.excluded, ["hub"]);
  const cached = await options.store.read({
    relationships: [["alice", "friends"]],
  });
  assert.ok(cached.relationships.alice.friends.members.includes("hub"));
});

test("重复添加和核验失败不修改名单或结果，成功增删才清空结果", async () => {
  const { session } = setup({
    site: {
      resolve: async (id) => {
        if (id === "bad") throw new Error("原始失败原因");
        return { id: id === "alias" ? "hub" : id, name: id, avatar: "" };
      },
    },
  });
  await session.fill(1, "alice");
  await session.run();
  const first = session.state.result;
  session.setExcludedInput("hub");
  assert.equal(session.state.result, first);
  await session.addExcluded();
  assert.equal(session.state.result, null);
  await session.run();
  const result = session.state.result;
  session.setExcludedInput("alias");
  await session.addExcluded();
  assert.equal(session.state.exclusions.users.length, 1);
  assert.match(session.state.exclusions.message, /已在名单/);
  assert.equal(session.state.result, result);
  session.setExcludedInput("bad");
  await session.addExcluded();
  assert.equal(session.state.exclusions.input, "bad");
  assert.match(session.state.exclusions.message, /原始失败原因/);
  assert.equal(session.state.result, result);
  session.removeExcluded("hub");
  assert.equal(session.state.result, null);
});

test("名单存储或资料缓存失败不妨碍当前名单，损坏记录按空名单继续", async () => {
  const denied = setup({
    storage: () => {
      throw new Error("denied");
    },
    store: {
      commit: async () => {
        throw new Error("unavailable");
      },
    },
  }).session;
  assert.match(denied.state.exclusions.storageWarning, /无法读取/);
  denied.setExcludedInput("hub");
  await denied.addExcluded();
  assert.equal(denied.state.exclusions.users[0].id, "hub");
  assert.match(denied.state.exclusions.storageWarning, /未能保存/);
  assert.match(denied.state.exclusions.cacheWarning, /缓存保存失败/);
  assert.equal(denied.state.canRun, true);
  const corrupted = setup({
    storage: () => ({
      getItem: () => '{"version":1,"ids":[null]}',
      removeItem() {},
    }),
  }).session;
  assert.deepEqual(corrupted.state.exclusions.users, []);
  assert.match(corrupted.state.exclusions.storageWarning, /空名单/);
});

test("恢复时拒绝空记录和非规范用户标识，不显示无效排除项", () => {
  for (const raw of [
    "",
    JSON.stringify({ version: 1, ids: ["@hub"] }),
    JSON.stringify({ version: 1, ids: ["hub "] }),
    JSON.stringify({ version: 1, ids: ["https://bgm.tv/user/hub"] }),
    JSON.stringify({ version: 1, ids: ["bad/name"] }),
  ]) {
    const { session } = setup({
      storage: () => ({ getItem: () => raw, removeItem() {} }),
    });
    assert.deepEqual(session.state.exclusions.users, [], raw);
    assert.match(session.state.exclusions.storageWarning, /空名单/);
  }
});

test("恢复名单时资料接口同步失败也能完成初始化并提示降级", async () => {
  const { options } = setup();
  const session = createSession({
    ...options,
    storage: () => ({
      getItem: () => JSON.stringify({ version: 1, ids: ["hub"] }),
      removeItem() {},
    }),
    store: {
      read() {
        throw new Error("同步不可用");
      },
    },
  });
  await until(() => session.state.exclusions.cacheWarning);
  assert.equal(session.state.exclusions.users[0].id, "hub");
  assert.equal(session.state.canRun, true);
});

test("迟到的资料缓存读取不覆盖重新核验得到的新资料", async () => {
  const { session: initial, options } = setup();
  initial.setExcludedInput("hub");
  await initial.addExcluded();
  const gate = deferred();
  const session = createSession({
    ...options,
    now: () => 200,
    site: { resolve: async () => ({ id: "hub", name: "新昵称", avatar: "" }) },
    store: {
      read: () => gate.promise,
      commit: (...args) => options.store.commit(...args),
    },
  });
  session.removeExcluded("hub");
  session.setExcludedInput("hub");
  await session.addExcluded();
  gate.resolve({
    users: { hub: { name: "旧昵称", avatar: "", fetchedAt: 1 } },
  });
  await gate.promise;
  assert.equal(session.state.exclusions.users[0].name, "新昵称");
});

test("核验结束时一次性发布名单和可探索状态，不暴露遗漏新排除项的窗口", async () => {
  const { session } = setup();
  session.setExcludedInput("hub");
  let confirming = false;
  const completed = [];
  session.subscribe((state) => {
    if (state.exclusions.activity === "resolving") confirming = true;
    if (confirming && state.canRun)
      completed.push(state.exclusions.users.map(({ id }) => id));
  });
  await session.addExcluded();
  assert.ok(completed.length);
  assert.ok(completed.every((ids) => ids.includes("hub")));
});

test("添加核验可取消，隐藏仍继续，过期响应不覆盖新输入或名单", async () => {
  const old = deferred();
  const { session } = setup({ site: { resolve: () => old.promise } });
  session.setExcludedInput("old");
  const pending = session.addExcluded();
  assert.equal(session.state.exclusions.activity, "resolving");
  assert.equal(session.state.canRun, false);
  session.close();
  session.open();
  assert.equal(session.state.exclusions.activity, "resolving");
  session.cancelExcluded();
  assert.match(session.state.exclusions.message, /已取消/);
  session.setExcludedInput("new");
  assert.equal(session.state.canRun, true);
  old.resolve({ id: "late", name: "迟到", avatar: "" });
  await pending;
  assert.equal(session.state.exclusions.input, "new");
  assert.deepEqual(session.state.exclusions.users, []);
});
