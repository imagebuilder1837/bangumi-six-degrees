export function graphSource(edges) {
  return {
    async load(keys) {
      return keys.map(([id, direction]) => ({
        id,
        direction,
        snapshot: {
          status: "available",
          fetchedAt: 1,
          members:
            direction === "friends"
              ? (edges[id] ?? [])
              : Object.keys(edges).filter((other) => edges[other].includes(id)),
        },
      }));
    },
  };
}

// Independent small-graph oracle: enumerate simple paths, not bidirectional BFS.
export function shortestLength(edges, start, end, mode) {
  let best = Infinity;
  function visit(id, seen) {
    if (id === end) {
      best = Math.min(best, seen.size - 1);
      return;
    }
    if (seen.size - 1 >= best) return;
    for (const other of Object.keys(edges)) {
      if (seen.has(other)) continue;
      const forward = edges[id].includes(other),
        reverse = edges[other].includes(id);
      if (
        !(mode === "directed"
          ? forward
          : mode === "mutual"
            ? forward && reverse
            : forward || reverse)
      )
        continue;
      visit(other, new Set([...seen, other]));
    }
  }
  visit(start, new Set([start]));
  return best;
}
