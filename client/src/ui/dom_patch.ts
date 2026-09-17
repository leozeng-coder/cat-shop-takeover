// Preserve the actual controls while high-frequency snapshots update their values.
// Replacing the whole panel can detach a button between pointer-down and pointer-up.
export function updateHtml(container: HTMLElement, html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  patchChildren(container, template.content);
}

function patchChildren(current: Node, incoming: Node): void {
  const desired = Array.from(incoming.childNodes);
  while (current.childNodes.length > desired.length) current.lastChild!.remove();
  for (let index = 0; index < desired.length; index++) {
    const next = desired[index];
    const existing = current.childNodes[index];
    if (!existing) {
      current.appendChild(next.cloneNode(true));
      continue;
    }
    if (existing.nodeType !== next.nodeType || existing.nodeName !== next.nodeName) {
      current.replaceChild(next.cloneNode(true), existing);
      continue;
    }
    if (existing.nodeType === Node.TEXT_NODE) {
      if (existing.textContent !== next.textContent) existing.textContent = next.textContent;
      continue;
    }
    if (existing instanceof Element && next instanceof Element) {
      for (const attribute of Array.from(existing.attributes)) {
        if (!next.hasAttribute(attribute.name)) existing.removeAttribute(attribute.name);
      }
      for (const attribute of Array.from(next.attributes)) {
        if (existing.getAttribute(attribute.name) !== attribute.value) {
          existing.setAttribute(attribute.name, attribute.value);
        }
      }
    }
    patchChildren(existing, next);
  }
}
