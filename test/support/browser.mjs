import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";

export function home(id, name = id) {
  return `<div id="headerProfile"><span class="avatarNeue" style="background-image:url('https://lain.bgm.tv/${id}.jpg')"></span><h1 class="nameSingle"><span class="inner"><span class="name"><a href="/user/${id}">${name}</a><small class="grey">@${id}</small></span></span></h1><div class="navTabs"><a href="/user/${id}/friends">好友</a></div></div>`;
}
export function listing(id, members, profiles = {}) {
  return `${home(id, profiles[id]?.name ?? id)}<ul id="memberUserList" class="usersMedium">${members.map((other) => `<li class="user"><div class="userContainer"><strong><a class="avatar" href="/user/${other}"><span class="userImage"><span class="avatarNeue" style="background-image:url('https://lain.bgm.tv/${other}.jpg')"></span></span>${profiles[other]?.name ?? other}</a></strong></div></li>`).join("")}</ul>`;
}
export function browser({
  edges = { alice: ["bob"], bob: [] },
  profiles = {},
  aliases = { 1: "alice" },
  indexedDB = new IDBFactory(),
  beforeFetch,
  storage,
} = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body>${home("alice")}<div id="dock"><a href="/user/self">自己</a></div></body></html>`,
    { url: "https://bgm.tv/user/alice/friends" },
  );
  const { window } = dom;
  Object.defineProperty(window, "indexedDB", { value: indexedDB });
  if (storage)
    for (const [key, value] of Object.entries(storage))
      window.localStorage.setItem(key, value);
  const urls = [];
  const fetch = async (url, options) => {
    urls.push(url);
    await beforeFetch?.(url, options);
    const [raw, direction] = new URL(url).pathname.split("/").slice(2);
    const id = aliases[decodeURIComponent(raw)] ?? decodeURIComponent(raw);
    const members =
      direction === "friends"
        ? (edges[id] ?? [])
        : Object.keys(edges).filter((other) => edges[other].includes(id));
    return new Response(
      direction
        ? listing(id, members, profiles)
        : home(id, profiles[id]?.name ?? id),
    );
  };
  return { window, dom, fetch, urls, indexedDB };
}
export { until } from "./async.mjs";
export function input(window, label, value) {
  const element = window.document.querySelector(`input[aria-label="${label}"]`);
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
  element.dispatchEvent(new window.Event("blur"));
}
