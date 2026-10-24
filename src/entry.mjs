import { createRequests } from "./requests.mjs";
import { createSite, readUser } from "./site.mjs";
import { browserStore } from "./data.mjs";
import { createSession } from "./session.mjs";
import { mountView } from "./view.mjs";
import { createRandomUsers } from "./random-users.mjs";

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
export function initialize(
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
