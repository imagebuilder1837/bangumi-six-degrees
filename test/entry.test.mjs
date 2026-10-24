import test from "node:test";
import assert from "node:assert/strict";
import { initialize } from "../src/entry.mjs";
import { browser, input, until } from "./support/browser.mjs";
import { deferred } from "./support/async.mjs";

test("三个域的自己及其他用户主页使用 network_service 入口，列表页不挂载", () => {
  for (const host of ["bgm.tv", "bangumi.tv", "chii.in"]) {
    for (const current of ["alice", "self"]) {
      const env = browser({ current, url: `https://${host}/user/${current}/` });
      const session = initialize(env.window, { fetch: env.fetch });
      const document = env.window.document;
      const entry = document.querySelector(
        "#user_home .user_box ul.network_service #bangumi-six-degrees-entry",
      );
      assert.ok(entry);
      entry.querySelector("a").click();
      assert.equal(session.state.visible, true);
      assert.deepEqual(session.state.inputs, [current, ""]);
      assert.equal(env.urls.length, 0);
      assert.equal(document.querySelector(".bsd-launcher"), null);
      env.window.close();
    }
  }
  for (const path of ["friends", "rev_friends", "timeline", "blog"]) {
    const env = browser({ url: `https://bgm.tv/user/alice/${path}` });
    assert.equal(initialize(env.window, { fetch: env.fetch }), undefined);
    assert.equal(
      env.window.document.querySelector("#bangumi-six-degrees-entry"),
      null,
    );
    env.window.close();
  }
});

test("关系选项顺序及默认值一致，快捷项提供填入自己和随机班友", () => {
  const env = browser();
  initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  const select = document.querySelector("select");
  assert.deepEqual(
    [...select.options].map((option) => option.textContent),
    ["双向好友", "单向好友", "无向关联"],
  );
  assert.equal(select.selectedOptions[0].textContent, "双向好友");
  for (const endpoint of document.querySelectorAll(".bsd-endpoint")) {
    assert.deepEqual(
      [...endpoint.querySelectorAll("button")].map(
        (button) => button.textContent,
      ),
      ["填入自己", "随机班友"],
    );
  }
  document.querySelector('[aria-label="关闭六度分隔"]').click();
  assert.equal(
    document.activeElement,
    document.querySelector("#bangumi-six-degrees-entry a"),
  );
  env.window.close();
});

test("输入仅提示用户标识，UID 及主页链接仍可在内部归一", async () => {
  const env = browser({ aliases: { 2: "bob" } });
  const session = initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  for (const field of document.querySelectorAll(".bsd-endpoint input"))
    assert.equal(field.placeholder, "请输入用户标识");
  for (const value of ["bad/name", "https://example.com/user/bob"]) {
    input(env.window, "终点用户", value);
    await until(() => session.state.errors[1]);
    assert.equal(
      document.querySelector('[data-endpoint="1"] .bsd-error').textContent,
      "请输入有效的用户标识",
    );
  }
  assert.equal(env.urls.length, 0);
  for (const value of ["2", "https://bangumi.tv/user/2"]) {
    input(env.window, "终点用户", value);
    await until(() => session.state.endpoints[1]?.id === "bob");
    assert.equal(
      document.querySelector('input[aria-label="终点用户"]').value,
      "bob",
    );
  }
  env.window.close();
});

test("头像仅链接已确认的规范用户主页，解析、交换及清空时同步更新", async () => {
  const gate = deferred();
  const env = browser({
    aliases: { 2: "bob" },
    profiles: { alice: { name: "爱丽丝" }, bob: { name: "鲍勃" } },
    beforeFetch: async (url) => {
      if (url.endsWith("/user/2")) await gate.promise;
    },
  });
  const session = initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  const profiles = [...document.querySelectorAll(".bsd-avatar-link")];
  const names = [...document.querySelectorAll(".bsd-endpoint-name")];
  assert.deepEqual(
    names.map((name) => name.textContent),
    ["爱丽丝", ""],
  );
  assert.equal(profiles[0].getAttribute("href"), "/user/alice");
  assert.equal(profiles[1].hasAttribute("href"), false);
  input(env.window, "终点用户", "2");
  assert.equal(profiles[1].hasAttribute("href"), false);
  gate.resolve();
  await until(() => session.state.endpoints[1]?.id === "bob");
  assert.equal(names[1].textContent, "鲍勃");
  assert.equal(names[1].title, "鲍勃");
  assert.equal(profiles[1].getAttribute("href"), "/user/bob");
  assert.equal(profiles[1].target, "_blank");
  assert.equal(profiles[1].rel, "noopener noreferrer");
  assert.equal(profiles[1].getAttribute("aria-label"), "打开 @bob 的主页");
  document.querySelector('[data-action="swap"]').click();
  assert.deepEqual(
    profiles.map((link) => link.getAttribute("href")),
    ["/user/bob", "/user/alice"],
  );
  assert.deepEqual(
    names.map((name) => name.textContent),
    ["鲍勃", "爱丽丝"],
  );
  input(env.window, "起点用户", "");
  assert.equal(profiles[0].hasAttribute("href"), false);
  assert.equal(profiles[0].hasAttribute("aria-label"), false);
  assert.equal(names[0].textContent, "");
  assert.equal(names[0].title, "");
  input(env.window, "终点用户", "bad/name");
  await until(() => session.state.errors[1]);
  assert.equal(profiles[1].hasAttribute("href"), false);
  assert.equal(names[1].textContent, "");
  env.window.close();
});

test("缺少原站牌子容器或存储被拒绝时不会破坏页面", () => {
  const missing = browser();
  missing.window.document.querySelector(".network_service").remove();
  assert.equal(initialize(missing.window, { fetch: missing.fetch }), undefined);
  missing.window.close();
  const denied = browser();
  Object.defineProperty(denied.window, "localStorage", {
    get() {
      throw new Error("denied");
    },
  });
  const session = initialize(denied.window, { fetch: denied.fetch });
  session.open();
  assert.deepEqual(session.state.inputs, ["alice", ""]);
  assert.equal(denied.urls.length, 0);
  denied.window.close();
});
