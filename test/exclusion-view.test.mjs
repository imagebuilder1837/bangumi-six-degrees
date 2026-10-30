import test from "node:test";
import assert from "node:assert/strict";
import { initialize } from "../src/entry.mjs";
import { browser, until } from "./support/browser.mjs";
import { deferred } from "./support/async.mjs";

function enter(window, element, options = {}) {
  element.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
}
function type(window, element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test("排除管理区默认收起，固定文案入口展开后可核验添加及移除", async (t) => {
  const env = browser({ profiles: { hub: { name: "中转班友" } } });
  t.after(() => env.window.close());
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  document.querySelector(".bsd-entry-link").click();
  const toggle = document.querySelector('[data-action="toggle-exclusions"]');
  assert.ok(toggle);
  const panel = document.getElementById(toggle.getAttribute("aria-controls"));
  assert.equal(toggle.textContent, "排除中转");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  toggle.click();
  assert.equal(panel.hidden, false);
  const input = panel.querySelector("input");
  type(env.window, input, "https://chii.in/user/hub");
  enter(env.window, input);
  await until(() => panel.querySelector(".bsd-excluded-user"));
  assert.match(panel.textContent, /中转班友/);
  assert.match(panel.textContent, /@hub/);
  const profile = panel.querySelector(".bsd-excluded-user a");
  assert.ok(profile?.querySelector("img"));
  assert.equal(profile.getAttribute("href"), "/user/hub");
  assert.equal(profile.target, "_blank");
  assert.ok(profile.relList.contains("noopener"));
  assert.ok(profile.relList.contains("noreferrer"));
  assert.equal(profile.getAttribute("aria-label"), "打开 @hub 的主页");
  assert.equal(input.value, "");
  assert.equal(toggle.textContent, "排除中转");
  panel.querySelector('[data-remove="hub"]').click();
  assert.equal(panel.querySelector(".bsd-excluded-user"), null);
  assert.equal(session.state.exclusions.users.length, 0);
});

test("排除输入框获得焦点时不主动全选，编辑期间保留光标与选区", (t) => {
  const env = browser();
  t.after(() => env.window.close());
  initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  document.querySelector(".bsd-entry-link").click();
  const toggle = document.querySelector('[data-action="toggle-exclusions"]');
  toggle.click();
  const input = document.querySelector(".bsd-exclusions input");
  type(env.window, input, "puson_pp");
  for (const keyboard of [false, true]) {
    toggle.focus();
    if (keyboard)
      toggle.dispatchEvent(
        new env.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    else
      input.dispatchEvent(
        new env.window.Event("pointerdown", { bubbles: true }),
      );
    input.setSelectionRange(3, 3);
    input.focus();
    assert.equal(input.selectionStart, 3);
    assert.equal(input.selectionEnd, 3);
    input.setSelectionRange(2, 4);
    input.dispatchEvent(new env.window.Event("input", { bubbles: true }));
    assert.equal(input.selectionStart, 2);
    assert.equal(input.selectionEnd, 4);
  }
});

test("排除后的不可达结果说明结论范围，名单可查看但运行中禁止增删", async (t) => {
  const env = browser({
    edges: { alice: ["hub"], hub: ["alice", "bob"], bob: ["hub"] },
  });
  t.after(() => env.window.close());
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  document.querySelector(".bsd-entry-link").click();
  const toggle = document.querySelector('[data-action="toggle-exclusions"]');
  toggle.click();
  const input = document.querySelector(".bsd-exclusions input");
  type(env.window, input, "hub");
  await session.addExcluded();
  await session.fill(1, "bob");
  const pending = session.run();
  await until(() => session.state.phase === "running");
  assert.equal(input.disabled, true);
  assert.equal(document.querySelector('[data-remove="hub"]').disabled, true);
  assert.equal(toggle.disabled, false);
  await pending;
  assert.equal(session.state.result.status, "unreachable");
  assert.match(document.querySelector(".bsd-detail").textContent, /排除条件/);
  assert.equal(input.disabled, false);
});

test("核验时禁止探索，关闭仅隐藏，可取消且不接受迟到响应", async (t) => {
  const gate = deferred();
  const env = browser({
    beforeFetch: async (url) => {
      if (url.endsWith("/user/slow")) await gate.promise;
    },
  });
  t.after(() => {
    gate.resolve();
    env.window.close();
  });
  const session = initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  const launch = document.querySelector(".bsd-entry-link");
  launch.click();
  document.querySelector('[data-action="toggle-exclusions"]').click();
  const input = document.querySelector(".bsd-exclusions input");
  type(env.window, input, "slow");
  const add = document.querySelector('[data-action="add-excluded"]');
  add.focus();
  add.click();
  const stop = document.querySelector('[data-action="stop"]');
  assert.equal(document.activeElement, stop);
  assert.equal(stop.hidden, false);
  assert.equal(stop.disabled, false);
  assert.equal(
    document.querySelector('[data-action="explore"]').disabled,
    true,
  );
  document.querySelector(".bsd-close").click();
  launch.click();
  assert.equal(session.state.exclusions.activity, "resolving");
  stop.focus();
  stop.click();
  assert.equal(
    document.activeElement,
    document.querySelector('[data-action="explore"]'),
  );
  assert.equal(
    document.querySelector('[data-action="explore"]').disabled,
    false,
  );
  type(env.window, input, "new-draft");
  gate.resolve();
  await until(() => session.state.exclusions.activity === "idle");
  assert.equal(input.value, "new-draft");
  assert.equal(document.querySelector(".bsd-excluded-user"), null);
});

test("新页面只恢复名单和共享资料，不联网刷新、不恢复端点或展开状态", async (t) => {
  const first = browser({
    profiles: { hub: { name: "&lt;img src=x onerror=alert(1)&gt;" } },
  });
  t.after(() => first.window.close());
  const firstSession = initialize(first.window, { fetch: first.fetch });
  firstSession.setExcludedInput("hub");
  await firstSession.addExcluded();
  const next = browser({
    indexedDB: first.indexedDB,
    storage: Object.fromEntries(Object.entries(first.window.localStorage)),
  });
  t.after(() => next.window.close());
  const session = initialize(next.window, { fetch: next.fetch });
  session.open();
  await until(() => session.state.exclusions.users[0]?.name.startsWith("<img"));
  const panel = next.window.document.getElementById("bsd-exclusions");
  assert.equal(panel.hidden, true);
  assert.equal(
    panel.querySelector("strong").textContent,
    "<img src=x onerror=alert(1)>",
  );
  assert.equal(panel.querySelector("strong img"), null);
  assert.equal(session.state.endpoints[1].input, "");
  assert.equal(next.urls.length, 0);
});

test("名单存储不可用时，即使管理区收起也明确提示", (t) => {
  const env = browser();
  t.after(() => env.window.close());
  Object.defineProperty(env.window, "localStorage", {
    get() {
      throw new Error("denied");
    },
  });
  initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  document.querySelector(".bsd-entry-link").click();
  assert.equal(document.getElementById("bsd-exclusions").hidden, true);
  assert.match(
    document.querySelector(".bsd-hint").textContent,
    /无法读取排除名单/,
  );
});

test("关闭重开保留展开状态和输入，Escape 依次关闭模式菜单、名单和弹窗", (t) => {
  const env = browser();
  t.after(() => env.window.close());
  initialize(env.window, { fetch: env.fetch });
  const { document } = env.window;
  const launch = document.querySelector(".bsd-entry-link");
  launch.click();
  const toggle = document.querySelector('[data-action="toggle-exclusions"]');
  const panel = document.getElementById("bsd-exclusions");
  toggle.click();
  const input = panel.querySelector("input");
  type(env.window, input, "draft");
  enter(env.window, input, { isComposing: true });
  assert.equal(env.urls.length, 0);
  document.querySelector(".bsd-close").click();
  launch.click();
  assert.equal(panel.hidden, false);
  assert.equal(input.value, "draft");
  const mode = document.querySelector(".bsd-mode-trigger");
  mode.click();
  const escape = () =>
    document.activeElement.dispatchEvent(
      new env.window.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  escape();
  assert.equal(panel.hidden, false);
  assert.equal(document.activeElement, mode);
  escape();
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, toggle);
  escape();
  assert.equal(document.activeElement, launch);
});
