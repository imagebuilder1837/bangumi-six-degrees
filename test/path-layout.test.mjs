import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { layoutPath } from "../src/path-layout.mjs";

test("蛇形布局随宽度重排，保留用户顺序、方向与完整长路径", () => {
  for (const pattern of [
    [{ forward: true, reverse: false }],
    [{ forward: false, reverse: true }],
    [{ forward: true, reverse: true }],
    [
      { forward: true, reverse: false },
      { forward: false, reverse: true },
      { forward: true, reverse: true },
    ],
  ]) {
    for (const count of [1, 2, 6, 7, 8, 9, 15]) {
      const { window } = new JSDOM("<div></div>");
      const path = window.document.querySelector("div");
      let width = 344;
      Object.defineProperty(path, "clientWidth", { get: () => width });
      Object.defineProperty(path, "clientHeight", { get: () => 700 });
      const nodes = Array.from({ length: count }, (_, index) => {
        const node = window.document.createElement("div");
        node.className = "bsd-path-user";
        node.textContent = `班友${index}`;
        Object.defineProperties(node, {
          offsetLeft: {
            get: () => (Number(node.style.gridColumn) - 1) * 94 + 16,
          },
          offsetTop: { get: () => (Number(node.style.gridRow) - 1) * 180 + 20 },
          offsetWidth: { get: () => 78 },
        });
        path.append(node);
        return node;
      });
      let observerCallback;
      let disconnected = false;
      window.ResizeObserver = class {
        constructor(callback) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {
          disconnected = true;
        }
      };
      const relations = Array.from(
        { length: count - 1 },
        (_, index) => pattern[index % pattern.length],
      );
      const layout = layoutPath(window, path, relations);
      assert.deepEqual([...path.querySelectorAll(".bsd-path-user")], nodes);
      const lines = [...path.querySelectorAll("svg > path")];
      assert.equal(lines.length, count - 1);
      lines.forEach((line, index) => {
        assert.equal(line.hasAttribute("marker-end"), relations[index].forward);
        assert.equal(
          line.hasAttribute("marker-start"),
          relations[index].reverse,
        );
      });
      if (count >= 6) {
        assert.deepEqual(
          nodes
            .slice(0, 6)
            .map((node) => [node.style.gridRow, node.style.gridColumn]),
          [
            ["1", "1"],
            ["1", "2"],
            ["1", "3"],
            ["2", "3"],
            ["2", "2"],
            ["2", "1"],
          ],
        );
        assert.match(lines[2].getAttribute("d"), /Q.*V.*Q/);
        // The second row's directed edges point left, never right.
        const [start, end] = lines[3]
          .getAttribute("d")
          .match(/M ([\d.]+).* H ([\d.]+)$/)
          .slice(1)
          .map(Number);
        assert.ok(start > end);
      }
      // The local Edge dialog provides 782px: seven hops fit in one row.
      width = 782;
      observerCallback();
      nodes.slice(0, 8).forEach((node, index) => {
        assert.equal(node.style.gridRow, "1");
        assert.equal(node.style.gridColumn, String(index + 1));
      });
      if (count > 8) {
        assert.equal(nodes[8].style.gridRow, "2");
        assert.equal(nodes[8].style.gridColumn, "8");
      }
      // Below the width needed for eight full-sized nodes, resume folding.
      width = 767;
      observerCallback();
      if (count >= 8) assert.equal(nodes[7].style.gridRow, "2");
      width = 160;
      observerCallback();
      nodes.forEach((node, index) => {
        assert.equal(node.style.gridColumn, "1");
        assert.equal(node.style.gridRow, String(index + 1));
      });
      // Single-column connectors go around the text, not through it.
      lines.forEach((line) => assert.match(line.getAttribute("d"), /Q.*V.*Q/));
      width = 0;
      layout.update();
      width = 344;
      layout.update();
      assert.deepEqual([...path.querySelectorAll(".bsd-path-user")], nodes);
      layout.destroy();
      assert.equal(disconnected, true);
      window.close();
    }
  }
});
