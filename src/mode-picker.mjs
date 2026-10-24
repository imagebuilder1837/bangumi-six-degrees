// A select-only combobox: focus stays on the trigger; candidates never commit
// until explicitly activated. The popup lives outside the clipped dialog body.
export function mountModePicker(window, overlay, trigger, names, onChange) {
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
      else if (key === "ArrowDown") candidate = (candidate + 1) % values.length;
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
