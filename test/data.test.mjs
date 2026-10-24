import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { createRelationshipStore } from "../vendor/bangumi-relationship-store/src/index.mjs";
import { createDataSource } from "../src/data.mjs";
import { createSite } from "../src/site.mjs";
import { createRequests } from "../src/requests.mjs";
import { search } from "../src/search.mjs";
import { browser } from "./support/browser.mjs";

test("网络取数不复用旧关系，运行内去重并提交扫描资料", async () => {
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
  const live = createDataSource({ store, site });
  const records = await live.load([["alice", "friends"]]);
  assert.deepEqual(records[0].snapshot.members, ["bob"]);
  assert.equal((await live.users(["bob"])).get("bob").name, "新昵称");
  await live.load([["alice", "friends"]]);
  assert.equal(env.urls.length, 1);
  const saved = await store.read({
    relationships: [["alice", "friends"]],
    users: ["bob"],
  });
  assert.deepEqual(saved.relationships.alice.friends.members, ["bob"]);
  assert.equal(saved.users.bob.avatar, "https://lain.bgm.tv/bob.jpg");
  const next = createDataSource({ store, site });
  await next.load([["alice", "friends"]]);
  assert.equal(env.urls.length, 2);
  env.window.close();
});

test("存储不可用不阻止网络取数", async () => {
  const store = createRelationshipStore({ indexedDB: undefined });
  const env = browser();
  const warnings = [];
  const live = createDataSource({
    store,
    site: createSite({
      window: env.window,
      requests: createRequests({ fetch: env.fetch }),
    }),
    onWarning: (warning) => warnings.push(warning),
  });
  assert.equal(await live.estimate([["alice", "friends"]]), 2);
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
  await assert.rejects(
    createDataSource({ store, site }).load([["alice", "friends"]]),
    /403/,
  );
  const saved = await store.read({ relationships: [["alice", "friends"]] });
  assert.deepEqual(saved.relationships.alice.friends.members, ["old"]);
  env.window.close();
});

test("旧关系仅影响扩展成本，不进入网络证明或展示资料", async () => {
  const store = createRelationshipStore({ indexedDB: new IDBFactory() });
  await store.commit({
    relationships: {
      alice: {
        friends: { status: "available", members: ["bob"], fetchedAt: 1 },
      },
    },
    users: { ghost: { name: "旧昵称", avatar: "", fetchedAt: 1 } },
  });
  const env = browser({ edges: { alice: [], bob: [] } });
  const live = createDataSource({
    store,
    site: createSite({
      window: env.window,
      requests: createRequests({ fetch: env.fetch }),
    }),
  });
  assert.equal(await live.estimate([["alice", "friends"]]), 1.01);
  assert.equal((await live.users(["ghost"])).get("ghost").name, "ghost");
  const result = await search({
    start: "alice",
    end: "bob",
    mode: "directed",
    source: live,
  });
  assert.equal(result.status, "unreachable");
  assert.ok(env.urls.length > 0);
  env.window.close();
});
