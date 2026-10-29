import { OperationError } from "./errors.mjs";

const hosts = new Set(["bgm.tv", "bangumi.tv", "chii.in"]);
function identifier(value) {
  if (!value || /[\s/?#@]/u.test(value))
    throw new OperationError("invalid-input", "请输入有效的用户标识");
  return value;
}
export function normalizeInput(input) {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch (cause) {
      throw new OperationError("invalid-input", "请输入有效的用户标识", cause);
    }
    const match = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
    if (!hosts.has(url.host) || url.username || url.password || !match)
      throw new OperationError("invalid-input", "请输入有效的用户标识");
    try {
      return identifier(decodeURIComponent(match[1]));
    } catch (cause) {
      if (cause instanceof OperationError) throw cause;
      throw new OperationError("invalid-input", "请输入有效的用户标识", cause);
    }
  }
  return identifier(text.replace(/^@/, ""));
}
function identity(document, base) {
  const anchor = document.querySelector(
    "#headerProfile h1.nameSingle .inner > .name > a[href]",
  );
  if (!anchor)
    throw new OperationError(
      "profile-missing",
      "无法识别主页用户，请检查原站页面",
    );
  const url = new URL(anchor.getAttribute("href"), base);
  const match = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
  if (url.origin !== new URL(base).origin || !match)
    throw new OperationError("profile-identity", "无法识别主页用户");
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
export function readCurrentUser(document, location) {
  const match = /^\/user\/([^/]+)\/?$/.exec(location.pathname);
  if (!match) throw new OperationError("profile-identity", "无法识别主页用户");
  const id = identifier(decodeURIComponent(match[1]));
  const name = document.querySelector("#headerProfile .name")?.cloneNode(true);
  name
    ?.querySelectorAll("small.grey, #friend_flag")
    .forEach((node) => node.remove());
  return {
    id,
    name: name?.textContent.trim() || id,
    avatar: avatar(
      document.querySelector("#headerProfile .avatarNeue"),
      location.href,
    ),
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
    return { status: "unavailable", members: [] };
  if (identity(document, base) !== owner) throw new Error("关系页面身份不匹配");
  if (
    document.querySelector(".page_inner, .multipage, .pagination, .paginator")
  )
    throw new Error("不支持关系列表分页");
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
  return {
    status: "available",
    owner: readUser(document, base),
    members: [...members.values()],
    missingIdentifiers,
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
      const url = `${origin}/user/${encodeURIComponent(id)}/${direction}`;
      const page = readRelationships(
        window,
        await requests.text(url, { signal }),
        id,
        url,
        name,
      );
      if (page.status === "unavailable")
        return {
          snapshot: {
            status: "unavailable",
            fetchedAt: now(),
            issue: { code: "deleted-display-name-page-unavailable" },
          },
          users: [],
        };
      const fetchedAt = now();
      return {
        snapshot: {
          status: "available",
          members: page.members.map(({ id }) => id),
          fetchedAt,
          ...(page.missingIdentifiers
            ? {
                issue: {
                  code: "missing-identifiers",
                  count: page.missingIdentifiers,
                },
              }
            : {}),
        },
        users: [...page.members, page.owner].map((user) => ({
          ...user,
          fetchedAt,
        })),
      };
    },
  };
}
