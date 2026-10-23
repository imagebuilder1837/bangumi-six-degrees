import { createRequests } from "./requests.mjs";
import { createSite, readUser } from "./site.mjs";
import { browserStore } from "./data.mjs";
import { createSession } from "./session.mjs";
import { mountView } from "./view.mjs";

function selfIdentifier(window) {
  if (typeof window.CHOBITS_USERNAME === "string" && window.CHOBITS_USERNAME)
    return window.CHOBITS_USERNAME;
  const anchor = window.document.querySelector(
    '#dock a[href^="/user/"], #badgeUserPanel a.avatar[href]',
  );
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
export function initialize(
  window,
  { fetch = (...args) => window.fetch(...args) } = {},
) {
  const { document, location } = window;
  if (
    location.protocol !== "https:" ||
    !["bgm.tv", "bangumi.tv", "chii.in"].includes(location.host) ||
    !/^\/user\/[^/]+\/(friends|rev_friends)\/?$/.test(location.pathname)
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
  let current;
  try {
    current = readUser(document, location.href).id;
  } catch {
    return;
  }
  let session;
  const requests = createRequests({
    fetch,
    onRequest: (count) => session?.countRequests(count),
  });
  const site = createSite({ window, requests });
  session = createSession({
    site,
    store: browserStore(window),
    storage: () => window.localStorage,
  });
  mountView(window, session, { self: selfIdentifier(window), current });
  return session;
}
