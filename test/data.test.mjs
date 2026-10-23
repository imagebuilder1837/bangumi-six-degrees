import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createRelationshipStore } from "../vendor/bangumi-relationship-store/src/index.mjs";
import { createDataSource } from "../src/data.mjs";
import { createSite } from "../src/site.mjs";
import { createRequests } from "../src/requests.mjs";
import { browser } from "./support/browser.mjs";

test("主动获取不复用旧关系，并把扫描头像昵称提供给缓存模式", async () => {
  const store = createRelationshipStore({ indexedDB: new IDBFactory() });
  await store.commit({
    relationships: {
      alice: {
        friends: { status: "available", members: ["old"], fetchedAt: 1 },
      },
    },
  });
  const env = browser({ profiles: { bob: { name: "新昵称" } } });
  const site = createSite({
    window: env.window,
    requests: createRequests({ fetch: env.fetch }),
  });
  const live = createDataSource({ kind: "network", store, site });
  const records = await live.load([["alice", "friends"]]);
  assert.deepEqual(records[0].snapshot.members, ["bob"]);
  assert.equal((await live.users(["bob"])).get("bob").name, "新昵称");
  await live.load([["alice", "friends"]]);
  assert.equal(env.urls.length, 1);
  const cached = createDataSource({ kind: "cache", store });
  assert.deepEqual(
    (await cached.load([["alice", "friends"]]))[0].snapshot.members,
    ["bob"],
  );
  assert.equal(
    (await cached.users(["bob"])).get("bob").avatar,
    "https://lain.bgm.tv/bob.jpg",
  );
  env.window.close();
});

test("存储不可用不阻止网络搜索，也不会把请求失败存成空关系", async () => {
  const store = createRelationshipStore({ indexedDB: undefined });
  const env = browser();
  const warnings = [];
  const live = createDataSource({
    kind: "network",
    store,
    site: createSite({
      window: env.window,
      requests: createRequests({ fetch: env.fetch }),
    }),
    onWarning: (warning) => warnings.push(warning),
  });
  assert.deepEqual(
    (await live.load([["alice", "friends"]]))[0].snapshot.members,
    ["bob"],
  );
  assert.equal(warnings.length, 1);
  env.window.close();
});

test("HTTP 失败保留旧观察，不写空关系或原站错误声明", async () => {
  const store = createRelationshipStore({ indexedDB: new IDBFactory() });
  await store.commit({
    relationships: {
      alice: {
        friends: { status: "available", members: ["old"], fetchedAt: 1 },
      },
    },
  });
  const env = browser();
  const site = createSite({
    window: env.window,
    requests: createRequests({
      fetch: async () => new Response("", { status: 403 }),
    }),
  });
  const source = createDataSource({ kind: "network", store, site });
  await assert.rejects(source.load([["alice", "friends"]]), /403/);
  const cache = createDataSource({ kind: "cache", store });
  assert.deepEqual(
    (await cache.load([["alice", "friends"]]))[0].snapshot.members,
    ["old"],
  );
  env.window.close();
});

test("缓存模式读取关系及扫描资料，不把缺失键变成空关系", async () => {
  const store = createRelationshipStore({ indexedDB: new IDBFactory() });
  await store.commit({
    relationships: {
      alice: {
        friends: { status: "available", members: ["bob"], fetchedAt: 1 },
      },
    },
    users: {
      bob: {
        name: "鲍勃",
        avatar: "https://lain.bgm.tv/bob.jpg",
        fetchedAt: 1,
      },
    },
  });
  const source = createDataSource({ kind: "cache", store });
  const records = await source.load([
    ["alice", "friends"],
    ["missing", "friends"],
  ]);
  assert.deepEqual(
    records.map((record) => record.id),
    ["alice"],
  );
  assert.equal((await source.users(["bob"])).get("bob").name, "鲍勃");
});
