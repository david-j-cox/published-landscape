(() => {
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function renderResults(results) {
    document.getElementById("count").textContent = results.length
      ? `${results.length} author${results.length === 1 ? "" : "s"} found`
      : "";
    document.getElementById("list").innerHTML = results
      .map((author) => {
        const pills = author.clusters
          .slice(0, 4)
          .map((c) => `<a class="pill" href="articles.html?cluster=${c.id}">${esc(c.label)} &middot; ${c.count}</a>`)
          .join("");
        const articles = author.articles
          .slice(0, 3)
          .map((a) => `<li><a href="article.html?id=${encodeURIComponent(a.id)}">${esc(a.title)}</a> (${a.year || ""})</li>`)
          .join("");
        return `<div class="reviewer">
          <div class="row">
            <span class="name">${esc(author.display_name)}</span>
            <span class="n">${author.articleCount} article${author.articleCount === 1 ? "" : "s"}</span>
          </div>
          <div class="pills">${pills}</div>
          <ul>${articles}</ul>
          ${author.orcid ? `<a href="${esc(author.orcid)}" target="_blank" rel="noopener" style="font-size:12px">ORCID</a>` : ""}
        </div>`;
      })
      .join("");
  }

  function run() {
    const topic = document.getElementById("topic").value;
    const q = document.getElementById("q").value;
    if (q) renderResults(PL.searchAuthors(q));
    else if (topic !== "") renderResults(PL.getReviewersByCluster(topic));
    else renderResults([]);
  }

  document.addEventListener("pl:ready", () => {
    const topicEl = document.getElementById("topic");
    for (const c of PL.clusters) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.label} (${c.count})`;
      topicEl.appendChild(opt);
    }
    const params = new URLSearchParams(location.search);
    if (params.get("topic")) topicEl.value = params.get("topic");

    document.getElementById("topic").addEventListener("input", () => {
      document.getElementById("q").value = "";
      run();
    });
    document.getElementById("q").addEventListener("input", run);
    run();
  });
})();
