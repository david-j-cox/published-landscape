(() => {
  const PAGE_SIZE = 25;
  let shown = PAGE_SIZE;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function render() {
    const q = document.getElementById("q").value;
    const journalId = document.getElementById("journal").value;
    const clusterId = document.getElementById("cluster").value;
    const year = document.getElementById("year").value;

    const results = PL.getArticles({ query: q, journalId, clusterId, year });
    document.getElementById("subhead").textContent =
      `${PL.articles.length.toLocaleString()} articles across ${PL.journals.length} journals, last 10 years.`;
    document.getElementById("count").textContent = `${results.length.toLocaleString()} matching`;

    const slice = results.slice(0, shown);
    document.getElementById("list").innerHTML = slice
      .map((a) => {
        const journal = PL.journalsById.get(a.journal_id);
        return `<li>
          <a class="title" href="article.html?id=${encodeURIComponent(a.id)}">${esc(a.title)}</a>
          <div class="meta">${esc(PL.authorsShort(a))} &middot; ${esc(journal ? journal.name : "")} &middot; ${a.year || ""}</div>
        </li>`;
      })
      .join("") || `<li class="meta">No articles match those filters.</li>`;

    document.getElementById("more").style.display = results.length > shown ? "" : "none";
  }

  function populateSelect(id, options) {
    const el = document.getElementById(id);
    for (const [value, label] of options) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      el.appendChild(opt);
    }
  }

  document.addEventListener("pl:ready", () => {
    populateSelect("journal", PL.journals.map((j) => [j.id, j.name]));
    populateSelect("cluster", PL.clusters.map((c) => [c.id, `${c.label} (${c.count})`]));
    populateSelect("year", PL.years.map((y) => [y, y]));

    // Deep-linked filters, e.g. articles.html?cluster=3
    const params = new URLSearchParams(location.search);
    if (params.get("cluster")) document.getElementById("cluster").value = params.get("cluster");
    if (params.get("journal")) document.getElementById("journal").value = params.get("journal");
    if (params.get("q")) document.getElementById("q").value = params.get("q");

    ["q", "journal", "cluster", "year"].forEach((id) =>
      document.getElementById(id).addEventListener("input", () => {
        shown = PAGE_SIZE;
        render();
      }),
    );
    document.getElementById("load-more").addEventListener("click", (e) => {
      e.preventDefault();
      shown += PAGE_SIZE;
      render();
    });

    render();
  });
})();
