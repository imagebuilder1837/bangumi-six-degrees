import test from "node:test";
import assert from "node:assert/strict";
import { initialize } from "../src/entry.mjs";
import { browser, until } from "./support/browser.mjs";
import { deferred } from "./support/async.mjs";

function start(t, options = {}) {
  const env = browser(options);
  t.after(() => env.window.close());
  const session = initialize(env.window, { fetch: env.fetch });
  session.open();
  return { ...env, session, document: env.window.document };
}

test("成功后历史出现在关系结果下方，展示两端资料、跳数和模式且仅头像可打开主页", async (t) => {
  const { session, document, window } = start(t, {
    profiles: { alice: { name: "爱丽丝" }, bob: { name: "鲍勃" } },
  });
  const section = document.querySelector(".bsd-history");
  assert.ok(section);
  assert.equal(section.hidden, true);
  const body = document.querySelector(".bsd-body");
  body.scrollTop = 23;
  const explore = document.querySelector('[data-action="explore"]');
  explore.focus();
  await session.fill(1, "bob");
  await session.run();
  assert.equal(section.hidden, false);
  assert.ok(section.closest(".bsd-body"));
  assert.ok(
    document.querySelector(".bsd-results").compareDocumentPosition(section) &
      window.Node.DOCUMENT_POSITION_FOLLOWING,
  );
  const row = section.querySelector("li");
  assert.deepEqual(
    [...row.querySelectorAll("strong")].map((node) => node.textContent),
    ["爱丽丝", "鲍勃"],
  );
  assert.match(row.textContent, /@alice/);
  assert.match(row.textContent, /@bob/);
  assert.match(row.querySelector(".bsd-history-result").textContent, /1 跳/);
  assert.match(row.textContent, /双向好友/);
  assert.doesNotMatch(row.textContent, /含排除条件/);
  assert.match(row.querySelector("time").textContent, /\d{2}:\d{2}/);
  const links = [...row.querySelectorAll("a")];
  assert.equal(links.length, 2);
  assert.deepEqual(
    links.map((link) => link.getAttribute("href")),
    ["/user/alice", "/user/bob"],
  );
  for (const link of links) {
    assert.equal(link.target, "_blank");
    assert.ok(link.relList.contains("noopener"));
    assert.ok(link.relList.contains("noreferrer"));
    assert.ok(link.querySelector("img"));
    assert.equal(link.querySelector("strong,small"), null);
  }
  assert.equal(body.scrollTop, 23);
  assert.equal(document.activeElement, explore);
  const avatar = links[0];
  avatar.focus();
  session.close();
  session.open();
  assert.equal(section.querySelector("a"), avatar);
  assert.equal(document.activeElement, avatar);
});

test("清空先确认，取消不改变历史，确认后隐藏整块但保留当前结果并恢复可用焦点", async (t) => {
  const { session, document, window } = start(t);
  await session.fill(1, "bob");
  await session.run();
  const result = session.state.result;
  const path = document.querySelector(".bsd-path");
  const section = document.querySelector(".bsd-history");
  const clear = section.querySelector('button[data-action="clear-history"]');
  assert.ok(clear);
  let accept = false;
  const prompts = [];
  window.confirm = (message) => {
    prompts.push(message);
    return accept;
  };
  clear.focus();
  clear.click();
  assert.equal(session.state.history.entries.length, 1);
  assert.equal(section.hidden, false);
  assert.equal(document.activeElement, clear);
  accept = true;
  clear.click();
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /清空.*探索记录/);
  assert.equal(section.hidden, true);
  assert.equal(section.querySelector("li"), null);
  assert.equal(session.state.result, result);
  assert.equal(document.querySelector(".bsd-path"), path);
  assert.equal(
    document.activeElement,
    document.querySelector('[data-action="explore"]'),
  );
});

test("恢复带排除条件的不可达摘要不联网，资料缓存缺失回退标识和默认头像并提示", async (t) => {
  const first = start(t, { edges: { alice: [], bob: [] } });
  first.session.setExcludedInput("hub");
  await first.session.addExcluded();
  await first.session.fill(1, "bob");
  await first.session.run();
  const next = start(t, {
    indexedDB: null,
    storage: Object.fromEntries(Object.entries(first.window.localStorage)),
  });
  await until(() => next.session.state.history.cacheWarning);
  const row = next.document.querySelector(".bsd-history li");
  assert.ok(row);
  assert.match(row.textContent, /不可达/);
  assert.match(row.textContent, /含排除条件/);
  assert.deepEqual(
    [...row.querySelectorAll("strong")].map((node) => node.textContent),
    ["alice", "bob"],
  );
  for (const img of row.querySelectorAll("img"))
    assert.equal(
      img.getAttribute("src"),
      "https://lain.bgm.tv/pic/user/l/icon.jpg",
    );
  assert.match(
    next.document.querySelector(".bsd-hint").textContent,
    /无法读取用户资料缓存.*探索记录仍保留/,
  );
  assert.equal(next.session.state.endpoints[1].input, "");
  assert.equal(next.session.state.result, null);
  assert.equal(next.urls.length, 0);
});

test("昵称按文字呈现，头像加载失败有回退，编辑当前条件不会移除旧摘要", async (t) => {
  const { session, document, window } = start(t, {
    profiles: { bob: { name: "&lt;img src=x onerror=alert(1)&gt;" } },
  });
  await session.fill(1, "bob");
  await session.run();
  const row = document.querySelector(".bsd-history li");
  const name = row.querySelectorAll("strong")[1];
  assert.equal(name.textContent, "<img src=x onerror=alert(1)>");
  assert.equal(name.querySelector("img"), null);
  const img = row.querySelectorAll("img")[1];
  img.dispatchEvent(new window.Event("error"));
  assert.equal(
    img.getAttribute("src"),
    "https://lain.bgm.tv/pic/user/l/icon.jpg",
  );
  const link = row.querySelector("a");
  link.focus();
  session.setMode("directed");
  session.setInput(1, "other");
  assert.equal(document.querySelector(".bsd-history li"), row);
  assert.equal(document.activeElement, link);
  assert.equal(session.state.result, null);
});

test("探索中仍可清空历史，关闭后完成会生成新摘要，重开不重复搜索", async (t) => {
  const gate = deferred();
  t.after(() => gate.resolve());
  const { session, document, window, urls } = start(t, {
    beforeFetch: async (url) => {
      if (url.endsWith("/bob/friends")) await gate.promise;
    },
  });
  await session.fill(1, "alice");
  await session.run();
  await session.fill(1, "bob");
  const pending = session.run();
  await until(() => session.state.phase === "running");
  const clear = document.querySelector('[data-action="clear-history"]');
  assert.equal(clear.disabled, false);
  window.confirm = () => true;
  clear.focus();
  clear.click();
  assert.equal(session.state.history.entries.length, 0);
  assert.equal(
    document.activeElement,
    document.querySelector('[data-action="stop"]'),
  );
  session.close();
  gate.resolve();
  await pending;
  assert.equal(session.state.visible, false);
  assert.equal(session.state.history.entries.length, 1);
  assert.match(document.querySelector(".bsd-history li").textContent, /@bob/);
  const count = urls.length;
  session.open();
  assert.equal(urls.length, count);
});

test("四处用户资料均仅头像链接，昵称和标识是独立文本且关系路径保留读屏说明", async (t) => {
  const { session, document } = start(t, {
    profiles: { alice: { name: "爱丽丝" }, bob: { name: "鲍勃" } },
  });
  session.setExcludedInput("hub");
  await session.addExcluded();
  await session.fill(1, "bob");
  await session.run();
  for (const selector of [
    ".bsd-endpoint",
    ".bsd-excluded-user",
    ".bsd-path a",
    ".bsd-history-user",
  ]) {
    const block = document.querySelector(selector);
    const avatar = block.matches("a") ? block : block.querySelector("a");
    assert.ok(avatar.querySelector("img"));
    assert.equal(avatar.querySelector("strong,small,input"), null, selector);
    assert.equal(avatar.target, "_blank");
    assert.ok(avatar.relList.contains("noopener"));
    assert.ok(avatar.relList.contains("noreferrer"));
  }
  const path = document.querySelector(".bsd-path");
  assert.deepEqual(
    [...path.querySelectorAll("strong")].map((node) => node.textContent),
    ["爱丽丝", "鲍勃"],
  );
  for (const text of path.querySelectorAll("strong,small"))
    assert.equal(text.closest("a"), null);
  const avatar = path.querySelector("a");
  assert.equal(
    document.getElementById(avatar.getAttribute("aria-describedby"))
      .textContent,
    "@alice 与 @bob 互相添加为好友",
  );
});

test("重复成功摘要前移时保留其头像链接的键盘焦点及滚动位置", async (t) => {
  const { session, document } = start(t);
  await session.fill(1, "bob");
  await session.run();
  const row = document.querySelector(".bsd-history li");
  const link = row.querySelector("a");
  await session.fill(1, "isolated");
  await session.run();
  await session.fill(1, "bob");
  const body = document.querySelector(".bsd-body");
  body.scrollTop = 19;
  link.focus();
  await session.run();
  assert.equal(document.querySelector(".bsd-history li"), row);
  assert.equal(document.activeElement, link);
  assert.equal(body.scrollTop, 19);
});
