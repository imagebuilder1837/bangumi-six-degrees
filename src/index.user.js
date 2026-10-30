// ==UserScript==
// @name         Bangumi 六度分隔
// @namespace    https://github.com/imagebuilder1837/bangumi-six-degrees
// @version      0.2.0
// @description  探索两位 Bangumi 用户之间的最短好友关系链，支持双向好友、单向好友与无向关联三种模式。
// @author       imagebuilder1837
// @match        https://bgm.tv/user/*
// @match        https://bangumi.tv/user/*
// @match        https://chii.in/user/*
// @run-at       document-end
// @grant        none
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/imagebuilder1837/bangumi-six-degrees/refs/heads/main/src/index.user.js
// @updateURL    https://raw.githubusercontent.com/imagebuilder1837/bangumi-six-degrees/refs/heads/main/src/index.user.js
// ==/UserScript==

// Generated from src/main.mjs and its imports, including vendor modules. Do not edit; run npm run build.
(function () {
  "use strict";

  // Codes carry meaning across modules; messages and causes retain the original reason.
  class OperationError extends Error {
    constructor(code, message, cause) {
      super(message, { cause });
      this.code = code;
    }
  }

  function delay(ms, signal) {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const until = Date.now() + ms;
      let timer;
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const wake = () => {
        const remaining = until - Date.now();
        if (remaining > 0)
          timer = setTimeout(wake, Math.min(remaining, 2147483647));
        else {
          signal?.removeEventListener("abort", abort);
          resolve();
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      wake();
    });
  }
  class RequestError extends OperationError {
    constructor(
      message,
      { code = "http", retryable = false, status, url, cause } = {},
    ) {
      super(code, message, cause);
      this.retryable = retryable;
      this.status = status;
      this.url = url;
    }
  }
  function retryAt(value, now) {
    if (typeof value !== "string" || !value.trim()) return now + 60000;
    const text = value.trim();
    if (/^\d+$/.test(text) && Number.isFinite(Number(text) * 1000))
      return now + Number(text) * 1000;
    const time = Date.parse(text);
    return Number.isFinite(time) && new Date(time).toUTCString() === text
      ? Math.max(now, time)
      : now + 60000;
  }

  function createRequests({
    fetch,
    now = Date.now,
    sleep = delay,
    timeout = 30000,
    concurrency = 4,
  }) {
    let active = 0,
      limitedUntil = 0;
    const waiting = [];
    function acquire(signal) {
      signal.throwIfAborted();
      if (active < concurrency) {
        active++;
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const entry = {
          resolve: () => {
            signal.removeEventListener("abort", abort);
            resolve();
          },
        };
        const abort = () => {
          waiting.splice(waiting.indexOf(entry), 1);
          reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
        waiting.push(entry);
      });
    }
    function release() {
      const next = waiting.shift();
      if (next) next.resolve();
      else active--;
    }
    async function attempt(url, signal, acceptRedirect) {
      await acquire(signal);
      try {
        while (now() < limitedUntil) await sleep(limitedUntil - now(), signal);
        signal.throwIfAborted();
        const controller = new AbortController();
        const cancel = () => controller.abort(signal.reason);
        signal.addEventListener("abort", cancel, { once: true });
        const timer = setTimeout(
          () =>
            controller.abort(
              new RequestError("请求超时", {
                code: "timeout",
                retryable: true,
              }),
            ),
          timeout,
        );
        let aborted;
        const cancelled = new Promise((_, reject) => {
          aborted = () => reject(controller.signal.reason);
          controller.signal.addEventListener("abort", aborted, { once: true });
        });
        try {
          return await Promise.race([
            cancelled,
            (async () => {
              let response;
              try {
                response = await fetch(url, {
                  credentials: "same-origin",
                  signal: controller.signal,
                });
              } catch (error) {
                controller.signal.throwIfAborted();
                throw new RequestError(error.message, {
                  code: "network",
                  retryable: true,
                  cause: error,
                });
              }
              controller.signal.throwIfAborted();
              const finalUrl = response.url || url;
              if (finalUrl !== url && !acceptRedirect(finalUrl)) {
                const target = new URL(finalUrl);
                const login =
                  target.origin === new URL(url).origin &&
                  /^\/login\/?$/.test(target.pathname);
                throw new RequestError(
                  login
                    ? "请求跳转到登录页面，请检查登录状态"
                    : "请求跳转到非预期页面",
                  { code: login ? "login-redirect" : "unexpected-redirect" },
                );
              }
              if (response.status === 429)
                limitedUntil = Math.max(
                  limitedUntil,
                  retryAt(response.headers?.get("Retry-After"), now()),
                );
              if (!response.ok)
                throw new RequestError(
                  response.status === 429
                    ? "HTTP 429：原站限流"
                    : `HTTP ${response.status}：读取失败`,
                  {
                    retryable:
                      response.status === 408 ||
                      response.status === 429 ||
                      (response.status >= 500 && response.status <= 599),
                    status: response.status,
                    url: finalUrl,
                  },
                );
              try {
                return { text: await response.text(), url: finalUrl };
              } catch (error) {
                controller.signal.throwIfAborted();
                throw new RequestError(error.message, {
                  code: "body-read",
                  retryable: true,
                  cause: error,
                });
              }
            })(),
          ]);
        } finally {
          clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
          controller.signal.removeEventListener("abort", aborted);
        }
      } finally {
        release();
      }
    }
    async function page(
      url,
      {
        signal = new AbortController().signal,
        acceptRedirect = () => false,
      } = {},
    ) {
      for (let retry = 0; ; retry++) {
        try {
          return await attempt(url, signal, acceptRedirect);
        } catch (error) {
          signal.throwIfAborted();
          if (!error.retryable || retry === 2) throw error;
          await sleep(
            Math.max(1000 * 2 ** retry, limitedUntil - now()),
            signal,
          );
        }
      }
    }
    return {
      async text(url, options) {
        return (await page(url, options)).text;
      },
      page,
    };
  }

  const hosts = new Set(["bgm.tv", "bangumi.tv", "chii.in"]);
  function identifier$1(value) {
    if (!value || /[\s/?#@]/u.test(value))
      throw new OperationError("invalid-input", "请输入有效的用户标识");
    return value;
  }
  function normalizeInput(input) {
    const text = input.trim();
    if (/^https?:\/\//i.test(text)) {
      let url;
      try {
        url = new URL(text);
      } catch (cause) {
        throw new OperationError(
          "invalid-input",
          "请输入有效的用户标识",
          cause,
        );
      }
      const match = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
      if (!hosts.has(url.host) || url.username || url.password || !match)
        throw new OperationError("invalid-input", "请输入有效的用户标识");
      try {
        return identifier$1(decodeURIComponent(match[1]));
      } catch (cause) {
        if (cause instanceof OperationError) throw cause;
        throw new OperationError(
          "invalid-input",
          "请输入有效的用户标识",
          cause,
        );
      }
    }
    return identifier$1(text.replace(/^@/, ""));
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
    return identifier$1(
      current?.startsWith("@")
        ? current.slice(1)
        : decodeURIComponent(match[1]),
    );
  }
  function avatar$1(element, base) {
    const raw = element?.style.backgroundImage;
    const image = raw && /^url\(["']?(.*?)["']?\)$/.exec(raw)?.[1];
    if (!image) return "";
    const url = new URL(image, base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  }
  function readUser(document, base) {
    const id = identity(document, base);
    return {
      id,
      name:
        document
          .querySelector("#headerProfile .name > a")
          ?.textContent.trim() || id,
      avatar: avatar$1(
        document.querySelector("#headerProfile .avatarNeue"),
        base,
      ),
    };
  }
  function readCurrentUser(document, location) {
    const match = /^\/user\/([^/]+)\/?$/.exec(location.pathname);
    if (!match)
      throw new OperationError("profile-identity", "无法识别主页用户");
    const id = identifier$1(decodeURIComponent(match[1]));
    const name = document
      .querySelector("#headerProfile .name")
      ?.cloneNode(true);
    name
      ?.querySelectorAll("small.grey, #friend_flag")
      .forEach((node) => node.remove());
    return {
      id,
      name: name?.textContent.trim() || id,
      avatar: avatar$1(
        document.querySelector("#headerProfile .avatarNeue"),
        location.href,
      ),
    };
  }
  function readHome(document, base) {
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
  function readRelationships(window, html, owner, base, name) {
    const document = new window.DOMParser().parseFromString(html, "text/html");
    if (name === "[已注销]" && unavailable(document))
      return { status: "unavailable", members: [] };
    if (identity(document, base) !== owner)
      throw new Error("关系页面身份不匹配");
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
      const image = avatar$1(
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
      if (
        url.origin !== new URL(base).origin ||
        !match ||
        url.search ||
        url.hash
      )
        throw new Error("无效的好友条目");
      const id = identifier$1(decodeURIComponent(match[1]));
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
  function createSite({
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

  class RelationshipStoreError extends Error {
    constructor(code, message, cause) {
      super(message, { cause });
      this.name = cause?.name || "RelationshipStoreError";
      this.code = code;
    }
  }

  const record = (value) =>
    Object.prototype.toString.call(value) === "[object Object]";
  const identifier = (value) => typeof value === "string" && value.length > 0;
  const direction = (value) => ["friends", "rev_friends"].includes(value);
  const timestamp = (value) =>
    Number.isFinite(value) && value >= 0 && value <= 8640000000000000;
  const fields$1 = (value, allowed) =>
    record(value) && Object.keys(value).every((key) => allowed.includes(key));
  const missingIssue = (issue) =>
    fields$1(issue, ["code", "count"]) &&
    issue.code === "missing-identifiers" &&
    Number.isSafeInteger(issue.count) &&
    issue.count > 0;
  const unavailableIssue = (issue) =>
    fields$1(issue, ["code"]) &&
    issue.code === "deleted-display-name-page-unavailable";

  function arrayOf(value, accepts) {
    if (!Array.isArray(value)) return false;
    // Iteration visits empty slots as undefined; Array#every skips them.
    for (const item of value) if (!accepts(item)) return false;
    return true;
  }

  function snapshot(value) {
    if (
      !fields$1(value, ["status", "members", "fetchedAt", "issue"]) ||
      !timestamp(value.fetchedAt)
    )
      return false;
    if (value.status === "available")
      return (
        arrayOf(value.members, identifier) &&
        (value.issue === undefined || missingIssue(value.issue))
      );
    return (
      value.status === "unavailable" &&
      value.members === undefined &&
      unavailableIssue(value.issue)
    );
  }

  function avatar(value) {
    if (value === "") return true;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol);
    } catch {
      return false;
    }
  }

  function user(value) {
    return (
      fields$1(value, ["name", "avatar", "fetchedAt"]) &&
      typeof value.name === "string" &&
      typeof value.avatar === "string" &&
      avatar(value.avatar) &&
      timestamp(value.fetchedAt)
    );
  }

  function storedValue(entry, name) {
    if (!record(entry) || !Number.isSafeInteger(entry.version))
      throw new RelationshipStoreError(
        "corrupt-data",
        "Damaged relationship store record",
      );
    if (entry.version !== 1)
      throw new RelationshipStoreError(
        "incompatible-version",
        "Unsupported relationship record version",
      );
    if (
      !fields$1(entry, ["version", "value"]) ||
      !(name === "relationships" ? snapshot(entry.value) : user(entry.value))
    )
      throw new RelationshipStoreError(
        "corrupt-data",
        "Damaged relationship store record",
      );
    return entry.value;
  }

  function requireInput(condition) {
    if (!condition)
      throw new RelationshipStoreError(
        "invalid-input",
        "Invalid relationship store input",
      );
  }

  function queryEntries(query) {
    requireInput(fields$1(query, ["relationships", "users"]));
    const { relationships = [], users = [] } = query;
    requireInput(
      arrayOf(
        relationships,
        (key) =>
          Array.isArray(key) &&
          key.length === 2 &&
          identifier(key[0]) &&
          direction(key[1]),
      ) && arrayOf(users, identifier),
    );
    return [
      ...relationships.map(([id, kind]) => ({
        name: "relationships",
        key: [id, kind],
      })),
      ...users.map((id) => ({ name: "users", key: id })),
    ];
  }

  function batchEntries(batch) {
    requireInput(fields$1(batch, ["relationships", "users"]));
    const { relationships = {}, users = {} } = batch;
    requireInput(record(relationships) && record(users));
    const entries = [];
    for (const [id, directions] of Object.entries(relationships)) {
      requireInput(identifier(id) && record(directions));
      for (const [kind, value] of Object.entries(directions)) {
        requireInput(direction(kind) && snapshot(value));
        entries.push({
          name: "relationships",
          key: [id, kind],
          value: {
            ...value,
            ...(value.members ? { members: [...new Set(value.members)] } : {}),
            ...(value.issue ? { issue: { ...value.issue } } : {}),
          },
        });
      }
    }
    for (const [id, value] of Object.entries(users)) {
      requireInput(identifier(id) && user(value));
      entries.push({ name: "users", key: id, value: { ...value } });
    }
    return entries;
  }

  const databaseName = "bangumi-relationship-store";
  const stores = ["relationships", "users"];
  const dictionary = () => Object.create(null);

  function storageError(error) {
    if (error instanceof RelationshipStoreError) return error;
    const code =
      error?.name === "VersionError"
        ? "incompatible-version"
        : error?.name === "QuotaExceededError"
          ? "quota-exceeded"
          : ["SecurityError", "InvalidStateError", "NotAllowedError"].includes(
                error?.name,
              )
            ? "unavailable"
            : "storage-error";
    return new RelationshipStoreError(
      code,
      error?.message || "Relationship storage failed",
      error,
    );
  }

  // A get() result of undefined can mean either no key or an invalid stored
  // value. Resolve that ambiguity in the same transaction before validating.
  function readRecord(store, key, accept, fail) {
    const request = store.get(key);
    request.onsuccess = () => {
      const finish = (exists) => {
        try {
          accept(exists ? storedValue(request.result, store.name) : undefined);
        } catch (error) {
          fail(error);
        }
      };
      if (request.result !== undefined) finish(true);
      else {
        const existence = store.getKey(key);
        existence.onsuccess = () => finish(existence.result !== undefined);
      }
    };
  }

  function transact(indexedDB, mode, operation, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      let opening;
      let abandoned = false;
      const openingAbort = () => {
        abandoned = true;
        signal?.removeEventListener("abort", openingAbort);
        reject(signal.reason);
      };
      const rejectOpening = (error) => {
        abandoned = true;
        signal?.removeEventListener("abort", openingAbort);
        reject(storageError(error));
      };
      try {
        if (typeof indexedDB?.open !== "function")
          throw new RelationshipStoreError(
            "unavailable",
            "IndexedDB is unavailable",
          );
        opening = indexedDB.open(databaseName, 1);
      } catch (error) {
        rejectOpening(error);
        return;
      }
      signal?.addEventListener("abort", openingAbort, { once: true });
      opening.onupgradeneeded = (event) => {
        if (abandoned || signal?.aborted || event.oldVersion !== 0) {
          opening.transaction.abort();
          return;
        }
        for (const name of stores) opening.result.createObjectStore(name);
      };
      opening.onblocked = () =>
        rejectOpening(
          new RelationshipStoreError(
            "blocked",
            "Database upgrade is blocked by another connection",
          ),
        );
      opening.onerror = () => rejectOpening(opening.error);
      opening.onsuccess = () => {
        signal?.removeEventListener("abort", openingAbort);
        const database = opening.result;
        database.onversionchange = () => database.close();
        if (abandoned || signal?.aborted) {
          database.close();
          if (signal?.aborted) reject(signal.reason);
          return;
        }
        let transaction;
        try {
          if (stores.some((name) => !database.objectStoreNames.contains(name)))
            throw new RelationshipStoreError(
              "corrupt-data",
              "Missing relationship object store",
            );
          transaction = database.transaction(stores, mode);
        } catch (error) {
          database.close();
          reject(storageError(error));
          return;
        }
        let result;
        let failure;
        let aborting = false;
        const fail = (error) => {
          if (aborting) return;
          aborting = true;
          failure = error;
          transaction.abort();
        };
        const abort = () => fail(signal.reason);
        const close = () => {
          signal?.removeEventListener("abort", abort);
          database.close();
        };
        transaction.oncomplete = () => {
          close();
          resolve(result);
        };
        transaction.onabort = () => {
          close();
          reject(
            signal?.aborted
              ? signal.reason
              : storageError(failure ?? transaction.error),
          );
        };
        signal?.addEventListener("abort", abort, { once: true });
        try {
          signal?.throwIfAborted();
          for (const name of stores) {
            const store = transaction.objectStore(name);
            if (
              store.keyPath !== null ||
              store.autoIncrement ||
              store.indexNames.length
            )
              throw new RelationshipStoreError(
                "corrupt-data",
                "Unexpected relationship object store layout",
              );
          }
          result = operation(transaction, fail);
        } catch (error) {
          fail(error);
        }
      };
    });
  }

  /**
   * @typedef {"friends" | "rev_friends"} Direction
   * @typedef {{code: "missing-identifiers", count: number}} MissingIdentifiers
   * @typedef {{status: "available", members: string[], fetchedAt: number, issue?: MissingIdentifiers} |
   *   {status: "unavailable", fetchedAt: number, issue: {code: "deleted-display-name-page-unavailable"}}} Snapshot
   * @typedef {{name: string, avatar: string, fetchedAt: number}} User
   * @typedef {{relationships?: [string, Direction][], users?: string[]}} Query
   * @typedef {{relationships?: Record<string, Partial<Record<Direction, Snapshot>>>, users?: Record<string, User>}} Batch
   * @typedef {{relationships: Record<string, Partial<Record<Direction, Snapshot>>>, users: Record<string, User>}} ReadResult
   * @typedef {{signal?: AbortSignal}} Options
   */

  /**
   * Create a same-origin store. Each call opens and closes its own connection.
   * @param {{indexedDB?: IDBFactory}} dependencies
   */
  function createRelationshipStore({ indexedDB }) {
    return {
      /**
       * Read only requested keys in one transaction; absent keys are omitted.
       * @param {Query} query
       * @param {Options} [options]
       * @returns {Promise<ReadResult>}
       */
      async read(query, { signal } = {}) {
        const entries = queryEntries(query);
        return transact(
          indexedDB,
          "readonly",
          (transaction, fail) => {
            const result = { relationships: dictionary(), users: dictionary() };
            for (const { name, key } of entries) {
              readRecord(
                transaction.objectStore(name),
                key,
                (value) => {
                  if (value === undefined) return;
                  if (name === "relationships") {
                    const [id, direction] = key;
                    result.relationships[id] ??= dictionary();
                    result.relationships[id][direction] = value;
                  } else result.users[key] = value;
                },
                fail,
              );
            }
            return result;
          },
          signal,
        );
      },
      /**
       * Validate and detach input, then atomically replace the requested records.
       * Resolve only on transaction completion; reject with the signal reason
       * on cancellation, otherwise a RelationshipStoreError with a stable code.
       * @param {Batch} batch
       * @param {Options} [options]
       * @returns {Promise<void>}
       */
      async commit(batch, { signal } = {}) {
        const entries = batchEntries(batch);
        return transact(
          indexedDB,
          "readwrite",
          (transaction) => {
            for (const { name, key, value } of entries) {
              signal?.throwIfAborted();
              transaction.objectStore(name).put({ version: 1, value }, key);
            }
          },
          signal,
        );
      },
    };
  }

  function browserStore(window) {
    const store = () =>
      createRelationshipStore({ indexedDB: window.indexedDB });
    return {
      read: (query, options) => store().read(query, options),
      commit: (batch, options) => store().commit(batch, options),
    };
  }
  function createDataSource({
    store,
    site,
    initialUsers = [],
    onWarning = () => {},
  }) {
    const profiles = new Map(initialUsers.map((user) => [user.id, user]));
    const loaded = new Map();
    let sequence = 0;
    let warned = false;
    const warning = (error) => {
      if (!warned)
        onWarning(
          `关系缓存保存失败：${error.message}；本次探索继续使用网络数据。`,
        );
      warned = true;
    };
    function loadOne(id, direction, signal) {
      const key = JSON.stringify([id, direction]);
      if (!loaded.has(key))
        loaded.set(
          key,
          (async () => {
            const observation = await site.relationships(id, direction, {
              signal,
              name: profiles.get(id)?.name,
            });
            signal?.throwIfAborted();
            // Network completion, not cache commit order, arbitrates observations.
            const order = ++sequence;
            for (const user of observation.users) {
              if (
                !profiles.has(user.id) ||
                (profiles.get(user.id).fetchedAt ?? 0) <= user.fetchedAt
              )
                profiles.set(user.id, user);
            }
            const users = Object.fromEntries(
              observation.users.map(
                ({ id: userId, name, avatar, fetchedAt }) => [
                  userId,
                  { name, avatar, fetchedAt },
                ],
              ),
            );
            try {
              await store.commit(
                {
                  relationships: {
                    [id]: { [direction]: observation.snapshot },
                  },
                  users,
                },
                { signal },
              );
            } catch (error) {
              signal?.throwIfAborted();
              warning(error);
            }
            return { id, direction, snapshot: observation.snapshot, order };
          })(),
        );
      return loaded.get(key);
    }
    return {
      async estimate(keys, { signal } = {}) {
        if (!keys.length) return 0;
        try {
          const data = await store.read({ relationships: keys }, { signal });
          return keys.reduce(
            (cost, [id, direction]) =>
              cost +
              1 +
              (data.relationships[id]?.[direction]?.members?.length ?? 100) /
                100,
            0,
          );
        } catch (error) {
          signal?.throwIfAborted();
          return keys.length * 2;
        }
      },
      // A source belongs to one exploration. Batches retain input order and share
      // fetched observations, but only produce a bounded number of pending tasks.
      async load(keys, { signal } = {}) {
        signal?.throwIfAborted();
        const results = new Array(keys.length);
        let next = 0;
        let failed = false;
        async function worker() {
          try {
            while (!failed && next < keys.length) {
              signal?.throwIfAborted();
              const index = next++;
              const [id, direction] = keys[index];
              results[index] = await loadOne(id, direction, signal);
            }
          } catch (error) {
            failed = true;
            throw error;
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(4, keys.length) }, () => worker()),
        );
        return results;
      },
      async users(ids) {
        return new Map(
          ids.map((id) => [
            id,
            profiles.get(id) ?? { id, name: id, avatar: "" },
          ]),
        );
      },
    };
  }

  const key = (id, direction) => JSON.stringify([id, direction]);
  function setAt(map, id) {
    if (!map.has(id)) map.set(id, new Set());
    return map.get(id);
  }

  // An observation is a complete directional list, not just positive edges.
  class ObservationGraph {
    constructor() {
      this.records = new Map();
      this.outgoing = new Map();
      this.incoming = new Map();
      this.sequence = 0;
    }
    get(id, direction) {
      return this.records.get(key(id, direction));
    }
    invalid(id) {
      return ["friends", "rev_friends"].some(
        (direction) => this.get(id, direction)?.status === "unavailable",
      );
    }
    candidates(id) {
      return new Set([
        ...(this.outgoing.get(id) ?? []),
        ...(this.incoming.get(id) ?? []),
      ]);
    }
    observe({ id, direction, snapshot, order }) {
      const affected = this.candidates(id);
      affected.add(id);
      const previous = this.get(id, direction);
      const record = {
        ...snapshot,
        members: new Set(snapshot.members ?? []),
        order: order ?? ++this.sequence,
      };
      if (previous && previous.order > record.order) return new Set();
      this.records.set(key(id, direction), record);
      for (const other of new Set([
        ...(previous?.members ?? []),
        ...record.members,
      ])) {
        const from = direction === "friends" ? id : other;
        const to = direction === "friends" ? other : id;
        const exists =
          this.get(from, "friends")?.members.has(to) ||
          this.get(to, "rev_friends")?.members.has(from);
        for (const [map, owner, member] of [
          [this.outgoing, from, to],
          [this.incoming, to, from],
        ]) {
          if (exists) setAt(map, owner).add(member);
          else map.get(owner)?.delete(member);
        }
        affected.add(other);
      }
      for (const other of this.candidates(id)) affected.add(other);
      return affected;
    }
    edge(from, to) {
      if (this.invalid(from) || this.invalid(to)) return false;
      const forward = this.get(from, "friends");
      const reverse = this.get(to, "rev_friends");
      // No complete observation is different from an observed absence.
      if (!forward && !reverse) return null;
      const chosen = !forward
        ? reverse
        : !reverse || forward.order >= reverse.order
          ? forward
          : reverse;
      return chosen.members.has(chosen === forward ? to : from);
    }
    directions(mode, backward) {
      return mode === "directed"
        ? [backward ? "rev_friends" : "friends"]
        : ["friends", "rev_friends"];
    }
    complete(id, mode, backward) {
      return (
        this.invalid(id) ||
        this.directions(mode, backward).every((direction) =>
          this.get(id, direction),
        )
      );
    }
    neighbors(id, mode, backward) {
      if (this.invalid(id)) return new Set();
      return new Set(
        [...this.candidates(id)].filter((other) => {
          const forward = this.edge(id, other);
          const reverse = this.edge(other, id);
          if (mode === "undirected") return forward || reverse;
          if (mode === "mutual") return forward && reverse;
          return backward ? reverse : forward;
        }),
      );
    }
  }

  class SearchSide {
    constructor(root) {
      this.root = root;
      this.distances = new Map([[root, 0]]);
      this.parents = new Map();
      this.children = new Map();
      this.expanded = new Map();
      this.incoming = new Map();
      this.blocked = new Set();
    }
    frontier() {
      let depth = Infinity;
      let ids = [];
      for (const [id, distance] of this.distances) {
        if (this.expanded.has(id)) continue;
        if (distance < depth) {
          depth = distance;
          ids = [];
        }
        if (distance === depth) ids.push(id);
      }
      return { depth, ids: ids.filter((id) => !this.blocked.has(id)) };
    }
    // Remove only dependent parent subtrees; unaffected labels and fetched lists survive.
    change(changes) {
      const removedParents = [];
      for (const [id, neighbors] of changes) {
        const old = this.expanded.get(id) ?? new Set();
        for (const other of old)
          if (!neighbors.has(other)) {
            this.incoming.get(other)?.delete(id);
            if (this.parents.get(other) === id) removedParents.push(other);
          }
        for (const other of neighbors) {
          if (!this.incoming.has(other)) this.incoming.set(other, new Set());
          this.incoming.get(other).add(id);
        }
        this.expanded.set(id, neighbors);
      }
      const invalidated = new Set();
      const pending = [...removedParents];
      while (pending.length) {
        const id = pending.pop();
        if (id === this.root || invalidated.has(id)) continue;
        invalidated.add(id);
        pending.push(...(this.children.get(id) ?? []));
        this.children.get(this.parents.get(id))?.delete(id);
        this.children.delete(id);
        this.parents.delete(id);
        this.distances.delete(id);
      }
      const seeds = new Set(changes.keys());
      for (const id of invalidated)
        for (const parent of this.incoming.get(id) ?? []) seeds.add(parent);
      const queue = [...seeds].filter((id) => this.distances.has(id));
      for (let index = 0; index < queue.length; index++) {
        const id = queue[index];
        const distance = this.distances.get(id) + 1;
        for (const other of this.expanded.get(id) ?? []) {
          if (distance >= (this.distances.get(other) ?? Infinity)) continue;
          this.children.get(this.parents.get(other))?.delete(other);
          this.parents.set(other, id);
          if (!this.children.has(id)) this.children.set(id, new Set());
          this.children.get(id).add(other);
          this.distances.set(other, distance);
          queue.push(other);
        }
      }
    }
  }

  function pathThrough(sides, meeting) {
    const path = [meeting];
    for (let id = meeting; sides[0].parents.has(id);) {
      id = sides[0].parents.get(id);
      path.unshift(id);
    }
    for (let id = meeting; sides[1].parents.has(id);) {
      id = sides[1].parents.get(id);
      path.push(id);
    }
    return path;
  }

  async function search({
    start,
    end,
    mode = "directed",
    excluded = [],
    source,
    signal = new AbortController().signal,
    onProgress = () => {},
  }) {
    if (!["directed", "undirected", "mutual"].includes(mode))
      throw new Error("未知关系模式");
    const excludedIds = new Set(excluded);
    excludedIds.delete(start);
    excludedIds.delete(end);
    const graph = new ObservationGraph();
    const sides = [new SearchSide(start), new SearchSide(end)];
    const attempted = new Set();
    let observations = 0;
    const keysFor = (ids, backward) =>
      ids.flatMap((id) =>
        graph
          .directions(mode, backward)
          .filter(
            (direction) =>
              !graph.get(id, direction) &&
              !attempted.has(JSON.stringify([id, direction])),
          )
          .map((direction) => [id, direction]),
      );
    // Both expansion and direction completion enter the same observation view.
    async function load(keys, index = -1, ids = []) {
      const records = keys.length ? await source.load(keys, { signal }) : [];
      signal.throwIfAborted();
      for (const key of keys) attempted.add(JSON.stringify(key));
      const affected = new Set();
      for (const record of records) {
        observations++;
        for (const id of graph.observe(record)) affected.add(id);
      }
      for (const id of ids) {
        if (graph.complete(id, mode, index === 1)) affected.add(id);
        else sides[index].blocked.add(id);
      }
      sides.forEach((side, sideIndex) => {
        const changes = new Map();
        for (const id of affected) {
          if (graph.complete(id, mode, sideIndex === 1))
            side.blocked.delete(id);
          if (
            side.expanded.has(id) ||
            (sideIndex === index &&
              ids.includes(id) &&
              graph.complete(id, mode, sideIndex === 1))
          ) {
            changes.set(
              id,
              new Set(
                [...graph.neighbors(id, mode, sideIndex === 1)].filter(
                  (other) => !excludedIds.has(other),
                ),
              ),
            );
          }
        }
        side.change(changes);
      });
    }
    while (true) {
      signal.throwIfAborted();
      if (graph.invalid(start) || graph.invalid(end))
        return { status: "invalid" };
      const layers = sides.map((side) => side.frontier());
      let meeting,
        length = Infinity;
      for (const [id, distance] of sides[0].distances) {
        const total = distance + (sides[1].distances.get(id) ?? Infinity);
        if (total < length) {
          length = total;
          meeting = id;
        }
      }
      const progress = {
        visited: new Set(sides.flatMap((side) => [...side.distances.keys()]))
          .size,
        observations,
      };
      if (
        meeting !== undefined &&
        length <= layers[0].depth + layers[1].depth
      ) {
        const path = pathThrough(sides, meeting);
        const relations = path.slice(1).map((id, index) => ({
          forward: graph.edge(path[index], id),
          reverse: graph.edge(id, path[index]),
        }));
        const unknown = relations.findIndex(
          ({ forward, reverse }) => forward === null || reverse === null,
        );
        onProgress({ ...progress, stage: "relations" });
        if (unknown === -1) return { status: "found", path, relations };
        const [from, to] =
          relations[unknown].forward === null
            ? [path[unknown], path[unknown + 1]]
            : [path[unknown + 1], path[unknown]];
        const key = [
          [from, "friends"],
          [to, "rev_friends"],
        ].find((key) => !attempted.has(JSON.stringify(key)));
        if (!key) return { status: "incomplete" };
        await load([key]);
        continue;
      }
      onProgress({ ...progress, stage: "search" });
      if (layers.some((layer) => layer.depth === Infinity))
        return { status: "unreachable" };
      if (layers.every((layer) => !layer.ids.length))
        return { status: "incomplete" };
      const keys = layers.map((layer, index) =>
        keysFor(layer.ids, index === 1),
      );
      const costs = await Promise.all(
        layers.map(async (layer, index) => {
          if (!layer.ids.length) return Infinity;
          try {
            return (
              (await source.estimate?.(keys[index], { signal })) ??
              layer.ids.length
            );
          } catch {
            signal.throwIfAborted();
            return layer.ids.length;
          }
        }),
      );
      signal.throwIfAborted();
      const index = costs[0] <= costs[1] ? 0 : 1;
      await load(keys[index], index, layers[index].ids);
    }
  }

  const storageKey$1 = "bangumi-six-degrees:excluded-intermediates";

  function createExclusions({ site, store, storage, now, onUpdate, onChange }) {
    const state = {
      input: "",
      users: [],
      activity: "idle",
      message: "",
      storageWarning: "",
      cacheWarning: "",
    };
    try {
      const raw = storage?.()?.getItem(storageKey$1);
      if (raw !== null && raw !== undefined) {
        const saved = JSON.parse(raw);
        if (
          saved.version !== 1 ||
          !Array.isArray(saved.ids) ||
          saved.ids.some(
            (id) => typeof id !== "string" || normalizeInput(id) !== id,
          )
        )
          throw new Error("名单格式无效");
        state.users = [...new Set(saved.ids)].map((id) => ({
          id,
          name: id,
          avatar: "",
        }));
      }
    } catch {
      state.storageWarning =
        "无法读取排除名单，已按空名单继续；可重新添加班友。";
    }
    function save() {
      try {
        storage().setItem(
          storageKey$1,
          JSON.stringify({ version: 1, ids: state.users.map(({ id }) => id) }),
        );
        state.storageWarning = "";
      } catch {
        state.storageWarning =
          "排除名单未能保存，当前页面仍生效，刷新后可能丢失。";
      }
      onChange();
    }
    async function loadProfiles() {
      if (!state.users.length) return;
      try {
        const cached = await store.read({
          users: state.users.map(({ id }) => id),
        });
        state.users = state.users.map((user) => {
          const profile = cached.users[user.id];
          return profile &&
            (user.fetchedAt === undefined || profile.fetchedAt > user.fetchedAt)
            ? { ...user, ...profile }
            : user;
        });
        onUpdate();
      } catch {
        state.cacheWarning = "无法读取用户资料缓存，排除名单仍生效。";
        onUpdate();
      }
    }
    // Notify only after the owning session has finished initialization.
    void Promise.resolve().then(loadProfiles);
    let operation;
    function cancelOperation() {
      if (!operation) return false;
      operation.abort();
      operation = undefined;
      state.activity = "idle";
      state.message = "已取消添加。";
      return true;
    }
    return {
      state,
      cancel() {
        if (cancelOperation()) onUpdate();
      },
      setInput(value) {
        cancelOperation();
        state.input = value;
        state.message = "";
        onUpdate();
      },
      async add() {
        if (operation) return;
        if (!state.input.trim()) {
          state.message = "请先填入用户标识。";
          onUpdate();
          return;
        }
        const abort = new AbortController();
        operation = abort;
        state.activity = "resolving";
        state.message = "正在确认用户…";
        onUpdate();
        let user;
        try {
          user = {
            ...(await site.resolve(state.input, { signal: abort.signal })),
            fetchedAt: now(),
          };
          if (operation !== abort) return;
        } catch (error) {
          if (operation !== abort) return;
          operation = undefined;
          state.activity = "idle";
          state.message = `无法添加班友：${error.message}`;
          onUpdate();
          return;
        }
        operation = undefined;
        state.activity = "idle";
        if (state.users.some(({ id }) => id === user.id)) {
          state.message = "这位班友已在名单中。";
          onUpdate();
          return;
        }
        state.users.push(user);
        state.input = "";
        state.message = "已添加排除中转的班友。";
        save();
        try {
          const { name, avatar, fetchedAt } = user;
          await store.commit({
            users: { [user.id]: { name, avatar, fetchedAt } },
          });
        } catch {
          state.cacheWarning = "用户资料缓存保存失败，排除名单仍生效。";
          onUpdate();
        }
      },
      remove(id) {
        if (!state.users.some((user) => user.id === id)) return;
        state.users = state.users.filter((user) => user.id !== id);
        save();
      },
    };
  }

  const storageKey = "bangumi-six-degrees:recent-explorations";
  const fields = [
    "start",
    "end",
    "status",
    "hops",
    "mode",
    "hasExclusions",
    "completedAt",
  ];
  function validEntry(entry) {
    return (
      entry &&
      typeof entry === "object" &&
      Object.keys(entry).length === fields.length &&
      fields.every((field) => Object.hasOwn(entry, field)) &&
      [entry.start, entry.end].every(
        (id) => typeof id === "string" && normalizeInput(id) === id,
      ) &&
      ["mutual", "directed", "undirected"].includes(entry.mode) &&
      typeof entry.hasExclusions === "boolean" &&
      Number.isSafeInteger(entry.completedAt) &&
      entry.completedAt >= 0 &&
      entry.completedAt <= 8640000000000000 &&
      (entry.status === "unreachable"
        ? entry.hops === null
        : entry.status === "found" &&
          Number.isSafeInteger(entry.hops) &&
          entry.hops >= 0 &&
          (entry.hops === 0) === (entry.start === entry.end))
    );
  }

  function createHistory({ store, storage, now, onUpdate }) {
    const state = {
      entries: [],
      users: {},
      storageWarning: "",
      cacheWarning: "",
    };
    try {
      const raw = storage?.()?.getItem(storageKey);
      if (raw !== null && raw !== undefined) {
        const saved = JSON.parse(raw);
        if (
          saved?.version !== 1 ||
          !Array.isArray(saved.entries) ||
          saved.entries.length > 5 ||
          !saved.entries.every(validEntry)
        )
          throw new Error("探索记录格式无效");
        state.entries = saved.entries;
      }
    } catch {
      state.storageWarning = "无法读取探索记录，已按空记录继续。";
    }
    let revision = 0;
    function mergeProfiles(profiles) {
      const ids = new Set(
        state.entries.flatMap(({ start, end }) => [start, end]),
      );
      state.users = Object.fromEntries(
        [...ids].flatMap((id) => {
          const previous = Object.hasOwn(state.users, id)
            ? state.users[id]
            : null;
          const incoming = Object.hasOwn(profiles, id) ? profiles[id] : null;
          const profile =
            incoming && (!previous || incoming.fetchedAt >= previous.fetchedAt)
              ? incoming
              : previous;
          return profile ? [[id, profile]] : [];
        }),
      );
    }
    async function loadProfiles() {
      if (!state.entries.length) return;
      const version = revision;
      try {
        const cached = await store.read({
          users: [
            ...new Set(state.entries.flatMap(({ start, end }) => [start, end])),
          ],
        });
        if (version !== revision) return;
        mergeProfiles(cached.users);
      } catch {
        if (version !== revision) return;
        state.cacheWarning = "无法读取用户资料缓存，探索记录仍保留。";
      }
      onUpdate();
    }
    void Promise.resolve().then(loadProfiles);
    return {
      state,
      clear() {
        revision++;
        state.entries = [];
        state.users = {};
        state.cacheWarning = "";
        try {
          storage().removeItem(storageKey);
          state.storageWarning = "";
        } catch {
          state.storageWarning =
            "探索记录未能清空，当前页面已清空，刷新后可能重新出现。";
        }
      },
      record(result, users) {
        if (!["found", "unreachable"].includes(result.status)) return;
        const remaining = state.entries.filter(
          (entry) =>
            entry.start !== result.conditions.start ||
            entry.end !== result.conditions.end ||
            entry.mode !== result.conditions.mode,
        );
        state.entries = [
          {
            start: result.conditions.start,
            end: result.conditions.end,
            status: result.status,
            hops: result.status === "found" ? result.path.length - 1 : null,
            mode: result.conditions.mode,
            hasExclusions: !!result.conditions.excluded.length,
            completedAt: now(),
          },
          ...remaining,
        ].slice(0, 5);
        try {
          storage().setItem(
            storageKey,
            JSON.stringify({ version: 1, entries: state.entries }),
          );
          state.storageWarning = "";
        } catch {
          state.storageWarning =
            "探索记录未能保存，当前页面仍可查看，刷新后可能丢失。";
        }
        const profiles = Object.fromEntries(
          users.map(({ id, name, avatar, fetchedAt }) => [
            id,
            { name, avatar, fetchedAt },
          ]),
        );
        mergeProfiles(profiles);
        const version = revision;
        void (async () => {
          try {
            // The shared store overwrites directly. Compare these two profiles
            // before writing so a stale page does not roll back known newer data.
            const cached = await store.read({ users: Object.keys(profiles) });
            if (version !== revision) return;
            const updates = Object.fromEntries(
              Object.entries(profiles).filter(
                ([id, profile]) =>
                  !Object.hasOwn(cached.users, id) ||
                  cached.users[id].fetchedAt <= profile.fetchedAt,
              ),
            );
            mergeProfiles({ ...cached.users, ...updates });
            state.cacheWarning = "";
            onUpdate();
            if (Object.keys(updates).length)
              await store.commit({ users: updates });
          } catch {
            if (version !== revision) return;
            state.cacheWarning = "用户资料缓存保存失败，探索记录仍保留。";
            onUpdate();
          }
        })();
      },
    };
  }

  const modes = ["mutual", "directed", "undirected"];
  const initialMessage = "选两位班友，看看相隔几跳。";

  function immutable(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value))
      return value;
    return Object.freeze(
      Array.isArray(value)
        ? value.map(immutable)
        : Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, immutable(item)]),
          ),
    );
  }
  function endpoint(user, now) {
    return {
      input: user?.id ?? "",
      user: user ? immutable({ ...user, fetchedAt: now() }) : null,
      activity: "idle",
      error: null,
    };
  }

  /**
   * state and subscription values are immutable snapshots, stable until the next
   * notification. Endpoint activity is idle/resolving/randomizing; operation
   * permissions are derived here, not by callers. Subscriptions publish immediately.
   */
  function createSession({
    site,
    store,
    storage,
    current,
    randomUsers,
    now = Date.now,
  }) {
    try {
      storage?.()?.removeItem("bangumi-six-degrees:last-success");
    } catch {
      // Storage denial must not prevent opening or network searches.
    }
    const exclusions = createExclusions({
      site,
      store,
      storage,
      now,
      onUpdate: () => emit(),
      onChange: () => {
        clearResult();
        emit();
      },
    });
    const history = createHistory({
      store,
      storage,
      now,
      onUpdate: () => emit(),
    });
    const state = {
      exclusions: exclusions.state,
      history: history.state,
      visible: false,
      phase: "idle",
      mode: "mutual",
      endpoints: [endpoint(current, now), endpoint(null, now)],
      result: null,
      message: initialMessage,
      progress: { visited: 0, observations: 0 },
      warning: "",
    };
    const busy = () => ["resolving", "running"].includes(state.phase);
    const permissions = () => ({
      canEdit: !busy(),
      canRun:
        !busy() &&
        state.exclusions.activity !== "resolving" &&
        !state.endpoints.some((item) => item.activity === "randomizing"),
      canStop:
        busy() ||
        state.exclusions.activity === "resolving" ||
        state.endpoints.some((item) => item.activity !== "idle"),
    });
    let snapshot = immutable({ ...state, ...permissions() });
    const listeners = new Set();
    const emit = () => {
      snapshot = immutable({ ...state, ...permissions() });
      for (const listener of listeners) listener(snapshot);
    };
    const versions = [0, 0],
      resolving = [null, null],
      promises = [null, null];
    let controller;
    const warn = (text) => {
      state.warning = text;
      emit();
    };
    function clearResult() {
      state.result = null;
      state.warning = "";
      state.progress = { visited: 0, observations: 0 };
      if (!busy()) {
        state.phase = "idle";
        state.message = initialMessage;
      }
    }
    function cancelEndpoint(index) {
      versions[index]++;
      resolving[index]?.abort();
      resolving[index] = null;
      promises[index] = null;
      state.endpoints[index].activity = "idle";
    }
    function setInput(index, value) {
      if (!permissions().canEdit) return;
      cancelEndpoint(index);
      Object.assign(state.endpoints[index], {
        input: value,
        user: null,
        error: null,
      });
      clearResult();
      emit();
    }
    function selectedIds() {
      const ids = [];
      for (const { input, user } of state.endpoints) {
        if (user) ids.push(user.id);
        try {
          ids.push(normalizeInput(input));
        } catch {
          // An unfinished input is not a confirmed identity.
        }
      }
      return new Set(ids);
    }
    function loadEndpoint(index, task, random = false) {
      cancelEndpoint(index);
      const version = versions[index];
      const abort = new AbortController();
      resolving[index] = abort;
      const item = state.endpoints[index];
      item.activity = random ? "randomizing" : "resolving";
      item.error = null;
      emit();
      const promise = (async () => {
        try {
          let user;
          do {
            user = await task(abort.signal);
            if (versions[index] !== version || abort.signal.aborted) return;
            // Another endpoint may have published the same candidate meanwhile.
          } while (random && selectedIds().has(user.id));
          item.input = user.id;
          item.user = immutable({ ...user, fetchedAt: now() });
          clearResult();
        } catch (error) {
          if (versions[index] === version && !abort.signal.aborted) {
            item.error = {
              code: error?.code ?? "unknown",
              message: error?.message ?? String(error),
            };
            if (!random) item.user = null;
          }
        } finally {
          if (versions[index] === version) {
            item.activity = "idle";
            resolving[index] = null;
            promises[index] = null;
            emit();
          }
        }
      })();
      promises[index] = promise;
      return promise;
    }
    function resolveEndpoint(index) {
      if (promises[index]) return promises[index];
      const { input, user } = state.endpoints[index];
      if (!input.trim() || user?.id === input) return Promise.resolve();
      return loadEndpoint(index, (signal) => site.resolve(input, { signal }));
    }
    async function execute(conditions, abort) {
      state.phase = "running";
      clearResult();
      state.message = "正在沿好友关系寻找最短路径…";
      emit();
      const source = createDataSource({
        store,
        site,
        initialUsers: state.endpoints.flatMap(({ user }) =>
          user ? [user] : [],
        ),
        onWarning: (text) => {
          if (controller === abort && !abort.signal.aborted) warn(text);
        },
      });
      try {
        const result = await search({
          ...conditions,
          source,
          signal: abort.signal,
          onProgress: (progress) => {
            if (controller === abort && !abort.signal.aborted) {
              state.progress = progress;
              state.message =
                progress.stage === "relations"
                  ? "正在核实路径上的好友方向…"
                  : "正在沿好友关系寻找最短路径…";
              emit();
            }
          },
        });
        abort.signal.throwIfAborted();
        const users = await source.users(
          result.status === "found"
            ? result.path
            : [conditions.start, conditions.end],
          { signal: abort.signal },
        );
        abort.signal.throwIfAborted();
        if (result.status === "found") {
          state.result = immutable({
            status: "found",
            conditions,
            relations: result.relations,
            path: result.path.map(
              (id) => users.get(id) ?? { id, name: id, avatar: "" },
            ),
          });
          state.message =
            result.path.length === 1
              ? "同一位班友，0 跳。"
              : `相隔 ${result.path.length - 1} 跳`;
        } else {
          state.result = immutable({ ...result, conditions });
          state.message = {
            unreachable: "已确认不可达",
            incomplete: "关系数据不足，路径待确认。",
            invalid: "端点属于已识别的原站无效节点。",
          }[result.status];
        }
        state.phase = "complete";
        history.record(state.result, [
          users.get(conditions.start),
          users.get(conditions.end),
        ]);
      } catch (error) {
        if (controller !== abort) return;
        const stopped = abort.signal.aborted;
        if (!stopped) abort.abort(error);
        state.phase = stopped ? "stopped" : "error";
        state.message = stopped
          ? "探索已停止。"
          : `${state.progress.stage === "relations" ? "好友方向核实中断" : "本次探索中断"}：${error.message}`;
      } finally {
        if (controller === abort) {
          controller = undefined;
          emit();
        }
      }
    }
    return {
      get state() {
        return snapshot;
      },
      subscribe(listener) {
        listeners.add(listener);
        listener(snapshot);
        return () => listeners.delete(listener);
      },
      setInput,
      clearHistory() {
        history.clear();
        emit();
      },
      setExcludedInput(value) {
        if (permissions().canEdit) exclusions.setInput(value);
      },
      addExcluded() {
        return permissions().canEdit ? exclusions.add() : Promise.resolve();
      },
      removeExcluded(id) {
        if (permissions().canEdit) exclusions.remove(id);
      },
      cancelExcluded() {
        exclusions.cancel();
      },
      resolve(index) {
        return permissions().canEdit
          ? resolveEndpoint(index)
          : Promise.resolve();
      },
      open() {
        state.visible = true;
        emit();
      },
      close() {
        state.visible = false;
        emit();
      },
      setMode(mode) {
        if (permissions().canEdit && modes.includes(mode)) {
          state.mode = mode;
          clearResult();
          emit();
        }
      },
      swap() {
        if (!permissions().canEdit) return;
        for (let index = 0; index < 2; index++) cancelEndpoint(index);
        state.endpoints.reverse();
        clearResult();
        emit();
      },
      async fill(index, id) {
        if (!id || !permissions().canEdit) return;
        setInput(index, id);
        await resolveEndpoint(index);
      },
      async random(index) {
        if (!permissions().canEdit) return;
        await loadEndpoint(
          index,
          (signal) => randomUsers.pick({ signal, exclude: selectedIds }),
          true,
        );
      },
      async run() {
        if (!permissions().canRun) return;
        if (state.endpoints.some(({ input }) => !input.trim())) {
          for (const item of state.endpoints)
            item.error = item.input.trim()
              ? null
              : { code: "input-required", message: "请先填入用户" };
          emit();
          return;
        }
        clearResult();
        const abort = new AbortController();
        controller = abort;
        state.phase = "resolving";
        state.message = "正在确认两位用户…";
        emit();
        await Promise.all(
          [0, 1].map((index) =>
            state.endpoints[index].user ? undefined : resolveEndpoint(index),
          ),
        );
        if (abort.signal.aborted) return;
        if (state.endpoints.some(({ user }) => !user)) {
          state.phase = "error";
          state.message = "请先修正用户输入。";
          controller = undefined;
          emit();
          return;
        }
        await execute(
          {
            start: state.endpoints[0].user.id,
            end: state.endpoints[1].user.id,
            mode: state.mode,
            excluded: state.exclusions.users.map(({ id }) => id),
          },
          abort,
        );
      },
      stop() {
        exclusions.cancel();
        if (!permissions().canStop) return;
        controller?.abort(new DOMException("用户停止探索", "AbortError"));
        randomUsers?.cancel();
        for (let index = 0; index < 2; index++) cancelEndpoint(index);
        state.phase = "stopped";
        state.message = "探索已停止。";
        emit();
      },
    };
  }

  const styles = `
.bsd-overlay {
  --bsd-bg: #fffdfb; --bsd-fg: #393640; --bsd-muted: #827b86;
  --bsd-soft: #faf4f5; --bsd-line: #ede5e8; --bsd-pink: #da6583; --bsd-shadow: #bc55752a;
  position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
  padding: 24px; background: #28212e82; backdrop-filter: blur(5px); box-sizing: border-box; color-scheme: light;
}
.bsd-overlay[hidden], .bsd-overlay [hidden] { display: none !important; }
.bsd-dialog {
  width: min(880px, 100%); min-width: 0; max-height: 90dvh; display: flex; flex-direction: column;
  color: var(--bsd-fg); background: var(--bsd-bg); border: 1px solid var(--bsd-line); border-radius: 26px;
  box-shadow: 0 30px 100px #16101d50; font: 14px/1.65 system-ui, sans-serif; text-align: left; overflow: hidden;
  animation: bsd-open .3s cubic-bezier(.2,.8,.2,1);
}
.bsd-dialog * { box-sizing: border-box; }
.bsd-dialog button, .bsd-dialog input, .bsd-dialog select { font: inherit; color: inherit; }
.bsd-dialog button { cursor: pointer; transition: transform .18s, box-shadow .18s, background .18s; }
.bsd-dialog button:disabled { opacity: .45; cursor: default; }
.bsd-dialog button:not(:disabled):active { transform: scale(.96); }
.bsd-dialog :focus, .bsd-entry-link:focus { outline: none; }
.bsd-overlay[data-focus="keyboard"] :focus, .bsd-entry-link[data-focus="keyboard"]:focus {
  outline: 2px solid #da6583; outline-color: var(--bsd-pink, #da6583); outline-offset: 3px;
}
.bsd-dialog button, .bsd-dialog a, .bsd-dialog input, .bsd-dialog select { -webkit-tap-highlight-color: transparent; }
.bsd-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 23px 30px 20px; flex: none; }
.bsd-header h2 { margin: 0; font-size: 23px; letter-spacing: -.04em; line-height: 1.4; color: var(--bsd-fg); }
.bsd-header small { display: block; margin-top: 3px; color: var(--bsd-muted); font-size: 12px; }
.bsd-dialog .bsd-close { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border: 1px solid var(--bsd-line); background: none; border-radius: 50%; line-height: 1; flex: none; }
.bsd-close svg { display: block; width: 16px; height: 16px; pointer-events: none; }
.bsd-close:hover { background: var(--bsd-soft); }
.bsd-body { padding: 0 22px 5px; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--bsd-pink) transparent; }
.bsd-workspace { padding: 20px 22px 16px; border-radius: 20px; background: var(--bsd-soft); position: relative; overflow: hidden; }
.bsd-workspace::before { content: ""; position: absolute; inset: 0; opacity: .12; background-image: radial-gradient(var(--bsd-muted) .7px, transparent .7px); background-size: 23px 23px; pointer-events: none; }
.bsd-top { display: grid; grid-template-columns: minmax(0,1fr) 33px minmax(0,1fr); align-items: center; gap: 22px; position: relative; }
.bsd-endpoint { display: grid; grid-template-columns: 58px minmax(0,1fr); align-items: center; gap: 12px; min-width: 0; padding: 14px; border: 1px solid var(--bsd-line); border-radius: 20px; background: var(--bsd-bg); }
.bsd-avatar-link { display: block; border-radius: 11px; }
.bsd-avatar-link:not([href]) { cursor: default; }
.bsd-avatar-link img { display: block; border-radius: inherit; object-fit: cover; transition: transform .2s; }
.bsd-avatar-link[href]:hover img { transform: translateY(-4px) rotate(-3deg); }
.bsd-user-name { color: var(--bsd-fg); font-weight: 650; line-height: 1.65; }
.bsd-user-id { color: var(--bsd-muted); font-size: 11px; line-height: 1.65; }
.bsd-endpoint .bsd-avatar-link { border-radius: 19px; }
.bsd-avatar { display: block; width: 58px; height: 58px; background: var(--bsd-soft); box-shadow: 0 5px 14px var(--bsd-shadow); }
.bsd-endpoint-info { min-width: 0; }
.bsd-endpoint-label { display: block; margin-bottom: 2px; color: var(--bsd-muted); font-size: 10px; }
.bsd-endpoint-name, .bsd-endpoint-placeholder { display: block; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bsd-endpoint-placeholder { font-weight: 650; }
.bsd-input, .bsd-exclusions-input { display: flex; align-items: center; gap: 5px; min-width: 0; padding: 5px 10px; border: 1px solid var(--bsd-line); border-radius: 12px; font-size: 12px; color: var(--bsd-fg); }
.bsd-input > span, .bsd-exclusions-input > span { flex: none; }
.bsd-input input, .bsd-exclusions-input input { min-width: 0; width: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; font-size: 12px; box-shadow: none; }
.bsd-shortcuts { display: flex; flex-wrap: wrap; gap: 8px; }
.bsd-shortcuts button { padding: 4px 0 0; border: 0; background: none; color: var(--bsd-pink); font-size: 11px; box-shadow: none; }
.bsd-shortcuts button:hover { text-decoration: underline; }
.bsd-endpoint[data-randomizing="true"] .bsd-avatar { animation: bsd-shuffle .7s ease-in-out infinite; }
.bsd-swap { padding: 0; width: 33px; height: 33px; border: 1px solid var(--bsd-line); border-radius: 50%; background: var(--bsd-bg); color: var(--bsd-pink) !important; font-size: 19px !important; line-height: 1; }
.bsd-swap:hover:not(:disabled) { transform: rotate(180deg); }
.bsd-mode { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); align-items: center; gap: 10px; padding: 18px 0; position: relative; }
.bsd-mode-choice { grid-column: 2; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 10px; }
.bsd-dialog .bsd-exclusions-toggle { grid-column: 3; justify-self: end; white-space: nowrap; padding: 4px 2px; border: 0; border-radius: 4px; background: transparent; color: var(--bsd-muted); font-size: 11px; box-shadow: none; }
.bsd-exclusions-toggle::after { content: ""; display: inline-block; width: 6px; height: 6px; margin: 0 3px 3px 7px; border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg); }
.bsd-exclusions-toggle[aria-expanded="true"]::after { margin-bottom: 0; transform: rotate(225deg); }
.bsd-dialog .bsd-exclusions-toggle:hover { color: var(--bsd-fg); background: #00000008; }
.bsd-dialog .bsd-exclusions-toggle:not(:disabled):active { transform: none; }
.bsd-exclusions { position: relative; margin-bottom: 18px; padding: 14px 16px; border: 1px solid var(--bsd-line); border-radius: 16px; background: var(--bsd-bg); }
.bsd-exclusions-note, .bsd-exclusions-empty, .bsd-exclusions-feedback, .bsd-exclusions-warning { margin: 0; color: var(--bsd-muted); font-size: 11px; overflow-wrap: anywhere; }
.bsd-exclusions-entry { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.bsd-exclusions-input { flex: 1; }
.bsd-exclusions-entry button { flex: none; padding: 5px 12px; border: 1px solid var(--bsd-line); border-radius: 14px; background: var(--bsd-soft); color: var(--bsd-pink); font-size: 12px; }
.bsd-exclusions-entry [data-action="cancel-excluded"] { padding-inline: 5px; border-color: transparent; background: transparent; color: var(--bsd-muted); }
.bsd-exclusions-feedback:not(:empty), .bsd-exclusions-warning, .bsd-exclusions-empty { margin-top: 8px; }
.bsd-exclusions-warning { color: #a96c20; }
.bsd-exclusions-list { margin: 8px 0 0; padding: 0; list-style: none; }
.bsd-exclusions-list:empty { display: none; }
.bsd-excluded-user { display: grid; grid-template-columns: 32px minmax(0,1fr) auto; align-items: center; gap: 10px; padding: 9px 0; }
.bsd-excluded-user + .bsd-excluded-user { border-top: 1px solid var(--bsd-line); }
.bsd-excluded-user img { width: 32px; height: 32px; background: var(--bsd-soft); }
.bsd-excluded-user div { min-width: 0; }
.bsd-excluded-user strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.bsd-excluded-user small { display: block; overflow-wrap: anywhere; }
.bsd-excluded-user button { padding: 4px 0 4px 8px; border: 0; background: transparent; color: var(--bsd-pink); font-size: 11px; }
.bsd-excluded-user button:hover:not(:disabled) { text-decoration: underline; }
.bsd-mode-trigger { border: 1px solid var(--bsd-line); background: var(--bsd-bg); border-radius: 20px; padding: 6px 15px; font-size: 12px !important; }
.bsd-mode-options { position: fixed; z-index: 1; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--bsd-pink) transparent; padding: 5px; box-sizing: border-box; border: 1px solid var(--bsd-line); border-radius: 16px; background: var(--bsd-bg); color: var(--bsd-fg); font: 12px/1.65 system-ui, sans-serif; text-align: center; }
.bsd-mode-options [role="option"] { padding: 8px; border-radius: 11px; cursor: pointer; }
.bsd-mode-options [role="option"]:hover, .bsd-mode-options [data-active="true"] { background: var(--bsd-soft); }
.bsd-mode-options [aria-selected="true"] { color: var(--bsd-pink); font-weight: 700; }
.bsd-mode-note { color: var(--bsd-muted); font-size: 11px; }
.bsd-results { position: relative; min-width: 0; min-height: 210px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px 0 10px; text-align: center; border-top: 1px solid var(--bsd-line); }
.bsd-results > [role="status"] { max-width: 100%; }
.bsd-status-label { color: var(--bsd-muted); font-size: 11px; }
.bsd-status-label::before { content: ""; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--bsd-pink); margin-right: 7px; vertical-align: middle; }
.bsd-message { font-size: 23px; font-weight: 650; line-height: 1.4; letter-spacing: -.04em; margin: 10px 0; overflow-wrap: anywhere; }
.bsd-hop-count { color: var(--bsd-pink); font-size: 44px; font-weight: 750; padding: 0 4px; }
.bsd-detail, .bsd-progress { color: var(--bsd-muted); font-size: 12px; margin: 7px 0; }
.bsd-detail:empty { display: none; }
.bsd-idle-mark { display: flex; align-items: center; gap: 24px; margin-bottom: 16px; position: relative; }
.bsd-idle-mark::before { content: ""; position: absolute; left: 10px; right: 10px; border-top: 1px dashed var(--bsd-pink); opacity: .35; }
.bsd-idle-mark i { width: 13px; height: 13px; border: 3px solid var(--bsd-bg); border-radius: 50%; background: var(--bsd-pink); position: relative; opacity: .6; }
.bsd-idle-mark i:nth-child(2) { width: 9px; height: 9px; }
.bsd-pulse { display: flex; gap: 11px; margin: 22px 0; }
.bsd-pulse i { width: 6px; height: 6px; border-radius: 50%; background: var(--bsd-pink); animation: bsd-pulse 1.6s infinite; }
.bsd-pulse i:nth-child(2) { animation-delay: .2s; }.bsd-pulse i:nth-child(3) { animation-delay: .4s; }
.bsd-output { width: 100%; min-width: 0; }
.bsd-path { position: relative; display: grid; align-items: start; gap: 40px 16px; width: 100%; margin: 6px auto 0; padding: 20px 16px 12px; }
.bsd-path-user { position: relative; display: flex; flex-direction: column; align-items: center; justify-self: center; width: 100%; max-width: 78px; min-width: 0; animation: bsd-appear .4s both; animation-delay: calc(var(--bsd-step) * 90ms); }
.bsd-path-user .bsd-avatar-link { border-radius: 18px; }
.bsd-path-lines { position: absolute; inset: 0; pointer-events: none; color: var(--bsd-pink); overflow: visible; }
.bsd-path-connection { pointer-events: stroke; animation: bsd-connect .4s both; animation-delay: calc(var(--bsd-step) * 90ms); }
.bsd-path-endpoint { margin-top: 5px; color: var(--bsd-pink); font-size: 10px; }
.bsd-path img { width: 52px; height: 52px; }
.bsd-path strong, .bsd-path small { display: block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.bsd-path strong { margin-top: 6px; font-size: 11px; }.bsd-path small { font-size: 10px; }
.bsd-egg { color: var(--bsd-muted); font-size: 11px; margin: 10px 0; }
.bsd-warning { color: #a96c20; font-size: 12px; margin: 10px 0; overflow-wrap: anywhere; }
.bsd-history { position: relative; margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--bsd-line); }
.bsd-history header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.bsd-history h3 { margin: 0; color: var(--bsd-muted); font-size: 12px; font-weight: 600; }
.bsd-history [data-action="clear-history"] { padding: 4px 0 4px 8px; border: 0; background: transparent; color: var(--bsd-pink); font-size: 11px; }
.bsd-history [data-action="clear-history"]:hover { text-decoration: underline; }
.bsd-history-list { margin: 6px 0 0; padding: 0; list-style: none; }
.bsd-history-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; padding: 12px 0; }
.bsd-history-row + .bsd-history-row { border-top: 1px solid var(--bsd-line); }
.bsd-history-main { display: flex; flex-wrap: wrap; align-items: center; flex: 1 1 440px; min-width: 0; gap: 10px 20px; }
.bsd-history-pair { display: grid; grid-template-columns: fit-content(180px) 14px fit-content(180px); align-items: center; gap: 10px; width: fit-content; min-width: 0; max-width: 100%; }
.bsd-history-user { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 180px; }
.bsd-history-user a { flex: none; }
.bsd-history-user img { width: 32px; height: 32px; background: var(--bsd-soft); }
.bsd-history-user > div { min-width: 0; }
.bsd-history-user strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.bsd-history-user small { display: block; overflow-wrap: anywhere; }
.bsd-history-arrow { display: block; flex: none; width: 14px; height: 14px; color: var(--bsd-muted); }
.bsd-history-summary { display: flex; align-items: baseline; flex: none; gap: 6px; white-space: nowrap; }
.bsd-history-result { color: var(--bsd-fg); font-size: 12px; }
.bsd-history-hops { color: var(--bsd-pink); font-weight: 650; }
.bsd-history-mode, .bsd-history-meta { color: var(--bsd-muted); font-size: 11px; line-height: 1.65; }
.bsd-history-meta { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; margin-left: auto; max-width: 100%; }
.bsd-history-meta time { overflow-wrap: anywhere; }
.bsd-footer { display: flex; align-items: center; justify-content: space-between; flex: none; gap: 16px; padding: 18px 28px; border-top: 1px solid var(--bsd-line); }
.bsd-hint { min-width: 0; color: var(--bsd-muted); font-size: 12px; overflow-wrap: anywhere; }
.bsd-actions { display: flex; flex: none; gap: 10px; }
.bsd-actions button { border: 1px solid var(--bsd-line); background: transparent; border-radius: 28px; padding: 9px 17px; box-shadow: none; }
.bsd-actions [data-action="explore"] { padding: 10px 25px; border: 0; background: linear-gradient(120deg, #dc728e, #eaa2ad); color: #fff; font-weight: 750; box-shadow: 0 6px 17px var(--bsd-shadow); }
.bsd-actions [data-action="explore"]:hover:not(:disabled) { transform: translateY(-3px); box-shadow: 0 9px 22px var(--bsd-shadow); }
/* Keep fixed-position options viewport-relative, including during dialog entry. */
@keyframes bsd-open { from { opacity: 0; } to { opacity: 1; } }
@keyframes bsd-appear { from { opacity: 0; transform: translateY(12px) scale(.9); } to { opacity: 1; transform: none; } }
@keyframes bsd-connect { from { opacity: 0; } to { opacity: 1; } }
@keyframes bsd-pulse { 0%, 100% { opacity: .3; transform: scale(.8); } 50% { opacity: 1; transform: scale(1.15); } }
@keyframes bsd-shuffle { 25% { transform: rotate(-8deg); } 70% { transform: rotate(6deg); } }
[data-theme="dark"] .bsd-exclusions-toggle:hover { background: #ffffff0d; }
[data-theme="dark"] .bsd-overlay { --bsd-bg: #2b2831; --bsd-fg: #f2e9ef; --bsd-muted: #b6aab9; --bsd-soft: #36303c; --bsd-line: #4c404d; --bsd-pink: #f09bb2; --bsd-shadow: #0004; color-scheme: dark; }
@media (max-width: 600px) {
  .bsd-overlay { padding: 12px; }.bsd-dialog { max-height: 94dvh; border-radius: 21px; }
  .bsd-header { padding: 18px 20px 15px; }.bsd-header h2 { font-size: 20px; }
  .bsd-body { padding: 0 12px 5px; }.bsd-workspace { padding: 15px; }
  .bsd-top { grid-template-columns: minmax(0,1fr); gap: 7px; }
  .bsd-endpoint { padding: 9px 13px; grid-template-columns: 44px minmax(0,1fr); }.bsd-avatar { width: 44px; height: 44px; }.bsd-endpoint .bsd-avatar-link { border-radius: 14px; }
  .bsd-swap { justify-self: center; width: 27px; height: 27px; font-size: 16px !important; transform: rotate(90deg); }
  .bsd-mode { display: flex; flex-direction: column; gap: 9px; }.bsd-mode-choice { gap: 6px; }.bsd-mode-note { width: 100%; text-align: center; }
  .bsd-dialog .bsd-exclusions-toggle { align-self: flex-end; }
  .bsd-exclusions { padding: 12px; }.bsd-exclusions-entry { gap: 5px; }.bsd-exclusions-entry button { padding-inline: 9px; }
  .bsd-message { font-size: 20px; }.bsd-hop-count { font-size: 38px; }.bsd-detail, .bsd-progress { font-size: 11px; }
  .bsd-footer { padding: 14px 18px; flex-wrap: wrap; gap: 10px; }.bsd-hint { font-size: 10px; }.bsd-actions { margin-left: auto; }
  .bsd-actions [data-action="explore"] { padding: 10px 20px; }
}
@media (prefers-reduced-motion: reduce) {
  .bsd-avatar-link[href]:hover img { transform: none; }
  .bsd-dialog, .bsd-dialog *, .bsd-dialog *::before, .bsd-dialog *::after { animation: none !important; transition: none !important; }
}
`;

  // A select-only combobox: focus stays on the trigger; candidates never commit
  // until explicitly activated. The popup lives outside the clipped dialog body.
  function mountModePicker(window, overlay, trigger, names, onChange) {
    const { document } = window;
    const values = Object.keys(names);
    const popup = document.createElement("div");
    popup.className = "bsd-mode-options";
    popup.id = "bsd-mode-options";
    popup.hidden = true;
    popup.setAttribute("role", "listbox");
    popup.setAttribute("aria-label", "关系模式");
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-controls", popup.id);
    trigger.setAttribute("aria-expanded", "false");
    const options = values.map((value, index) => {
      const option = document.createElement("div");
      option.id = `bsd-mode-option-${index}`;
      option.setAttribute("role", "option");
      option.textContent = names[value];
      popup.append(option);
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => commit(index));
      return option;
    });
    overlay.querySelector('[role="dialog"]').append(popup);
    let selected = 0;
    let candidate = 0;
    function highlight() {
      options.forEach((option, index) => {
        option.dataset.active = String(index === candidate);
        option.setAttribute("aria-selected", String(index === selected));
      });
      trigger.setAttribute("aria-activedescendant", options[candidate].id);
      options[candidate].scrollIntoView?.({ block: "nearest" });
    }
    function position() {
      if (popup.hidden) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const down = below >= Math.min(popup.scrollHeight, 150) || below >= above;
      popup.style.maxHeight = `${Math.max(0, down ? below : above)}px`;
      popup.style.width = `${Math.min(rect.width, window.innerWidth - margin * 2)}px`;
      popup.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - popup.offsetWidth - margin))}px`;
      popup.style.top = `${down ? rect.bottom + 4 : Math.max(margin, rect.top - popup.offsetHeight - 4)}px`;
    }
    function close() {
      popup.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
    }
    function open() {
      if (trigger.disabled) return;
      candidate = selected;
      popup.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      position();
      highlight();
    }
    function commit(index) {
      if (trigger.disabled || popup.hidden) return;
      close();
      trigger.focus({ preventScroll: true });
      onChange(values[index]);
    }
    trigger.addEventListener("click", () => {
      if (popup.hidden) open();
      else close();
    });
    trigger.addEventListener("blur", close);
    trigger.addEventListener("keydown", (event) => {
      if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey)
        return;
      const { key } = event;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
        event.preventDefault();
        if (popup.hidden) open();
        else if (key === "ArrowDown")
          candidate = (candidate + 1) % values.length;
        else if (key === "ArrowUp")
          candidate = (candidate + values.length - 1) % values.length;
        if (key === "Home") candidate = 0;
        if (key === "End") candidate = values.length - 1;
        highlight();
      } else if (key === "Enter" || key === " ") {
        event.preventDefault();
        if (event.repeat) return;
        if (popup.hidden) open();
        else commit(candidate);
      } else if (key === "Tab") close();
    });
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (!trigger.contains(event.target) && !popup.contains(event.target))
          close();
      },
      true,
    );
    window.addEventListener("resize", position);
    // Capture nested body scrolling as well as page/viewport changes.
    document.addEventListener(
      "scroll",
      (event) => {
        if (!popup.contains(event.target)) position();
      },
      true,
    );
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return {
      close,
      get expanded() {
        return !popup.hidden;
      },
      update(value, disabled, visible) {
        selected = values.indexOf(value);
        trigger.textContent = `${names[value]} ▾`;
        trigger.disabled = disabled;
        if (disabled || !visible) close();
        if (!popup.hidden) highlight();
        options.forEach((option, index) =>
          option.setAttribute("aria-selected", String(index === selected)),
        );
      },
    };
  }

  const svgNS = "http://www.w3.org/2000/svg";

  // Layout only: the DOM and tab order remain the original start-to-end sequence.
  function layoutPath(window, path, relations) {
    const nodes = [...path.querySelectorAll(".bsd-path-user")];
    const svg = window.document.createElementNS(svgNS, "svg");
    svg.classList.add("bsd-path-lines");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    path.prepend(svg);
    const markerId = "bsd-path-arrow";
    svg.innerHTML = `<defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="currentColor" stroke-width="1.5"/></marker></defs>`;
    const lines = nodes.slice(1).map((_, index) => {
      const line = window.document.createElementNS(svgNS, "path");
      line.classList.add("bsd-path-connection");
      line.style.setProperty("--bsd-step", Math.min(index + 0.5, 7));
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("stroke-width", "1.5");
      if (relations[index].description) {
        const title = window.document.createElementNS(svgNS, "title");
        title.textContent = relations[index].description;
        line.append(title);
      }
      if (relations[index].forward)
        line.setAttribute("marker-end", `url(#${markerId})`);
      if (relations[index].reverse)
        line.setAttribute("marker-start", `url(#${markerId})`);
      svg.append(line);
      return line;
    });
    function update() {
      const width = path.clientWidth;
      if (!width) return; // Hidden dialogs get measured when reopened.
      // 78px nodes, 16px column gaps and 16px padding on each side.
      const columns = Math.min(
        nodes.length,
        Math.max(1, Math.floor((width - 16 * 2 + 16) / (78 + 16))),
      );
      path.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      nodes.forEach((node, index) => {
        const row = Math.floor(index / columns);
        const column = index % columns;
        node.style.gridRow = String(row + 1);
        node.style.gridColumn = String(
          (row % 2 ? columns - column - 1 : column) + 1,
        );
      });
      // offset geometry is unaffected by the staggered entrance animation.
      const centers = nodes.map((node) => ({
        x: node.offsetLeft + node.offsetWidth / 2,
        y: node.offsetTop + 26,
      }));
      lines.forEach((line, index) => {
        const a = centers[index],
          b = centers[index + 1];
        const turn =
          Math.floor(index / columns) !== Math.floor((index + 1) / columns);
        if (!turn) {
          const direction = b.x > a.x ? 1 : -1;
          line.setAttribute(
            "d",
            `M ${a.x + direction * 30} ${a.y} H ${b.x - direction * 30}`,
          );
        } else {
          const direction =
            columns === 1 || Math.floor(index / columns) % 2 === 0 ? 1 : -1;
          const edge = a.x + direction * 44;
          const radius = 10;
          line.setAttribute(
            "d",
            `M ${a.x + direction * 30} ${a.y} H ${edge - direction * radius} Q ${edge} ${a.y} ${edge} ${a.y + radius} V ${b.y - radius} Q ${edge} ${b.y} ${edge - direction * radius} ${b.y} H ${b.x + direction * 30}`,
          );
        }
      });
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(path.clientHeight));
    }
    const observer = window.ResizeObserver
      ? new window.ResizeObserver(update)
      : null;
    observer?.observe(path);
    nodes.forEach((node) => observer?.observe(node));
    window.addEventListener("resize", update);
    update();
    return {
      update,
      destroy() {
        observer?.disconnect();
        window.removeEventListener("resize", update);
      },
    };
  }

  const defaultAvatar = "https://lain.bgm.tv/pic/user/l/icon.jpg";
  const modeNames = {
    mutual: "双向好友",
    directed: "单向好友",
    undirected: "无向关联",
  };
  const modeNotes = {
    mutual: "每一步，双方都添加了对方",
    directed: "沿起点 → 终点的好友关系前进",
    undirected: "每一步，任意一方添加对方即可",
  };
  function image(element, url) {
    const src = url || defaultAvatar;
    if (element.getAttribute("src") === src) return;
    element.onerror = () => {
      element.onerror = null;
      element.src = defaultAvatar;
    };
    element.src = src;
  }
  function text(element, value) {
    if (element.textContent !== value) element.textContent = value;
  }
  function endpointError(error, index) {
    const user = `${index === 0 ? "起点" : "终点"}用户`;
    const messages = {
      "input-required": `请先填入${user}标识`,
      "invalid-input": `请输入有效的${user}标识`,
      "profile-missing": `无法识别${user}，请检查原站页面`,
      "profile-identity": `无法识别${user}`,
      timeout: `获取${user}超时，请稍后重试`,
      network: `暂时无法获取${user}，请稍后重试`,
    };
    return Object.hasOwn(messages, error.code)
      ? messages[error.code]
      : `获取${user}时出错：${error.message}`;
  }
  function status(state) {
    const result = state.result;
    const mode = modeNames[result?.conditions.mode ?? state.mode];
    if (result) {
      const restrictions = result.conditions.excluded?.length
        ? "与当前排除条件"
        : "";
      return {
        found: [
          "已确认最短路径",
          `${mode} · 结论基于本次关系数据${restrictions}`,
        ],
        unreachable: [
          "探索完成",
          `结论基于本次关系数据与「${mode}」模式${restrictions}。`,
        ],
        incomplete: ["路径待确认", "可以重新探索，或调整关系模式。"],
        invalid: ["调整用户", "请调整起点或终点用户后重新探索。"],
      }[result.status];
    }
    return {
      idle: ["等待探索", "填入用户标识，或试试随机班友。"],
      resolving: ["确认用户", "确认完成后开始探索好友关系。"],
      running: ["正在探索", ""],
      stopped: ["已停止", "已获取的有效关系缓存保留，可重新探索。"],
      error: ["探索结束", "调整输入或稍后重新探索。"],
    }[state.phase];
  }
  function mountView(window, session, { self, services }) {
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
    <header class="bsd-header"><div><h2 id="bsd-title">六度分隔</h2><small>你与 TA，相隔几跳？</small></div><button type="button" class="bsd-close" aria-label="关闭六度分隔"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
    <div class="bsd-body"><div class="bsd-workspace"><div class="bsd-top">
      ${endpoint("起点用户", 0)}
      <button type="button" class="bsd-swap" data-action="swap" aria-label="交换起点与终点">⇄</button>
      ${endpoint("终点用户", 1)}
    </div><div class="bsd-mode"><div class="bsd-mode-choice"><button type="button" class="bsd-mode-trigger" aria-label="关系模式"></button><span class="bsd-mode-note"></span></div><button type="button" class="bsd-exclusions-toggle" data-action="toggle-exclusions" aria-expanded="false" aria-controls="bsd-exclusions">排除中转</button></div>
    <section id="bsd-exclusions" class="bsd-exclusions" aria-label="排除中转名单" hidden>
      <p class="bsd-exclusions-note">以下班友不会作为中转，仍可作为起点或终点。</p>
      <div class="bsd-exclusions-entry"><label class="bsd-exclusions-input"><span>@</span><input aria-label="排除中转的用户标识" aria-describedby="bsd-exclusions-feedback" placeholder="请输入用户标识" autocomplete="off" spellcheck="false"></label><button type="button" data-action="add-excluded">添加</button><button type="button" data-action="cancel-excluded" hidden>取消</button></div>
      <p id="bsd-exclusions-feedback" class="bsd-exclusions-feedback" role="status"></p><p class="bsd-exclusions-warning" role="status" hidden></p>
      <p class="bsd-exclusions-empty">暂未排除班友。</p><ul class="bsd-exclusions-list"></ul>
    </section>
    <div class="bsd-results"><div class="bsd-idle-mark" aria-hidden="true"><i></i><i></i><i></i></div><div role="status"><span class="bsd-status-label"></span><h3 class="bsd-message"></h3><p class="bsd-detail"></p></div><div class="bsd-progress"></div><div class="bsd-pulse" aria-hidden="true" hidden><i></i><i></i><i></i></div><div class="bsd-output"></div><p class="bsd-warning" role="status" hidden></p></div>
    <section class="bsd-history" aria-labelledby="bsd-history-title" hidden><header><h3 id="bsd-history-title">最近探索</h3><button type="button" data-action="clear-history">清空记录</button></header><ul class="bsd-history-list"></ul></section></div></div>
    <footer class="bsd-footer"><span id="bsd-hint" class="bsd-hint" role="status"></span><div class="bsd-actions"><button type="button" data-action="stop" hidden>停止探索</button><button type="button" data-action="explore">开始探索 ↗</button></div></footer>
  </section>`;
    function endpoint(label, index) {
      return `<div class="bsd-endpoint" data-endpoint="${index}"><a class="bsd-avatar-link" target="_blank" rel="noopener noreferrer"><img class="bsd-avatar" alt=""></a><div class="bsd-endpoint-info"><span class="bsd-endpoint-label">${label}</span><strong class="bsd-endpoint-name bsd-user-name"></strong><span class="bsd-endpoint-placeholder">选择一位班友</span><label class="bsd-input"><span>@</span><input aria-label="${label}" aria-describedby="bsd-hint" placeholder="请输入用户标识" autocomplete="off" spellcheck="false"></label><div class="bsd-shortcuts"><button type="button" data-fill="self" title="填入自己">填入自己</button><button type="button" data-action="random" aria-label="随机班友">随机班友</button></div></div></div>`;
    }
    document.body.append(overlay);
    const dialog = overlay.querySelector('[role="dialog"]');
    const modeTrigger = overlay.querySelector(".bsd-mode-trigger");
    const modePicker = mountModePicker(
      window,
      overlay,
      modeTrigger,
      modeNames,
      (mode) => session.setMode(mode),
    );
    const explore = overlay.querySelector('[data-action="explore"]');
    const stop = overlay.querySelector('[data-action="stop"]');
    const endpoints = [...overlay.querySelectorAll(".bsd-endpoint")];
    const exclusionsToggle = overlay.querySelector(
      '[data-action="toggle-exclusions"]',
    );
    const exclusionsPanel = overlay.querySelector(".bsd-exclusions");
    const excludedInput = exclusionsPanel.querySelector("input");
    const addExcluded = exclusionsPanel.querySelector(
      '[data-action="add-excluded"]',
    );
    const cancelExcluded = exclusionsPanel.querySelector(
      '[data-action="cancel-excluded"]',
    );
    const excludedRows = new Map();
    function toggleExclusions(expanded) {
      exclusionsToggle.setAttribute("aria-expanded", String(expanded));
      exclusionsPanel.hidden = !expanded;
      if (!expanded && exclusionsPanel.contains(document.activeElement))
        exclusionsToggle.focus({ preventScroll: true });
    }
    exclusionsToggle.addEventListener("click", () =>
      toggleExclusions(exclusionsPanel.hidden),
    );
    excludedInput.addEventListener("input", () =>
      session.setExcludedInput(excludedInput.value),
    );
    excludedInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      if (!event.repeat) void session.addExcluded();
    });
    addExcluded.addEventListener("click", () => void session.addExcluded());
    cancelExcluded.addEventListener("click", () => session.cancelExcluded());
    function renderExclusions(state, busy) {
      const exclusions = state.exclusions;
      if (excludedInput.value !== exclusions.input)
        excludedInput.value = exclusions.input;
      excludedInput.disabled = busy;
      const resolving = exclusions.activity === "resolving";
      addExcluded.disabled = busy || resolving || !exclusions.input.trim();
      cancelExcluded.hidden = !resolving;
      text(addExcluded, resolving ? "确认中…" : "添加");
      text(
        exclusionsPanel.querySelector(".bsd-exclusions-feedback"),
        exclusions.message,
      );
      const warning = exclusionsPanel.querySelector(".bsd-exclusions-warning");
      text(warning, exclusions.cacheWarning);
      warning.hidden = !warning.textContent;
      exclusionsPanel.querySelector(".bsd-exclusions-empty").hidden =
        !!exclusions.users.length;
      const ids = new Set(exclusions.users.map(({ id }) => id));
      for (const [id, row] of excludedRows) {
        if (ids.has(id)) continue;
        row.remove();
        excludedRows.delete(id);
      }
      for (const user of exclusions.users) {
        let row = excludedRows.get(user.id);
        if (!row) {
          row = document.createElement("li");
          row.className = "bsd-excluded-user";
          row.innerHTML =
            '<a class="bsd-avatar-link" target="_blank" rel="noopener noreferrer"><img alt=""></a><div><strong class="bsd-user-name"></strong><small class="bsd-user-id"></small></div><button type="button">移除</button>';
          const profile = row.querySelector("a");
          profile.href = `/user/${encodeURIComponent(user.id)}`;
          profile.setAttribute("aria-label", `打开 @${user.id} 的主页`);
          const remove = row.querySelector("button");
          remove.dataset.remove = user.id;
          remove.setAttribute("aria-label", `移除 @${user.id}`);
          remove.addEventListener("click", () =>
            session.removeExcluded(user.id),
          );
          excludedRows.set(user.id, row);
          exclusionsPanel.querySelector("ul").append(row);
        }
        image(row.querySelector("img"), user.avatar);
        text(row.querySelector("strong"), user.name || user.id);
        row.querySelector("strong").title = user.name || user.id;
        text(row.querySelector("small"), `@${user.id}`);
        row.querySelector("button").disabled = busy;
      }
    }
    const historySection = overlay.querySelector(".bsd-history");
    historySection
      .querySelector('[data-action="clear-history"]')
      .addEventListener("click", () => {
        if (
          window.confirm(
            "清空全部最近探索记录？此操作不会清除当前结果或共享缓存。",
          )
        )
          session.clearHistory();
      });
    const historyList = historySection.querySelector("ul");
    const historyRows = new Map();
    function renderHistory(history) {
      historySection.hidden = !history.entries.length;
      const key = ({ start, end, mode }) => JSON.stringify([start, end, mode]);
      const keys = new Set(history.entries.map(key));
      for (const [id, row] of historyRows) {
        if (keys.has(id)) continue;
        row.remove();
        historyRows.delete(id);
      }
      let previous = null;
      for (const entry of history.entries) {
        const id = key(entry);
        let row = historyRows.get(id);
        if (!row) {
          row = document.createElement("li");
          row.className = "bsd-history-row";
          row.innerHTML =
            '<div class="bsd-history-main"><div class="bsd-history-pair" role="group" aria-label="探索端点，按起点至终点排列"></div><div class="bsd-history-summary"><span class="bsd-history-result"></span><small class="bsd-history-mode"></small></div></div><small class="bsd-history-meta"><span class="bsd-history-restriction"></span><time></time></small>';
          const pair = row.querySelector(".bsd-history-pair");
          for (const [index, userId] of [entry.start, entry.end].entries()) {
            if (index) {
              const arrow = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "svg",
              );
              arrow.classList.add("bsd-history-arrow");
              arrow.setAttribute("viewBox", "0 0 16 16");
              arrow.setAttribute("aria-hidden", "true");
              arrow.setAttribute("focusable", "false");
              arrow.innerHTML =
                '<path d="M3 8h10m-4-4 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';
              pair.append(arrow);
            }
            const user = document.createElement("div");
            user.className = "bsd-history-user";
            user.innerHTML =
              '<a class="bsd-avatar-link" target="_blank" rel="noopener noreferrer"><img alt=""></a><div><strong class="bsd-user-name"></strong><small class="bsd-user-id"></small></div>';
            const link = user.querySelector("a");
            link.href = `/user/${encodeURIComponent(userId)}`;
            link.setAttribute("aria-label", `打开 @${userId} 的主页`);
            text(user.querySelector("small"), `@${userId}`);
            pair.append(user);
          }
          historyRows.set(id, row);
        }
        const next = previous
          ? previous.nextElementSibling
          : historyList.firstElementChild;
        if (next !== row) {
          const focused = row.contains(document.activeElement)
            ? document.activeElement
            : null;
          historyList.insertBefore(row, next);
          // Moving an existing row can blur its link; restore without scrolling.
          if (focused && document.activeElement !== focused)
            focused.focus({ preventScroll: true });
        }
        previous = row;
        row.querySelectorAll(".bsd-history-user").forEach((element, index) => {
          const userId = index === 0 ? entry.start : entry.end;
          const profile = Object.hasOwn(history.users, userId)
            ? history.users[userId]
            : {};
          const name = element.querySelector("strong");
          text(name, profile.name || userId);
          name.title = name.textContent;
          image(element.querySelector("img"), profile.avatar);
        });
        const result = row.querySelector(".bsd-history-result");
        if (entry.status === "found") {
          const count = document.createElement("span");
          count.className = "bsd-history-hops";
          count.textContent = String(entry.hops);
          result.replaceChildren(count, " 跳");
        } else text(result, "不可达");
        text(
          row.querySelector(".bsd-history-mode"),
          `· ${modeNames[entry.mode]}`,
        );
        const restriction = row.querySelector(".bsd-history-restriction");
        restriction.hidden = !entry.hasExclusions;
        text(restriction, entry.hasExclusions ? "含排除条件 ·" : "");
        const date = new Date(entry.completedAt);
        const time = row.querySelector("time");
        time.dateTime = date.toISOString();
        text(
          time,
          date.toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
        );
        time.title = date.toLocaleString();
      }
    }
    const message = overlay.querySelector(".bsd-message");
    const output = overlay.querySelector(".bsd-output");
    function inputMode(mode) {
      overlay.dataset.focus = mode;
      launcher.dataset.focus = mode;
    }
    inputMode("pointer");
    const inComponent = (target) =>
      overlay.contains(target) || entry.contains(target);
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (inComponent(event.target)) inputMode("pointer");
      },
      true,
    );
    let inputEnterHeld = false;
    document.addEventListener("keyup", (event) => {
      if (event.key === "Enter") inputEnterHeld = false;
    });
    window.addEventListener("blur", () => {
      inputEnterHeld = false;
    });
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.isComposing) return;
        if (event.key === "Escape" && session.state.visible) {
          event.preventDefault();
          inputMode("keyboard");
          if (modePicker.expanded) {
            modePicker.close();
            modeTrigger.focus({ preventScroll: true });
          } else if (!exclusionsPanel.hidden) {
            toggleExclusions(false);
            exclusionsToggle.focus({ preventScroll: true });
          } else close();
          return;
        }
        // Holding Enter must not activate another control after the input blurs.
        if (event.key === "Enter" && event.repeat && inputEnterHeld) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === "Tab") {
          inputMode("keyboard");
          return;
        }
        if (!inComponent(event.target)) return;
        if (
          event.key === "Escape" ||
          (event.key === "Enter" &&
            !event.target.closest("input,textarea,[contenteditable]")) ||
          (!event.target.closest("input,textarea,[contenteditable]") &&
            [
              " ",
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
            ].includes(event.key))
        )
          inputMode("keyboard");
      },
      true,
    );
    endpoints.forEach((element, index) => {
      const input = element.querySelector("input");
      input.addEventListener("input", () =>
        session.setInput(index, input.value),
      );
      input.addEventListener("blur", () => {
        if (session.state.canEdit) void session.resolve(index);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.isComposing) {
          event.preventDefault();
          if (event.repeat) return;
          inputEnterHeld = true;
          input.blur();
        }
      });
      element
        .querySelector('[data-fill="self"]')
        .addEventListener("click", () => void session.fill(index, self));
      element
        .querySelector('[data-action="random"]')
        .addEventListener("click", () => void session.random(index));
    });
    overlay
      .querySelector('[data-action="swap"]')
      .addEventListener("click", () => session.swap());
    explore.addEventListener("click", () => void session.run());
    stop.addEventListener("click", () => session.stop());
    const close = () => {
      modePicker.close();
      session.close();
      launcher.focus();
    };
    overlay.querySelector(".bsd-close").addEventListener("click", close);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
    overlay.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusable = [
        ...dialog.querySelectorAll(
          "button:not(:disabled):not([hidden]),input:not(:disabled),select:not(:disabled),a[href]",
        ),
      ].filter((element) => !element.closest("[hidden]"));
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
      const empty = endpoints.find(
        (element) => !element.querySelector("input").value,
      );
      (
        empty?.querySelector("input:not(:disabled)") ??
        dialog.querySelector("input:not(:disabled)") ??
        (!stop.hidden ? stop : dialog.querySelector("button"))
      )?.focus();
    });
    let pathLayout;
    function renderResult(result) {
      pathLayout?.destroy();
      pathLayout = null;
      output.replaceChildren();
      delete output.dataset.result;
      if (!result) return;
      output.dataset.result = result.status;
      if (result.status !== "found") return;
      const path = document.createElement("div");
      path.className = "bsd-path";
      path.setAttribute("role", "group");
      path.setAttribute("aria-label", "已确认的最短关系路径，按起点到终点排列");
      const relations = result.relations.map((relation, index) => {
        const from = `@${result.path[index].id}`;
        const to = `@${result.path[index + 1].id}`;
        return {
          ...relation,
          description:
            relation.forward && relation.reverse
              ? `${from} 与 ${to} 互相添加为好友`
              : relation.forward
                ? `${from} 将 ${to} 添加为好友`
                : `${to} 将 ${from} 添加为好友`,
        };
      });
      result.path.forEach((user, index) => {
        const node = document.createElement("div");
        node.className = "bsd-path-user";
        node.style.setProperty("--bsd-step", Math.min(index, 7));
        const link = document.createElement("a");
        link.className = "bsd-avatar-link";
        link.setAttribute("aria-label", `打开 @${user.id} 的主页`);
        link.href = `/user/${encodeURIComponent(user.id)}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const avatar = document.createElement("img");
        avatar.alt = "";
        image(avatar, user.avatar);
        const name = document.createElement("strong");
        name.className = "bsd-user-name";
        name.textContent = user.name || user.id;
        name.title = name.textContent;
        const id = document.createElement("small");
        id.className = "bsd-user-id";
        id.textContent = `@${user.id}`;
        link.append(avatar);
        node.append(link, name, id);
        if (index === 0 || index === result.path.length - 1) {
          const label = document.createElement("span");
          label.className = "bsd-path-endpoint";
          label.textContent =
            result.path.length === 1
              ? "起点 / 终点"
              : index === 0
                ? "起点"
                : "终点";
          node.append(label);
        }
        path.append(node);
        if (relations[index]) {
          const description = document.createElement("span");
          description.id = `bsd-path-relation-${index}`;
          // Direct aria-describedby references expose hidden text without a
          // duplicate stop in reading order or an extra grid item.
          description.hidden = true;
          description.textContent = relations[index].description;
          link.setAttribute("aria-describedby", description.id);
          path.append(description);
        }
      });
      output.append(path);
      pathLayout = layoutPath(window, path, relations);
      if (result.path.length > 7) {
        const egg = document.createElement("p");
        egg.className = "bsd-egg";
        egg.textContent = "六度之外，还有班友。";
        output.append(egg);
      }
    }
    let lastResult;
    session.subscribe((state) => {
      const active = document.activeElement;
      const hadFocus = dialog.contains(active);
      overlay.hidden = !state.visible;
      dialog.hidden = !state.visible;
      const busy = !state.canEdit;
      renderExclusions(state, busy);
      renderHistory(state.history);
      const randomizing = state.endpoints.some(
        ({ activity }) => activity === "randomizing",
      );
      endpoints.forEach((element, index) => {
        const item = state.endpoints[index];
        const input = element.querySelector("input");
        if (input.value !== item.input) input.value = item.input;
        input.disabled = busy;
        input.setAttribute("aria-invalid", String(!!item.error));
        element.dataset.randomizing = String(item.activity === "randomizing");
        const user = item.user;
        const name = element.querySelector(".bsd-endpoint-name");
        text(name, user?.name || user?.id || "");
        name.title = name.textContent;
        name.hidden = !user;
        element.querySelector(".bsd-endpoint-placeholder").hidden = !!user;
        image(element.querySelector("img"), user?.avatar);
        const profile = element.querySelector(".bsd-avatar-link");
        if (user) {
          profile.href = `/user/${encodeURIComponent(user.id)}`;
          profile.setAttribute("aria-label", `打开 @${user.id} 的主页`);
        } else {
          profile.removeAttribute("href");
          profile.removeAttribute("aria-label");
        }
        const selfButton = element.querySelector('[data-fill="self"]');
        selfButton.disabled = busy || !self;
        selfButton.title = self ? "填入自己" : "无法识别登录用户";
        const randomButton = element.querySelector('[data-action="random"]');
        randomButton.disabled = busy;
        randomButton.setAttribute(
          "aria-busy",
          String(item.activity === "randomizing"),
        );
      });
      modePicker.update(state.mode, busy, state.visible);
      text(overlay.querySelector(".bsd-mode-note"), modeNotes[state.mode]);
      overlay.querySelector('[data-action="swap"]').disabled = busy;
      explore.disabled = !state.canRun;
      text(explore, busy ? "探索中…" : "开始探索 ↗");
      stop.hidden = !state.canStop;
      text(
        stop,
        randomizing
          ? "停止抽取"
          : state.exclusions.activity === "resolving"
            ? "取消添加"
            : "停止探索",
      );
      const [label, detail] = status(state);
      text(overlay.querySelector(".bsd-status-label"), label);
      text(overlay.querySelector(".bsd-detail"), detail);
      if (state.result?.status === "found") {
        if (lastResult !== state.result) {
          const hops = state.result.path.length - 1;
          const count = document.createElement("span");
          count.className = "bsd-hop-count";
          count.textContent = String(hops);
          message.replaceChildren(
            hops === 0 ? "同一位班友，" : "相隔 ",
            count,
            hops === 0 ? " 跳。" : " 跳",
          );
        }
      } else text(message, state.message);
      const running = state.phase === "running";
      const progress = overlay.querySelector(".bsd-progress");
      progress.hidden = !running;
      text(
        progress,
        running
          ? `已触达 ${state.progress.visited} 位用户 · 已读取 ${state.progress.observations} 份关系列表`
          : "",
      );
      overlay.querySelector(".bsd-pulse").hidden = !running;
      overlay.querySelector(".bsd-idle-mark").hidden = state.phase !== "idle";
      const warning = overlay.querySelector(".bsd-warning");
      text(warning, state.warning);
      warning.hidden = !state.warning;
      const hints = state.endpoints.flatMap(({ error }, index) =>
        error ? [endpointError(error, index)] : [],
      );
      if (state.exclusions.storageWarning)
        hints.push(state.exclusions.storageWarning);
      for (const warning of [
        state.history.storageWarning,
        state.history.cacheWarning,
      ])
        if (warning) hints.push(warning);
      if (randomizing) hints.push("正在抽取班友…");
      const resolving = state.endpoints.flatMap(({ activity }, index) =>
        activity === "resolving" ? [index === 0 ? "起点用户" : "终点用户"] : [],
      );
      if (resolving.length) hints.push(`正在确认${resolving.join("和")}…`);
      text(overlay.querySelector(".bsd-hint"), hints.join("；"));
      if (lastResult !== state.result) {
        renderResult(state.result);
        lastResult = state.result;
      }
      if (state.visible) pathLayout?.update();
      if (
        state.visible &&
        hadFocus &&
        (!active.isConnected || active.disabled || active.closest("[hidden]"))
      )
        (stop.hidden ? explore : stop).focus({ preventScroll: true });
    });
    return launcher;
  }

  const rangeKey = "bangumi-six-degrees:random-range";
  // Successful numeric home locator, not a measured population or verified UID.
  const defaultSeed = {
    range: 1294903,
    observed: 1294892,
    checkedAt: Date.parse("2026-10-24T01:14:19.022Z"),
  };
  const day = 86400000;
  const positive = (value) => Number.isSafeInteger(value) && value > 0;

  function createRandomUsers({
    site,
    store,
    storage,
    now = Date.now,
    random = Math.random,
    sleep = delay,
    seed = defaultSeed,
  }) {
    let record = { ...seed };
    try {
      const saved = JSON.parse(storage?.()?.getItem(rangeKey) ?? "null");
      if (
        saved &&
        positive(saved.range) &&
        positive(saved.observed) &&
        saved.range >= saved.observed &&
        Number.isSafeInteger(saved.checkedAt) &&
        saved.checkedAt >= 0 &&
        saved.checkedAt <= now()
      )
        record = {
          range: Math.max(seed.range, saved.range),
          observed: Math.max(seed.observed, saved.observed),
          checkedAt: saved.checkedAt,
        };
    } catch {
      // The built-in range also works without localStorage.
    }
    let background,
      controller,
      lastAttempt = -Infinity;

    function refresh() {
      if (background || now() - lastAttempt < 3600000) return;
      lastAttempt = now();
      const abort = new AbortController();
      controller = abort;
      background = (async () => {
        await Promise.resolve();
        try {
          let lower = record.observed;
          let step = Math.max(
            1,
            Math.ceil((Math.max(0, now() - record.checkedAt) / day) * 512),
          );
          let upper = Math.max(record.range, lower) + step;
          // High-ID holes are deliberately ignored: this is a heuristic bracket.
          while (true) {
            abort.signal.throwIfAborted();
            if (!positive(upper)) throw new Error("抽样范围超出安全整数范围");
            const user = await site.candidate(upper, { signal: abort.signal });
            abort.signal.throwIfAborted();
            if (!user) break;
            lower = upper;
            step *= 2;
            upper = lower + step;
          }
          while (upper - lower >= 10000) {
            const middle = lower + Math.floor((upper - lower) / 2);
            const user = await site.candidate(middle, { signal: abort.signal });
            abort.signal.throwIfAborted();
            if (user) lower = middle;
            else upper = middle;
          }
          abort.signal.throwIfAborted();
          record = { range: upper - 1, observed: lower, checkedAt: now() };
          try {
            storage?.()?.setItem(rangeKey, JSON.stringify(record));
          } catch {
            // A denied write only prevents reuse on another page.
          }
        } catch {
          // Temporary failures/cancellation leave the previous range untouched.
        } finally {
          if (controller === abort) {
            controller = undefined;
            background = undefined;
          }
        }
      })();
    }

    return {
      cancel() {
        controller?.abort();
      },
      async pick({ signal, exclude = () => new Set() } = {}) {
        signal ??= new AbortController().signal;
        signal.throwIfAborted();
        const range = record.range;
        refresh();
        while (true) {
          signal.throwIfAborted();
          const number = 1 + Math.floor(random() * range);
          if (!exclude().has(String(number))) {
            const user = await site.candidate(number, { signal });
            signal.throwIfAborted();
            if (user && !exclude().has(user.id)) {
              const abort = new AbortController();
              const candidateSignal = AbortSignal.any([signal, abort.signal]);
              try {
                const source = createDataSource({
                  store,
                  site,
                  initialUsers: [user],
                });
                const records = await source.load(
                  [
                    [user.id, "friends"],
                    [user.id, "rev_friends"],
                  ],
                  { signal: candidateSignal },
                );
                signal.throwIfAborted();
                if (
                  records.every(
                    ({ snapshot }) => snapshot.status === "available",
                  ) &&
                  !exclude().has(user.id)
                )
                  return user;
              } catch (error) {
                signal.throwIfAborted();
                if (error.status !== 404) throw error;
              } finally {
                abort.abort();
              }
            }
          }
          await sleep(200, signal);
        }
      },
    };
  }

  function selfIdentifier(window) {
    if (typeof window.CHOBITS_USERNAME === "string" && window.CHOBITS_USERNAME)
      return window.CHOBITS_USERNAME;
    const anchor = window.document.querySelector(
      '#dock a[href^="/user/"], #badgeUserPanel a.avatar[href]',
    );
    if (!anchor) return;
    try {
      const url = new URL(
        anchor?.getAttribute("href") ?? "",
        window.location.href,
      );
      return (
        (url.origin === window.location.origin &&
          /^\/user\/([^/]+)\/?$/.exec(url.pathname)?.[1]) ||
        undefined
      );
    } catch {
      return;
    }
  }
  function initialize(
    window,
    { fetch = (...args) => window.fetch(...args) } = {},
  ) {
    const { document, location } = window;
    if (
      location.protocol !== "https:" ||
      !["bgm.tv", "bangumi.tv", "chii.in"].includes(location.host) ||
      !/^\/user\/[^/]+\/?$/.test(location.pathname)
    )
      return;
    if (!document.body) {
      document.addEventListener(
        "DOMContentLoaded",
        () => initialize(window, { fetch }),
        { once: true },
      );
      return;
    }
    if (document.getElementById("bangumi-six-degrees-entry")) return;
    const services = document.querySelector(
      "#user_home .user_box ul.network_service",
    );
    if (!services) return;
    let current;
    try {
      current = readCurrentUser(document, location);
    } catch {
      return;
    }
    const requests = createRequests({ fetch });
    const site = createSite({ window, requests });
    const store = browserStore(window);
    const storage = () => window.localStorage;
    const randomUsers = createRandomUsers({ site, store, storage });
    const session = createSession({
      site,
      store,
      storage,
      current,
      randomUsers,
    });
    mountView(window, session, { self: selfIdentifier(window), services });
    window.addEventListener("pagehide", () => {
      session.stop();
      randomUsers.cancel();
    });

    return session;
  }

  initialize(window);
})();
