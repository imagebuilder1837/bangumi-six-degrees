const hosts = new Set(["bgm.tv", "bangumi.tv", "chii.in"]);
function identifier(value) {
  if (!value || /[\s/?#@]/u.test(value))
    throw new Error("请输入有效的用户标识");
  return value;
}
export function normalizeInput(input) {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) {
    const url = new URL(text);
    const match = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
    if (!hosts.has(url.host) || url.username || url.password || !match)
      throw new Error("请输入有效的用户标识");
    return identifier(decodeURIComponent(match[1]));
  }
  return identifier(text.replace(/^@/, ""));
}
function identity(document, base) {
  const anchor = document.querySelector(
    "#headerProfile h1.nameSingle .inner > .name > a[href]",
  );
  if (!anchor) throw new Error("无法识别主页用户，请检查原站页面");
  const url = new URL(anchor.getAttribute("href"), base);
  const match = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
  if (url.origin !== new URL(base).origin || !match)
    throw new Error("无法识别主页用户");
  const current = anchor.parentElement
    .querySelector("small.grey")
    ?.textContent.trim();
  return identifier(
    current?.startsWith("@") ? current.slice(1) : decodeURIComponent(match[1]),
  );
}
function avatar(element, base) {
  const raw = element?.style.backgroundImage;
  const image = raw && /^url\(["']?(.*?)["']?\)$/.exec(raw)?.[1];
  if (!image) return "";
  const url = new URL(image, base);
  return ["http:", "https:"].includes(url.protocol) ? url.href : "";
}
export function readUser(document, base) {
  const id = identity(document, base);
  return {
    id,
    name:
      document.querySelector("#headerProfile .name > a")?.textContent.trim() ||
      id,
    avatar: avatar(document.querySelector("#headerProfile .avatarNeue"), base),
  };
}
export function readHome(document, base) {
  const user = readUser(document, base);
  const origin = new URL(base).origin;
  const anchor = document.querySelector(
    '#headerProfile .navTabs a[href$="/friends"]',
  );
  if (!anchor) throw new Error("缺少好友链接");
  const friends = new URL(anchor.getAttribute("href"), base);
  if (
    friends.origin !== origin ||
    friends.pathname !== `/user/${encodeURIComponent(user.id)}/friends`
  )
    throw new Error("好友链接身份不匹配");
  return { ...user, friendsUrl: friends.href };
}
function missingUser(document) {
  const notice = document.querySelector("#colunmNotice");
  return (
    !document.querySelector("#headerProfile, #memberUserList") &&
    notice?.querySelector("h2")?.textContent.trim() === "呜咕，出错了" &&
    notice.querySelector("p.text")?.textContent.trim() ===
      "数据库中没有查询到该用户的信息" &&
    !!notice.querySelector('img[src="/img/bangumi/404.png"]')
  );
}
function unavailable(document) {
  const notice = document.querySelector("#colunmNotice");
  return (
    !document.querySelector("#headerProfile, #memberUserList") &&
    notice?.querySelector("h2")?.textContent.trim() === "呜咕，出错了" &&
    notice.querySelector("p.text")?.textContent.trim() ===
      "啊噢，你访问的页面似乎被 Bangumi 娘吃掉了。" &&
    !!notice.querySelector('img[src="/img/bangumi/404.png"]')
  );
}
export function readRelationships(window, html, owner, base, name) {
  const document = new window.DOMParser().parseFromString(html, "text/html");
  if (name === "[已注销]" && unavailable(document))
    return { status: "unavailable", members: [], pages: [] };
  if (identity(document, base) !== owner) throw new Error("关系页面身份不匹配");
  const list = document.querySelector("#memberUserList.usersMedium");
  if (
    !list ||
    [...list.childNodes].some(
      (node) => node.nodeType === 3 && node.textContent.trim(),
    )
  )
    throw new Error("无法识别好友列表");
  const members = new Map();
  let missingIdentifiers = 0;
  for (const item of list.children) {
    if (!item.matches("li.user")) throw new Error("无效的好友条目");
    const anchor = [...item.querySelectorAll("a.avatar[href]")].find(
      (link) =>
        link.parentElement.matches("strong") &&
        link.parentElement.parentElement?.matches(".userContainer"),
    );
    if (!anchor) throw new Error("无效的好友条目");
    const url = new URL(anchor.getAttribute("href"), base);
    const image = avatar(
      anchor.querySelector(".userImage > .avatarNeue"),
      base,
    );
    if (
      url.origin === new URL(base).origin &&
      url.pathname === "/user/" &&
      !url.search &&
      !url.hash &&
      image
    ) {
      missingIdentifiers++;
      continue;
    }
    const match = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
    if (url.origin !== new URL(base).origin || !match || url.search || url.hash)
      throw new Error("无效的好友条目");
    const id = identifier(decodeURIComponent(match[1]));
    members.set(id, {
      id,
      name: anchor.textContent.trim() || id,
      avatar: image,
    });
  }
  const current = new URL(base);
  const pages = new Set();
  for (const link of document.querySelectorAll(
    ".page_inner a[href], .multipage a[href], .pagination a[href]",
  )) {
    const url = new URL(link.getAttribute("href"), base);
    if (
      url.origin !== current.origin ||
      url.pathname !== current.pathname ||
      !/^\d+$/.test(url.searchParams.get("page") ?? "")
    )
      throw new Error("无法确认关系列表分页完整性");
    const page = Number(url.searchParams.get("page"));
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      [...url.searchParams.keys()].some((key) => key !== "page")
    )
      throw new Error("无法确认关系列表分页完整性");
    if (page === 1) url.searchParams.delete("page");
    else url.searchParams.set("page", String(page));
    url.hash = "";
    pages.add(url.href);
  }
  return {
    status: "available",
    owner: readUser(document, base),
    members: [...members.values()],
    missingIdentifiers,
    pages: [...pages],
  };
}
export function createSite({
  window,
  requests,
  origin = window.location.origin,
  now = Date.now,
}) {
  async function home(input, options, candidate = false) {
    const id = normalizeInput(input);
    const url = `${origin}/user/${encodeURIComponent(id)}`;
    let page;
    try {
      page = await requests.page(url, {
        ...options,
        acceptRedirect(target) {
          try {
            const final = new URL(target);
            return (
              final.origin === origin &&
              !final.search &&
              !final.hash &&
              !!normalizeInput(target)
            );
          } catch {
            return false;
          }
        },
      });
    } catch (error) {
      options?.signal?.throwIfAborted();
      if (candidate && error.status === 404 && error.url === url) return null;
      throw error;
    }
    const redirected = page.url !== url;
    const document = new window.DOMParser().parseFromString(
      page.text,
      "text/html",
    );
    if (candidate && !redirected && missingUser(document)) return null;
    const user = readHome(document, page.url);
    if (redirected && normalizeInput(page.url) !== user.id)
      throw new Error("跳转后的主页身份不匹配");
    return user;
  }
  return {
    resolve: (input, options) => home(input, options),
    candidate: (number, options) => home(String(number), options, true),
    async relationships(id, direction, { signal, name } = {}) {
      const pending = [`${origin}/user/${encodeURIComponent(id)}/${direction}`];
      const queued = new Set(pending),
        members = new Map();
      let missing = 0,
        owner;
      for (let index = 0; index < pending.length; index++) {
        const url = pending[index];
        const page = readRelationships(
          window,
          await requests.text(url, { signal }),
          id,
          url,
          name,
        );
        if (page.status === "unavailable") {
          if (index) throw new Error("关系列表分页不可访问");
          return {
            snapshot: {
              status: "unavailable",
              fetchedAt: now(),
              issue: { code: "deleted-display-name-page-unavailable" },
            },
            users: [],
          };
        }
        owner = page.owner;
        for (const user of page.members) members.set(user.id, user);
        missing += page.missingIdentifiers;
        for (const pageUrl of page.pages)
          if (!queued.has(pageUrl)) {
            queued.add(pageUrl);
            pending.push(pageUrl);
          }
      }
      const fetchedAt = now();
      return {
        snapshot: {
          status: "available",
          members: [...members.keys()],
          fetchedAt,
          ...(missing
            ? { issue: { code: "missing-identifiers", count: missing } }
            : {}),
        },
        users: [...members.values(), owner].map((user) => ({
          ...user,
          fetchedAt,
        })),
      };
    },
  };
}
