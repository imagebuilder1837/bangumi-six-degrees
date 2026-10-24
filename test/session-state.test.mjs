import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/session.mjs";
import { OperationError } from "../src/errors.mjs";
import { deferred } from "./support/async.mjs";

function setup(overrides = {}) {
  return createSession({
    current: { id: "alice", name: "爱丽丝", avatar: "" },
    site: { resolve: async (id) => ({ id, name: id, avatar: "" }) },
    store: {},
    ...overrides,
  });
}

test("会话快照隔离调用方修改，旧快照保留原值，订阅与读取使用同一快照", async () => {
  const resolved = { id: "bob", name: "鲍勃", avatar: "" };
  const session = setup({ site: { resolve: async () => resolved } });
  const first = session.state;
  const notifications = [];
  const unsubscribe = session.subscribe((state) => {
    assert.equal(state, session.state);
    notifications.push(state);
  });
  assert.equal(session.state, first);
  for (const mutate of [
    () => {
      first.mode = "directed";
    },
    () => {
      first.endpoints.reverse();
    },
    () => {
      first.endpoints[0].input = "other";
    },
    () => {
      first.endpoints[0].user.name = "changed";
    },
    () => {
      first.progress.visited = 100;
    },
  ])
    assert.throws(mutate, TypeError);
  await session.fill(1, "bob");
  const confirmed = session.state;
  resolved.name = "外部修改";
  assert.equal(confirmed.endpoints[1].user.name, "鲍勃");
  assert.equal(first.endpoints[1].input, "");
  session.setInput(1, "carol");
  assert.equal(confirmed.endpoints[1].input, "bob");
  assert.equal(confirmed.endpoints[1].user.name, "鲍勃");
  assert.equal(session.state.endpoints[1].user, null);
  unsubscribe();
  const count = notifications.length;
  session.open();
  assert.equal(notifications.length, count);
});

test("成功结果及路径资料只读，关闭重开保留同一结果而不重新发布路径", async () => {
  const session = setup();
  await session.fill(1, "alice");
  await session.run();
  const finished = session.state;
  assert.equal(finished.result.status, "found");
  for (const mutate of [
    () => {
      finished.result.conditions.mode = "directed";
    },
    () => {
      finished.result.path.push({ id: "fake" });
    },
    () => {
      finished.result.path[0].name = "changed";
    },
  ])
    assert.throws(mutate, TypeError);
  session.close();
  session.open();
  assert.equal(session.state.result, finished.result);
  assert.equal(session.state.result.path.length, 1);
});

test("会话统一发布操作权限：单独确认可编辑，探索确认锁定，停止后旧结果不覆盖新输入", async () => {
  const old = deferred();
  const signals = [];
  const session = setup({
    site: {
      resolve: async (id, { signal }) => {
        signals.push(signal);
        if (id === "slow") return old.promise;
        return { id, name: id };
      },
    },
  });
  assert.equal(session.state.canEdit, true);
  assert.equal(session.state.canRun, true);
  assert.equal(session.state.canStop, false);
  const fill = session.fill(1, "slow");
  assert.equal(session.state.endpoints[1].activity, "resolving");
  assert.equal(session.state.canEdit, true);
  assert.equal(session.state.canStop, true);
  const run = session.run();
  assert.equal(session.state.canEdit, false);
  assert.equal(session.state.canRun, false);
  session.setInput(0, "blocked");
  session.swap();
  session.setMode("undirected");
  assert.equal(session.state.endpoints[0].input, "alice");
  assert.equal(session.state.mode, "mutual");
  session.stop();
  assert.equal(signals[0].aborted, true);
  assert.equal(session.state.canEdit, true);
  assert.equal(session.state.canStop, false);
  await session.fill(1, "bob");
  old.resolve({ id: "late" });
  await Promise.all([fill, run]);
  assert.equal(session.state.endpoints[1].user.id, "bob");
  assert.equal(session.state.canRun, true);
});

test("随机填入期间禁止探索但允许改输入，端点错误保留稳定原因和原始消息", async () => {
  const gate = deferred();
  const session = setup({
    randomUsers: { pick: () => gate.promise, cancel() {} },
  });
  const pending = session.random(1);
  assert.equal(session.state.endpoints[1].activity, "randomizing");
  assert.equal(session.state.canRun, false);
  assert.equal(session.state.canEdit, true);
  assert.equal(session.state.canStop, true);
  gate.reject(new OperationError("network", "底层传输原因"));
  await pending;
  const failed = session.state;
  assert.deepEqual(failed.endpoints[1].error, {
    code: "network",
    message: "底层传输原因",
  });
  assert.throws(() => {
    failed.endpoints[1].error.code = "invalid-input";
  }, TypeError);
  session.setInput(1, "bob");
  assert.equal(session.state.endpoints[1].error, null);
  assert.equal(session.state.canStop, false);
  assert.equal(session.state.canRun, true);
});
