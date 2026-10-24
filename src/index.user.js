// ==UserScript==
// @name         Bangumi 六度分隔
// @namespace    https://github.com/imagebuilder1837/bangumi-six-degrees
// @version      0.1.0
// @description  探索两位 Bangumi 用户之间的最短好友关系链，支持双向好友、单向好友与无向关联三种模式。
// @author       imagebuilder1837
// @match        https://bgm.tv/user/*
// @match        https://bangumi.tv/user/*
// @match        https://chii.in/user/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/imagebuilder1837/bangumi-six-degrees/refs/heads/main/src/index.user.js
// @updateURL    https://raw.githubusercontent.com/imagebuilder1837/bangumi-six-degrees/refs/heads/main/src/index.user.js
// ==/UserScript==

// Generated from src/main.mjs and its imports, including vendor modules. Do not edit; run npm run build.
(function () {
  "use strict";

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
  class RequestError extends Error {
    constructor(message, retryable = false, status, url) {
      super(message);
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
    onRequest = () => {},
  }) {
    let active = 0,
      count = 0,
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
          () => controller.abort(new RequestError("请求超时", true)),
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
              count++;
              onRequest(count);
              let response;
              try {
                response = await fetch(url, {
                  credentials: "same-origin",
                  signal: controller.signal,
                });
              } catch (error) {
                controller.signal.throwIfAborted();
                throw new RequestError(error.message, true);
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
                  response.status === 408 ||
                    response.status === 429 ||
                    (response.status >= 500 && response.status <= 599),
                  response.status,
                  finalUrl,
                );
              try {
                return { text: await response.text(), url: finalUrl };
              } catch (error) {
                controller.signal.throwIfAborted();
                throw new RequestError(error.message, true);
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
      get count() {
        return count;
      },
      async text(url, options) {
        return (await page(url, options)).text;
      },
      page,
    };
  }

  const hosts = new Set(["bgm.tv", "bangumi.tv", "chii.in"]);
  function identifier$1(value) {
    if (!value || /[\s/?#@]/u.test(value))
      throw new Error("请输入有效的用户标识");
    return value;
  }
  function normalizeInput(input) {
    const text = input.trim();
    if (/^https?:\/\//i.test(text)) {
      const url = new URL(text);
      const match = /^\/user\/([^/]+)\/?$/.exec(url.pathname);
      if (!hosts.has(url.host) || url.username || url.password || !match)
        throw new Error("请输入有效的用户标识");
      return identifier$1(decodeURIComponent(match[1]));
    }
    return identifier$1(text.replace(/^@/, ""));
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
      return { status: "unavailable", members: [], pages: [] };
    if (identity(document, base) !== owner)
      throw new Error("关系页面身份不匹配");
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
        const pending = [
          `${origin}/user/${encodeURIComponent(id)}/${direction}`,
        ];
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
  const fields = (value, allowed) =>
    record(value) && Object.keys(value).every((key) => allowed.includes(key));
  const missingIssue = (issue) =>
    fields(issue, ["code", "count"]) &&
    issue.code === "missing-identifiers" &&
    Number.isSafeInteger(issue.count) &&
    issue.count > 0;
  const unavailableIssue = (issue) =>
    fields(issue, ["code"]) &&
    issue.code === "deleted-display-name-page-unavailable";

  function arrayOf(value, accepts) {
    if (!Array.isArray(value)) return false;
    // Iteration visits empty slots as undefined; Array#every skips them.
    for (const item of value) if (!accepts(item)) return false;
    return true;
  }

  function snapshot(value) {
    if (
      !fields(value, ["status", "members", "fetchedAt", "issue"]) ||
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
      fields(value, ["name", "avatar", "fetchedAt"]) &&
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
      !fields(entry, ["version", "value"]) ||
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
    requireInput(fields(query, ["relationships", "users"]));
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
    requireInput(fields(batch, ["relationships", "users"]));
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
       * Validate and detach input, then atomically merge by observation time.
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
          (transaction, fail) => {
            const merge = (name, key, value) => {
              const store = transaction.objectStore(name);
              readRecord(
                store,
                key,
                (previous) => {
                  if (!previous || value.fetchedAt >= previous.fetchedAt)
                    store.put({ version: 1, value }, key);
                },
                fail,
              );
            };
            for (const { name, key, value } of entries) merge(name, key, value);
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
      if (!warned) onWarning(`缓存不可用：${error.message}；网络结果不受影响`);
      warned = true;
    };
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
      async load(keys, { signal } = {}) {
        return Promise.all(
          keys.map(([id, direction]) => {
            const key = JSON.stringify([id, direction]);
            if (!loaded.has(key))
              loaded.set(
                key,
                (async () => {
                  const observation = await site.relationships(id, direction, {
                    signal,
                    name: profiles.get(id)?.name,
                  });
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
                  return {
                    id,
                    direction,
                    snapshot: observation.snapshot,
                    order,
                  };
                })(),
              );
            return loaded.get(key);
          }),
        );
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
      if (!forward && !reverse) return false;
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
    source,
    signal = new AbortController().signal,
    onProgress = () => {},
  }) {
    if (!["directed", "undirected", "mutual"].includes(mode))
      throw new Error("未知关系模式");
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
      onProgress({
        visited: new Set(sides.flatMap((side) => [...side.distances.keys()]))
          .size,
        observations,
      });
      if (
        meeting !== undefined &&
        length <= layers[0].depth + layers[1].depth
      ) {
        return { status: "found", path: pathThrough(sides, meeting) };
      }
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
      const records = keys[index].length
        ? await source.load(keys[index], { signal })
        : [];
      signal.throwIfAborted();
      for (const key of keys[index]) attempted.add(JSON.stringify(key));
      const affected = new Set();
      for (const record of records) {
        observations++;
        for (const id of graph.observe(record)) affected.add(id);
      }
      for (const id of layers[index].ids) {
        if (graph.complete(id, mode, index === 1)) affected.add(id);
        else sides[index].blocked.add(id);
      }
      sides.forEach((side, sideIndex) => {
        const changes = new Map();
        for (const id of affected) {
          if (
            side.expanded.has(id) ||
            (sideIndex === index &&
              layers[index].ids.includes(id) &&
              graph.complete(id, mode, sideIndex === 1))
          ) {
            changes.set(id, graph.neighbors(id, mode, sideIndex === 1));
          }
        }
        side.change(changes);
      });
    }
  }

  const modes = ["mutual", "directed", "undirected"];
  const initialMessage = "选两位班友，看看彼此隔着几次相遇。";
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
    const state = {
      visible: false,
      phase: "idle",
      mode: "mutual",
      inputs: [current?.id ?? "", ""],
      endpoints: [current ? { ...current, fetchedAt: now() } : null, null],
      errors: ["", ""],
      resolving: [false, false],
      randomizing: [false, false],
      result: null,
      message: initialMessage,
      progress: { visited: 0, observations: 0 },
      requests: 0,
      warning: "",
    };
    const listeners = new Set();
    const emit = () => {
      for (const listener of listeners) listener(state);
    };
    const busy = () => ["resolving", "running"].includes(state.phase);
    const versions = [0, 0],
      resolving = [null, null],
      promises = [null, null];
    let controller,
      baseline = 0;
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
      promises[index] = null;
      state.resolving[index] = false;
      state.randomizing[index] = false;
    }
    function setInput(index, value) {
      if (busy()) return;
      cancelEndpoint(index);
      state.inputs[index] = value;
      state.endpoints[index] = null;
      state.errors[index] = "";
      clearResult();
      emit();
    }
    function selectedIds() {
      const ids = state.endpoints.filter(Boolean).map((user) => user.id);
      for (const input of state.inputs) {
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
      state.resolving[index] = true;
      state.randomizing[index] = random;
      state.errors[index] = "";
      emit();
      const promise = (async () => {
        try {
          let user;
          do {
            user = await task(abort.signal);
            if (versions[index] !== version || abort.signal.aborted) return;
            // Another endpoint may have published the same candidate meanwhile.
          } while (random && selectedIds().has(user.id));
          state.inputs[index] = user.id;
          state.endpoints[index] = { ...user, fetchedAt: now() };
          clearResult();
        } catch (error) {
          if (versions[index] === version && !abort.signal.aborted) {
            state.errors[index] = error.message;
            if (!random) state.endpoints[index] = null;
          }
        } finally {
          if (versions[index] === version) {
            state.resolving[index] = false;
            state.randomizing[index] = false;
            promises[index] = null;
            emit();
          }
        }
      })();
      promises[index] = promise;
      return promise;
    }
    function resolve(index) {
      if (promises[index]) return promises[index];
      const input = state.inputs[index];
      if (!input.trim() || state.endpoints[index]?.id === input)
        return Promise.resolve();
      return loadEndpoint(index, (signal) => site.resolve(input, { signal }));
    }
    async function execute(conditions, abort) {
      baseline = state.requests;
      state.phase = "running";
      clearResult();
      state.message = "沿着好友关系，寻找最短的相遇路线…";
      emit();
      const source = createDataSource({
        store,
        site,
        initialUsers: state.endpoints.filter(Boolean),
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
              emit();
            }
          },
        });
        abort.signal.throwIfAborted();
        if (result.status === "found") {
          const users = await source.users(result.path, {
            signal: abort.signal,
          });
          abort.signal.throwIfAborted();
          state.result = {
            status: "found",
            conditions,
            path: result.path.map(
              (id) => users.get(id) ?? { id, name: id, avatar: "" },
            ),
          };
          state.message = `已确认最短路径 · ${result.path.length - 1} 跳`;
        } else {
          state.result = { ...result, conditions };
          state.message = {
            unreachable: "此关系模式下没有可达路径。",
            incomplete: "关系数据不完整，本次未能确定路径。",
            invalid: "端点属于已识别的原站无效节点，请换一位班友。",
          }[result.status];
        }
        state.phase = "complete";
      } catch (error) {
        if (controller !== abort) return;
        const stopped = abort.signal.aborted;
        if (!stopped) abort.abort(error);
        state.phase = stopped ? "stopped" : "error";
        state.message = stopped
          ? "已停止。已获取的有效关系缓存保留。"
          : `本次未能确定路径：${error.message}`;
      } finally {
        if (controller === abort) {
          controller = undefined;
          emit();
        }
      }
    }
    const session = {
      get state() {
        return state;
      },
      subscribe(listener) {
        listeners.add(listener);
        listener(state);
        return () => listeners.delete(listener);
      },
      setInput,
      resolve,
      open() {
        state.visible = true;
        emit();
      },
      close() {
        state.visible = false;
        emit();
      },
      setMode(mode) {
        if (!busy() && modes.includes(mode)) {
          state.mode = mode;
          clearResult();
          emit();
        }
      },
      swap() {
        if (busy()) return;
        for (let index = 0; index < 2; index++) cancelEndpoint(index);
        state.inputs.reverse();
        state.endpoints.reverse();
        state.errors.reverse();
        clearResult();
        emit();
      },
      async fill(index, id) {
        if (!id || busy()) return;
        setInput(index, id);
        await resolve(index);
      },
      async random(index) {
        if (busy()) return;
        await loadEndpoint(
          index,
          (signal) =>
            randomUsers.pick({
              signal,
              exclude: selectedIds,
            }),
          true,
        );
      },
      async run() {
        if (busy() || state.randomizing.some(Boolean)) return;
        if (state.inputs.some((value) => !value.trim())) {
          state.errors = state.inputs.map((value) =>
            value.trim() ? "" : "请先填入用户",
          );
          emit();
          return;
        }
        clearResult();
        const abort = new AbortController();
        controller = abort;
        state.phase = "resolving";
        state.message = "正在确认两个端点…";
        emit();
        await Promise.all(
          [0, 1].map((index) =>
            state.endpoints[index] ? undefined : resolve(index),
          ),
        );
        if (abort.signal.aborted) return;
        if (state.endpoints.some((user) => !user)) {
          state.phase = "error";
          state.message = "请先修正用户输入。";
          controller = undefined;
          emit();
          return;
        }
        await execute(
          {
            start: state.endpoints[0].id,
            end: state.endpoints[1].id,
            mode: state.mode,
          },
          abort,
        );
      },
      stop() {
        if (!busy() && !state.resolving.some(Boolean)) return;
        controller?.abort(new DOMException("用户停止探索", "AbortError"));
        randomUsers?.cancel();
        for (let index = 0; index < 2; index++) cancelEndpoint(index);
        state.phase = "stopped";
        state.message = "已停止。已获取的有效关系缓存保留。";
        emit();
      },
      countRequests(count) {
        state.requests = count;
        emit();
      },
      requestCount() {
        return state.requests - baseline;
      },
    };
    return session;
  }

  const styles = `
.bsd-overlay{--bsd-bg:#fff;--bsd-fg:#555;--bsd-soft:#f8f5f6;--bsd-line:#e8dfe3;position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;background:#0005;box-sizing:border-box}
.bsd-overlay[hidden],.bsd-dialog[hidden]{display:none!important}
.bsd-dialog{color:var(--bsd-fg);background:var(--bsd-bg);border:1px solid var(--bsd-line);border-radius:16px;box-shadow:0 16px 65px #0004;width:min(850px,100%);max-height:90dvh;min-height:430px;display:flex;flex-direction:column;font:14px/1.6 Arial,sans-serif;overflow:hidden;text-align:left}
.bsd-dialog *{box-sizing:border-box}.bsd-dialog button,.bsd-dialog input,.bsd-dialog select{font:inherit;color:inherit}
.bsd-dialog button{cursor:pointer}.bsd-dialog button:disabled{cursor:default;opacity:.5}
.bsd-dialog :focus-visible,.bsd-entry-link:focus-visible{outline:2px solid #f091a8;outline-offset:3px}
.bsd-header{display:flex;align-items:center;justify-content:space-between;padding:17px 22px;border-bottom:1px solid var(--bsd-line)}.bsd-header h2{font-size:20px;margin:0;color:var(--bsd-fg)}.bsd-header small{opacity:.65}
.bsd-close{border:0;background:none;font-size:25px!important;padding:0 8px}
.bsd-body{padding:22px;overflow:auto;overscroll-behavior:contain;flex:1}
.bsd-top{display:grid;grid-template-columns:minmax(0,1fr) 130px minmax(0,1fr);align-items:center;gap:14px}
.bsd-endpoint{display:grid;grid-template-columns:48px minmax(0,1fr);gap:10px;align-items:start}
.bsd-avatar-link{display:block;border-radius:8px}.bsd-avatar-link:not([href]){cursor:default}
.bsd-avatar{display:block;width:48px;height:48px;border-radius:8px;object-fit:cover;background:var(--bsd-soft)}
.bsd-endpoint-name{display:block;min-height:18px;font-size:13px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bsd-input{display:flex;width:100%;max-width:200px;align-items:center;gap:4px;border-bottom:2px solid var(--bsd-line);font-size:12px;line-height:18px}.bsd-input input{min-width:0;width:100%;border:0;background:none;padding:1px 0;outline-offset:0}
.bsd-shortcuts{display:flex;gap:9px;margin-top:4px}.bsd-shortcuts button,.bsd-swap{border:0;background:none;color:#d57c96!important;font-size:12px!important;padding:2px 0}
.bsd-error{display:block;color:#c75a70;min-height:1.3em;font-size:11px}.bsd-bridge{text-align:center}.bsd-bridge select{width:100%;border:1px solid var(--bsd-line);background:var(--bsd-soft);border-radius:15px;padding:4px}
.bsd-arrow{display:block;color:#f091a8;font-size:30px;line-height:1.2}.bsd-swap-row{text-align:center;margin:5px 0 16px}
.bsd-results{min-height:155px;display:flex;flex-direction:column;justify-content:center;text-align:center;border-radius:12px;background:var(--bsd-soft);padding:18px}
.bsd-message{margin:5px 0}.bsd-progress,.bsd-warning{font-size:12px;opacity:.75}.bsd-warning{color:#bf7c29}
.bsd-path{display:flex;align-items:center;gap:14px;overflow-x:auto;padding:12px 4px;text-align:center}
.bsd-path a{display:flex;flex-direction:column;align-items:center;flex:0 0 94px;max-width:110px;color:var(--bsd-fg);text-decoration:none;animation:bsd-appear .25s ease-out}
.bsd-path img{width:56px;height:56px;border-radius:12px;object-fit:cover}.bsd-path strong,.bsd-path small{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bsd-path small{font-size:11px;opacity:.7}
.bsd-path .bsd-link{color:#f091a8;font-size:24px;flex:none}.bsd-egg{color:#d57c96;font-size:12px}
.bsd-footer{display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;border-top:1px solid var(--bsd-line)}
.bsd-footer button{border-radius:18px;border:1px solid var(--bsd-line);padding:6px 22px;background:var(--bsd-soft)}
.bsd-footer [data-action="explore"]{background:#f091a8;border-color:#f091a8;color:white}.bsd-footer [hidden]{display:none}
@keyframes bsd-appear{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
[data-theme="dark"] .bsd-overlay{--bsd-bg:#29282d;--bsd-fg:#ddd;--bsd-soft:#333138;--bsd-line:#49424c}
@media(max-width:600px){.bsd-overlay{padding:12px}.bsd-dialog{max-height:94dvh;min-height:0}.bsd-body{padding:16px}.bsd-top{grid-template-columns:1fr}.bsd-bridge{display:flex;align-items:center;justify-content:center;gap:15px}.bsd-bridge select{width:145px}.bsd-arrow{transform:rotate(90deg);font-size:26px}.bsd-header{padding:12px 16px}.bsd-header small{display:none}.bsd-footer{padding:12px 16px}.bsd-results{min-height:130px}}
@media(prefers-reduced-motion:reduce){.bsd-path a{animation:none}}
`;

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
      input.addEventListener("input", () =>
        session.setInput(index, input.value),
      );
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
        element.querySelector(".bsd-error").textContent = state.randomizing[
          index
        ]
          ? "正在抽取班友…"
          : state.resolving[index]
            ? "正在确认用户…"
            : state.errors[index];
        const selfButton = element.querySelector('[data-fill="self"]');
        selfButton.disabled = busy || !self;
        selfButton.title = self ? "填入自己" : "无法识别登录用户";
        const randomButton = element.querySelector('[data-action="random"]');
        randomButton.disabled = busy;
        randomButton.setAttribute(
          "aria-busy",
          String(state.randomizing[index]),
        );
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
      if (background) return background;
      if (now() - lastAttempt < 3600000) return Promise.resolve();
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
      return background;
    }

    return {
      refresh,
      cancel() {
        controller?.abort();
      },
      async pick({ signal, exclude = () => new Set() } = {}) {
        signal ??= new AbortController().signal;
        signal.throwIfAborted();
        const range = record.range;
        void refresh();
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
      current = readUser(document, location.href);
    } catch {
      return;
    }
    let session;
    const requests = createRequests({
      fetch,
      onRequest: (count) => session?.countRequests(count),
    });
    const site = createSite({ window, requests });
    const store = browserStore(window);
    const storage = () => window.localStorage;
    const randomUsers = createRandomUsers({ site, store, storage });
    session = createSession({ site, store, storage, current, randomUsers });
    mountView(window, session, { self: selfIdentifier(window), services });
    window.addEventListener("pagehide", () => {
      session.stop();
      randomUsers.cancel();
    });

    return session;
  }

  initialize(window);
})();
