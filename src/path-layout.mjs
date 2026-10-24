const svgNS = "http://www.w3.org/2000/svg";

// Layout only: the DOM and tab order remain the original start-to-end sequence.
export function layoutPath(window, path, mode) {
  const nodes = [...path.querySelectorAll("a")];
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
    if (mode !== "undirected")
      line.setAttribute("marker-end", `url(#${markerId})`);
    if (mode === "mutual")
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
