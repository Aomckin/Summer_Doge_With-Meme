function enhance(select: HTMLSelectElement): void {
  if (select.dataset.searchableTemplate === "true") return;
  select.dataset.searchableTemplate = "true";
  const wrapper = document.createElement("div");
  wrapper.className = "searchable-template-select";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "搜索模板名称…";
  search.setAttribute("aria-label", "搜索模板名称");
  select.parentNode?.insertBefore(wrapper, select);
  wrapper.append(search, select);
  search.addEventListener("input", () => {
    const query = search.value.trim().toLocaleLowerCase();
    for (const option of select.options) {
      option.hidden = Boolean(option.value) && option.value !== select.value
        && Boolean(query) && !option.text.toLocaleLowerCase().includes(query);
    }
  });
}

export function installSearchableTemplateSelectors(root: ParentNode = document): () => void {
  const selector = 'select[name="template_id"], select[name="vault_template"], select[data-template-selector]';
  const scan = (node: ParentNode): void => {
    for (const select of node.querySelectorAll<HTMLSelectElement>(selector)) enhance(select);
  };
  scan(root);
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node instanceof HTMLSelectElement && node.matches(selector)) enhance(node);
      scan(node);
    }
  });
  observer.observe(root === document ? document.body : root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
