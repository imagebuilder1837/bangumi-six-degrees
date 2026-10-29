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
      assert.deepEqual(
        session.state.endpoints.map(({ input }) => input),
        [current, ""],
      );
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

test("昵称去链接在初始化前后执行均不影响入口和端点资料", async (t) => {
  for (const order of ["before", "after"]) {
    const env = browser({ profiles: { alice: { name: "Alice@家 🖖" } } });
    t.after(() => env.window.close());
    const { document } = env.window;
    const name = document.querySelector("#headerProfile .name");
    const div = document.createElement("div");
    div.className = "name";
    div.innerHTML = name.innerHTML;
    name.replaceWith(div);
    const removeLinks = () => {
      for (const link of document.querySelectorAll(
        'div.name a[href*="/user/"]',
      ))
        link.replaceWith(document.createTextNode(link.textContent));
    };
    const observer = new env.window.MutationObserver(removeLinks);
    observer.observe(document.body, { childList: true, subtree: true });
    if (order === "before") removeLinks();
    const session = initialize(env.window, { fetch: env.fetch });
    if (order === "after") removeLinks();
    await Promise.resolve();
    observer.disconnect();
    assert.ok(document.querySelector("#bangumi-six-degrees-entry"));
    assert.equal(div.querySelector("a"), null);
    document.querySelector("#bangumi-six-degrees-entry a").click();
    assert.equal(session.state.visible, true);
    assert.equal(session.state.endpoints[0].user.id, "alice");
    assert.equal(
      document.querySelector(".bsd-endpoint-name").textContent,
      "Alice@家 🖖",
    );
    assert.equal(
      document.querySelector(".bsd-avatar-link").getAttribute("href"),
      "/user/alice",
    );
    assert.equal(env.urls.length, 0);
  }
});

test("当前主页以浏览器最终路径预填身份，不依赖昵称区身份且不额外请求", (t) => {
  for (const [path, expected] of [
    ["sai", "sai"],
    ["yu_nagi/", "yu_nagi"],
    ["634419", "634419"],
    ["%61lice?foo=1#profile", "alice"],
  ]) {
    const env = browser({
      current: "other",
      url: `https://bgm.tv/user/${path}`,
    });
    t.after(() => env.window.close());
    const session = initialize(env.window, { fetch: env.fetch });
    assert.equal(session.state.endpoints[0].input, expected);
    assert.equal(session.state.endpoints[0].user.id, expected);
    assert.equal(
      env.window.document
        .querySelector(".bsd-avatar-link")
        .getAttribute("href"),
      `/user/${expected}`,
    );
    assert.equal(env.urls.length, 0);
  }
});

test("主页昵称排除附属标记且不改变原站内容，资料缺失时仍可打开入口", (t) => {
  for (const [markup, expected] of [
    [
      '<a href="/user/alice">Alice@家 🖖</a> <small class="grey">@alice</small><span id="friend_flag">好友</span>',
      "Alice@家 🖖",
    ],
    [
      'Alice@家 🖖 <small class="grey">@alice</small><span id="friend_flag">好友</span>',
      "Alice@家 🖖",
    ],
    [
      ' <small class="grey">@alice</small><span id="friend_flag">好友</span>',
      "alice",
    ],
    [null, "alice"],
  ]) {
    const env = browser();
    t.after(() => env.window.close());
    const { document } = env.window;
    const name = document.querySelector("#headerProfile .name");
    if (markup === null) document.querySelector("#headerProfile").remove();
    else name.innerHTML = markup;
    document.querySelector("#headerProfile .avatarNeue")?.remove();
    const before = document.querySelector("#headerProfile")?.outerHTML;
    const session = initialize(env.window, { fetch: env.fetch });
    document.querySelector("#bangumi-six-degrees-entry a").click();
    assert.equal(session.state.visible, true);
    assert.equal(
      document.querySelector(".bsd-endpoint-name").textContent,
      expected,
    );
    assert.equal(
      document.querySelector(".bsd-avatar").getAttribute("src"),
      "https://lain.bgm.tv/pic/user/l/icon.jpg",
    );
    assert.equal(document.querySelector("#headerProfile")?.outerHTML, before);
    assert.equal(env.urls.length, 0);
  }
});

test("当前主页拒绝解码后无效的用户标识且不发起请求", (t) => {
  for (const path of ["%ZZ", "a%2Fb", "%20", "%40alice", "a%3Fb", "a%23b"]) {
    const env = browser({ url: `https://bgm.tv/user/${path}` });
    t.after(() => env.window.close());
    assert.equal(initialize(env.window, { fetch: env.fetch }), undefined);
    assert.equal(
      env.window.document.querySelector("#bangumi-six-degrees-entry"),
      null,
    );
    assert.equal(env.urls.length, 0);
  }
});

test("关系选项顺序及默认值一致，快捷项提供填入自己和随机班友", () => {
  const env = browser();
  initialize(env.window, { fetch: env.fetch });
  const document = env.window.document;
  document.querySelector('[aria-label="六度分隔"]').click();
  document.querySelector('[role="combobox"]').click();
  assert.deepEqual(
    [...document.querySelectorAll('[role="option"]')].map(
      (option) => option.textContent,
    ),
    ["双向好友", "单向好友", "无向关联"],
  );
  assert.equal(
    document.querySelector('[role="option"][aria-selected="true"]').textContent,
    "双向好友",
  );
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
    await until(() => session.state.endpoints[1].error);
    assert.equal(
      document.querySelector(".bsd-hint").textContent,
      "请输入有效的终点用户标识",
    );
  }
  assert.equal(env.urls.length, 0);
  for (const value of ["2", "https://bangumi.tv/user/2"]) {
    input(env.window, "终点用户", value);
    await until(() => session.state.endpoints[1].user?.id === "bob");
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
  await until(() => session.state.endpoints[1].user?.id === "bob");
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
  await until(() => session.state.endpoints[1].error);
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
  assert.deepEqual(
    session.state.endpoints.map(({ input }) => input),
    ["alice", ""],
  );
  assert.equal(denied.urls.length, 0);
  denied.window.close();
});
