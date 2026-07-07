(() => {
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  document.addEventListener("pl:ready", () => {
    const id = new URLSearchParams(location.search).get("id");
    const article = PL.articlesById.get(id);
    const el = document.getElementById("content");
    if (!article) {
      el.innerHTML = `<p>Article not found. <a href="articles.html">Back to articles</a></p>`;
      return;
    }
    const journal = PL.journalsById.get(article.journal_id);
    const cluster = PL.clustersById.get(article.cluster_id);
    const related = (article.related || []).map((rid) => PL.articlesById.get(rid)).filter(Boolean);

    el.innerHTML = `
      <a href="articles.html" style="font-size:13px;color:var(--faint)">&larr; Back to articles</a>
      <div class="pill" style="margin-top:12px;width:fit-content">${esc(cluster ? cluster.label : "")}</div>
      <h1 style="margin-top:10px">${esc(article.title)}</h1>
      <div class="meta" style="margin-top:4px">${esc(article.authors.map((a) => a.display_name).join(", "))}</div>
      <div class="meta">${esc(journal ? journal.name : "")} &middot; ${article.year || ""}</div>
      ${
        article.abstract
          ? `<p style="margin-top:20px;line-height:1.7">${esc(article.abstract)}</p>`
          : `<p style="margin-top:20px;font-style:italic;color:var(--faint)">No abstract available, so its position on the map is based only on its title and general subject tags - treat its placement there as approximate. Tags: ${esc(
              (article.openalex_topics || []).map((t) => t.display_name).join(", "),
            )}</p>`
      }
      <div style="margin-top:20px;display:flex;gap:16px">
        ${
          article.doi
            ? `<a href="https://doi.org/${encodeURIComponent(article.doi.replace(/^https?:\/\/doi\.org\//, ""))}" target="_blank" rel="noopener">View paper (DOI)</a>`
            : ""
        }
        <a href="map.html?article=${encodeURIComponent(article.id)}">View on topic map</a>
      </div>
      ${
        related.length
          ? `<div style="margin-top:32px">
              <div style="font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);margin-bottom:8px">Related work</div>
              <ul style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;font-size:14px">
                ${related
                  .map((r) => `<li><a href="article.html?id=${encodeURIComponent(r.id)}">${esc(r.title)}</a> <span style="color:var(--faint)">(${r.year || ""})</span></li>`)
                  .join("")}
              </ul>
            </div>`
          : ""
      }
    `;
  });
})();
