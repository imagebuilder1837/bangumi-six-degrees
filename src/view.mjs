import { styles } from "./styles.mjs";
const defaultAvatar = "https://lain.bgm.tv/pic/user/l/icon.jpg";
const arrows = { undirected: "—", directed: "→", mutual: "↔" };
function image(element, url) {
  const src = url || defaultAvatar;
  if (element.getAttribute("src") === src) return;
  element.onerror = () => {
    element.onerror = null;
    element.src = defaultAvatar;
  };
  element.src = src;
}
export function mountView(window, session, { self, services }) {
  const { document } = window;
  const style = document.createElement("style");
  style.textContent = styles;
  document.head.append(style);
  const entry = document.createElement("li");
  entry.id = "bangumi-six-degrees-entry";
  const badge = document.createElement("span");
  badge.className = "service";
  badge.style.backgroundColor = "#7756A8";
  badge.style.color = "#fff";
  badge.textContent = "SixDegrees";
  const launcher = document.createElement("a");
  launcher.href = "#";
  launcher.className = "l bsd-entry-link";
  launcher.setAttribute("aria-label", "六度分隔");
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.textContent = "六度分隔";
  entry.append(badge, document.createTextNode(" "), launcher);
  services.append(entry);
  const overlay = document.createElement("div");
  overlay.className = "bsd-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<section class="bsd-dialog" role="dialog" aria-modal="true" aria-labelledby="bsd-title" hidden>
    <header class="bsd-header"><div><h2 id="bsd-title">六度分隔</h2><small>你与 TA，相隔几位班友？</small></div><button type="button" class="bsd-close" aria-label="关闭六度分隔">×</button></header>
    <div class="bsd-body"><div class="bsd-top">
      ${endpoint("起点用户", 0)}
      <div class="bsd-bridge"><select aria-label="关系模式"><option value="mutual">双向好友</option><option value="directed">单向好友</option><option value="undirected">无向关联</option></select><span class="bsd-arrow" aria-hidden="true">↔</span></div>
      ${endpoint("终点用户", 1)}
    </div><div class="bsd-swap-row"><button type="button" class="bsd-swap" data-action="swap">⇄ 交换起点与终点</button></div>
    <div class="bsd-results"><p class="bsd-message" role="status"></p><div class="bsd-progress"></div><div class="bsd-output"></div><p class="bsd-warning"></p></div></div>
    <footer class="bsd-footer"><button type="button" data-action="stop" hidden>停止</button><button type="button" data-action="explore">探索</button></footer>
  </section>`;
  function endpoint(label, index) {
    return `<div class="bsd-endpoint" data-endpoint="${index}"><a class="bsd-avatar-link" target="_blank" rel="noopener noreferrer"><img class="bsd-avatar" alt=""></a><div><strong class="bsd-endpoint-name"></strong><label class="bsd-input"><span>@</span><input aria-label="${label}" placeholder="请输入用户标识" autocomplete="off" spellcheck="false"></label><div class="bsd-shortcuts"><button type="button" data-fill="self" title="填入自己">填入自己</button><button type="button" data-action="random">随机班友</button></div><small class="bsd-error" aria-live="polite"></small></div></div>`;
  }
  document.body.append(overlay);
  const dialog = overlay.querySelector('[role="dialog"]');
  const select = overlay.querySelector("select");
  const explore = overlay.querySelector('[data-action="explore"]');
  const stop = overlay.querySelector('[data-action="stop"]');
  const endpoints = [...overlay.querySelectorAll(".bsd-endpoint")];
  endpoints.forEach((element, index) => {
    const input = element.querySelector("input");
    input.addEventListener("input", () => session.setInput(index, input.value));
    input.addEventListener("blur", () => {
      if (!["running", "resolving"].includes(session.state.phase))
        void session.resolve(index);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void session.run();
      }
    });
    element
      .querySelector('[data-fill="self"]')
      .addEventListener("click", () => void session.fill(index, self));
    element
      .querySelector('[data-action="random"]')
      .addEventListener("click", () => void session.random(index));
  });
  select.addEventListener("change", () => session.setMode(select.value));
  overlay
    .querySelector('[data-action="swap"]')
    .addEventListener("click", () => session.swap());
  explore.addEventListener("click", () => void session.run());
  stop.addEventListener("click", () => session.stop());
  const close = () => {
    session.close();
    launcher.focus();
  };
  overlay.querySelector(".bsd-close").addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...dialog.querySelectorAll(
        "button:not(:disabled):not([hidden]),input:not(:disabled),select:not(:disabled),a[href]",
      ),
    ];
    const first = focusable[0],
      last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  launcher.addEventListener("click", (event) => {
    event.preventDefault();
    session.open();
    (
      dialog.querySelector("input:not(:disabled)") ??
      dialog.querySelector("button")
    )?.focus();
  });
  let lastResult;
  session.subscribe((state) => {
    overlay.hidden = !state.visible;
    dialog.hidden = !state.visible;
    const busy = ["running", "resolving"].includes(state.phase);
    endpoints.forEach((element, index) => {
      const input = element.querySelector("input");
      if (input.value !== state.inputs[index])
        input.value = state.inputs[index];
      input.disabled = busy;
      input.setAttribute("aria-invalid", String(!!state.errors[index]));
      const user = state.endpoints[index];
      const name = element.querySelector(".bsd-endpoint-name");
      name.textContent = user?.name || user?.id || "";
      name.title = name.textContent;
      image(element.querySelector("img"), user?.avatar);
      const profile = element.querySelector(".bsd-avatar-link");
      if (user) {
        profile.href = `/user/${encodeURIComponent(user.id)}`;
        profile.setAttribute("aria-label", `打开 @${user.id} 的主页`);
      } else {
        profile.removeAttribute("href");
        profile.removeAttribute("aria-label");
      }
      element.querySelector(".bsd-error").textContent = state.randomizing[index]
        ? "正在抽取班友…"
        : state.resolving[index]
          ? "正在确认用户…"
          : state.errors[index];
      const selfButton = element.querySelector('[data-fill="self"]');
      selfButton.disabled = busy || !self;
      selfButton.title = self ? "填入自己" : "无法识别登录用户";
      const randomButton = element.querySelector('[data-action="random"]');
      randomButton.disabled = busy;
      randomButton.setAttribute("aria-busy", String(state.randomizing[index]));
    });
    select.value = state.mode;
    select.disabled = busy;
    overlay.querySelector(".bsd-arrow").textContent = arrows[state.mode];
    overlay.querySelector('[data-action="swap"]').disabled = busy;
    explore.disabled = busy || state.randomizing.some(Boolean);
    stop.hidden = !busy && !state.resolving.some(Boolean);
    overlay.querySelector(".bsd-message").textContent = state.message;
    overlay.querySelector(".bsd-progress").textContent =
      state.phase === "running"
        ? `已触达 ${state.progress.visited} 位用户 · ${session.requestCount()} 次请求 · 已读取 ${state.progress.observations} 份关系列表`
        : "";
    overlay.querySelector(".bsd-warning").textContent = state.warning;
    if (lastResult === state.result) return;
    lastResult = state.result;
    const output = overlay.querySelector(".bsd-output");
    output.replaceChildren();
    delete output.dataset.result;
    if (!state.result) return;
    output.dataset.result = state.result.status;
    if (state.result.status !== "found") return;
    const path = document.createElement("div");
    path.className = "bsd-path";
    state.result.path.forEach((user, index) => {
      if (index) {
        const arrow = document.createElement("span");
        arrow.className = "bsd-link";
        arrow.textContent = arrows[state.result.conditions.mode];
        path.append(arrow);
      }
      const link = document.createElement("a");
      link.href = `/user/${encodeURIComponent(user.id)}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const avatar = document.createElement("img");
      avatar.alt = "";
      image(avatar, user.avatar);
      const name = document.createElement("strong");
      name.textContent = user.name || user.id;
      const id = document.createElement("small");
      id.textContent = `@${user.id}`;
      link.append(avatar, name, id);
      path.append(link);
    });
    output.append(path);
    if (state.result.path.length > 7) {
      const egg = document.createElement("p");
      egg.className = "bsd-egg";
      egg.textContent = "六度之外，还有班友。世界比想象中大一点点 ✨";
      output.append(egg);
    }
  });
  return launcher;
}
