import { createDataSource } from "./data.mjs";
import { delay } from "./requests.mjs";

const rangeKey = "bangumi-six-degrees:random-range";
// Successful numeric home locator, not a measured population or verified UID.
const defaultSeed = {
  range: 1294903,
  observed: 1294892,
  checkedAt: Date.parse("2026-10-24T01:14:19.022Z"),
};
const day = 86400000;
const positive = (value) => Number.isSafeInteger(value) && value > 0;

export function createRandomUsers({
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
