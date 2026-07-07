/* Canvas topic map - vanilla port of the React TopicMap component /
   bds-lab-website's topic-map.js, adapted to this corpus's field names. */
(() => {
  const PALETTE = ["#6cc5ff", "#a98bff", "#5fd6a4", "#ffb454", "#ff7a9c", "#7ce0e0",
                   "#c3a3ff", "#ffd166", "#8fd694", "#f4978e", "#9aa6bd"];
  const colorOf = (id) => PALETTE[id % PALETTE.length];

  const canvas = document.getElementById("map");
  const ctx = canvas.getContext("2d");
  const tooltip = document.getElementById("tooltip");
  const detail = document.getElementById("detail");
  const app = document.getElementById("app");
  const W = () => app.clientWidth, H = () => app.clientHeight;
  const localXY = (cx, cy) => { const r = canvas.getBoundingClientRect(); return [cx - r.left, cy - r.top]; };
  const local = (e) => localXY(e.clientX, e.clientY);

  let DPR = window.devicePixelRatio || 1;
  let items = [], clusters = [], centroids = [];
  let view = { scale: 1, ox: 0, oy: 0 };
  let fit = { scale: 1, ox: 0, oy: 0 };
  let hovered = null, selected = null;
  const hiddenClusters = new Set();

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function wrapLabel(text, maxChars) {
    const words = text.split(", ").join(" ").split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      if (cur && (cur + " " + w).length > maxChars) { lines.push(cur); cur = w; }
      else cur = cur ? cur + " " + w : w;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function resize() {
    DPR = window.devicePixelRatio || 1;
    canvas.width = W() * DPR;
    canvas.height = H() * DPR;
    canvas.style.width = W() + "px";
    canvas.style.height = H() + "px";
  }

  function computeFit() {
    const xs = items.map((d) => d.x), ys = items.map((d) => d.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 90, rightInset = W() > 720 ? 254 : 0;
    const w = W() - rightInset - pad * 2, h = H() - pad * 2;
    const scale = Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    fit = { scale, ox: (W() - rightInset) / 2 - cx * scale, oy: H() / 2 + cy * scale };
    view = { ...fit };
  }

  const sx = (wx) => wx * view.scale + view.ox;
  const sy = (wy) => -wy * view.scale + view.oy;

  function clusterCentroids() {
    centroids = clusters.map((c) => {
      const mem = items.filter((d) => d.cluster_id === c.id);
      const mx = mem.reduce((s, d) => s + d.x, 0) / (mem.length || 1);
      const my = mem.reduce((s, d) => s + d.y, 0) / (mem.length || 1);
      return { id: c.id, x: mx, y: my };
    });
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function draw() {
    ctx.save();
    ctx.scale(DPR, DPR);
    ctx.clearRect(0, 0, W(), H());

    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const bgPill = isDark ? "rgba(10,10,10,0.88)" : "rgba(250,250,250,0.88)";

    ctx.textAlign = "center";
    ctx.font = "600 12px Inter, sans-serif";
    ctx.lineJoin = "round";
    const lineHeight = 14;

    items.forEach((d) => {
      if (hiddenClusters.has(d.cluster_id)) return;
      const x = sx(d.x), y = sy(d.y);
      const on = d === hovered || d === selected;
      const r = 4.5 * (on ? 1.8 : 1);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.globalAlpha = on ? 1 : 0.82;
      ctx.fillStyle = colorOf(d.cluster_id);
      ctx.fill();
      if (on) { ctx.lineWidth = 2; ctx.strokeStyle = "#fff"; ctx.stroke(); }
      ctx.globalAlpha = 1;
    });

    // Labels draw last (on top of the dots) - otherwise a dense cluster's
    // own dots paint right over the label and its background pill.
    centroids.forEach((c) => {
      if (hiddenClusters.has(c.id)) return;
      const cl = clusters.find((k) => k.id === c.id);
      if (!cl) return;
      const lines = wrapLabel(cl.label, 20);
      const cx = sx(c.x), cy = sy(c.y);
      const maxWidth = Math.max(...lines.map((ln) => ctx.measureText(ln).width));
      const boxW = maxWidth + 12;
      const boxH = lines.length * lineHeight + 8;
      ctx.fillStyle = bgPill;
      roundRectPath(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 5);
      ctx.fill();
      ctx.fillStyle = colorOf(c.id);
      lines.forEach((ln, j) => ctx.fillText(ln, cx, cy + j * lineHeight - (lines.length - 1) * (lineHeight / 2)));
    });
    ctx.restore();
  }

  function nodeAt(px, py) {
    let best = null, bestD = 12;
    for (const d of items) {
      if (hiddenClusters.has(d.cluster_id)) continue;
      const dist = Math.hypot(px - sx(d.x), py - sy(d.y));
      if (dist < bestD) { bestD = dist; best = d; }
    }
    return best;
  }

  let dragging = false, moved = false, last = null;

  canvas.addEventListener("mousedown", (e) => {
    dragging = true; moved = false; last = { x: e.clientX, y: e.clientY };
    canvas.classList.add("grabbing");
  });
  window.addEventListener("mouseup", () => { dragging = false; canvas.classList.remove("grabbing"); });
  window.addEventListener("mousemove", (e) => {
    if (dragging) {
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      view.ox += dx; view.oy += dy; last = { x: e.clientX, y: e.clientY };
      draw();
      return;
    }
    const [px, py] = local(e);
    const hit = nodeAt(px, py);
    if (hit !== hovered) { hovered = hit; draw(); }
    if (hit) showTooltip(hit, px, py); else tooltip.hidden = true;
  });

  canvas.addEventListener("click", (e) => {
    if (moved) return;
    const [px, py] = local(e);
    const hit = nodeAt(px, py);
    if (hit) openDetail(hit);
  });

  function zoomAround(mx, my, factor) {
    const wx = (mx - view.ox) / view.scale, wy = -(my - view.oy) / view.scale;
    view.scale = Math.max(fit.scale * 0.5, Math.min(fit.scale * 12, view.scale * factor));
    view.ox = mx - wx * view.scale;
    view.oy = my + wy * view.scale;
  }

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [mx, my] = local(e);
    zoomAround(mx, my, Math.exp(-e.deltaY * 0.0015));
    draw();
  }, { passive: false });

  function showTooltip(d, px, py) {
    tooltip.innerHTML = `<div class="tt-title">${esc(d.title)}</div>
      <div class="tt-meta">${esc(PL.authorsShort(d))} &middot; ${d.year || ""}</div>`;
    tooltip.hidden = false;
    const r = tooltip.getBoundingClientRect();
    let x = px + 14, y = py + 14;
    if (x + r.width > W() - 10) x = px - r.width - 14;
    if (y + r.height > H() - 10) y = py - r.height - 14;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }

  const byId = (id) => items.find((d) => d.id === id);

  function openDetail(d) {
    selected = d; draw();
    const cl = clusters.find((k) => k.id === d.cluster_id);
    const color = colorOf(d.cluster_id);
    const tag = document.getElementById("detail-tag");
    tag.style.background = color + "22";
    tag.style.color = color;
    tag.textContent = cl ? cl.label : "";
    document.getElementById("detail-title").textContent = d.title;
    document.getElementById("detail-meta").innerHTML =
      `<span>${esc(d.authors.map((a) => a.display_name).join(", "))}</span> &middot; ${esc((PL.journalsById.get(d.journal_id) || {}).name || "")} &middot; ${d.year || ""}`;

    const abs = document.getElementById("detail-abstract");
    if (d.abstract) {
      abs.textContent = d.abstract;
      abs.style.display = "";
    } else {
      abs.textContent = "No abstract available, so its position on the map is based only on its title and general subject tags - treat its placement here as approximate. Tags: " + (d.openalex_topics || []).map((t) => t.display_name).join(", ");
      abs.style.display = "";
    }

    const relBox = document.getElementById("detail-related");
    const rel = (d.related || []).map(byId).filter(Boolean);
    if (rel.length) {
      relBox.innerHTML = '<div class="rel-head">Related work</div>' +
        rel.map((r) => {
          const c = colorOf(r.cluster_id);
          return `<button class="rel-item" data-id="${esc(r.id)}">
            <span class="rel-dot" style="background:${c}"></span>
            <span class="rel-txt">${esc(r.title)}<span class="rel-yr">${r.year || ""}</span></span>
          </button>`;
        }).join("");
      relBox.querySelectorAll(".rel-item").forEach((btn) =>
        btn.addEventListener("click", () => navigateTo(byId(btn.dataset.id))));
    } else {
      relBox.innerHTML = "";
    }

    const links = [];
    if (d.doi) links.push(`<a href="https://doi.org/${encodeURIComponent(d.doi.replace(/^https?:\/\/doi\.org\//, ""))}" target="_blank" rel="noopener">View paper (DOI)</a>`);
    links.push(`<a href="article.html?id=${encodeURIComponent(d.id)}">Full detail page</a>`);
    document.getElementById("detail-links").innerHTML = links.join("");
    detail.hidden = false;
    detail.scrollTop = 0;
    history.replaceState(null, "", "#article=" + d.id);
  }

  function navigateTo(d) {
    if (!d) return;
    if (hiddenClusters.has(d.cluster_id)) showAll();
    const targetScale = Math.max(view.scale, fit.scale * 2.4);
    const rightInset = W() > 720 ? Math.min(420, W() * 0.92) : 0;
    const tx = (W() - rightInset) / 2, ty = H() / 2;
    const start = { ...view }, t0 = performance.now(), dur = 420;
    const startOx = view.ox, startOy = view.oy;
    const endOx = tx - d.x * targetScale, endOy = ty + d.y * targetScale;
    function step(now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      view.scale = start.scale + (targetScale - start.scale) * e;
      view.ox = startOx + (endOx - startOx) * e;
      view.oy = startOy + (endOy - startOy) * e;
      draw();
      if (p < 1) requestAnimationFrame(step);
      else openDetail(d);
    }
    requestAnimationFrame(step);
  }

  document.getElementById("detail-close").addEventListener("click", () => {
    detail.hidden = true; selected = null; draw();
    history.replaceState(null, "", location.pathname);
  });

  function refreshLegendDim() {
    document.querySelectorAll("#legend li").forEach((li) => {
      const id = Number(li.dataset.clusterId);
      li.classList.toggle("dim", hiddenClusters.has(id));
    });
  }

  function showAll() {
    hiddenClusters.clear();
    refreshLegendDim();
  }

  // Clicking a topic solos it (hides every other topic); clicking the same
  // one again restores all topics. Clicking a different topic while soloed
  // switches the solo to the new one.
  function toggleCluster(id) {
    const isSoloed = clusters.every((c) => (c.id === id ? !hiddenClusters.has(c.id) : hiddenClusters.has(c.id)));
    hiddenClusters.clear();
    if (!isSoloed) clusters.forEach((c) => { if (c.id !== id) hiddenClusters.add(c.id); });
    refreshLegendDim();
    draw();
  }

  function buildLegend() {
    const ul = document.getElementById("legend-list");
    ul.innerHTML = "";
    clusters.forEach((c) => {
      const li = document.createElement("li");
      li.dataset.clusterId = String(c.id);
      li.innerHTML = `<span class="swatch" style="background:${colorOf(c.id)}"></span>
        <span class="legend-text">${esc(c.label)}<span class="n"> ${c.count}</span></span>`;
      li.addEventListener("click", () => toggleCluster(c.id));
      ul.appendChild(li);
    });
  }

  document.getElementById("reset-view").addEventListener("click", () => {
    showAll();
    computeFit(); draw();
  });

  window.addEventListener("resize", () => { resize(); computeFit(); draw(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { detail.hidden = true; selected = null; draw(); }
  });

  function boot() {
    items = PL.articles;
    clusters = PL.clusters;
    resize();
    clusterCentroids();
    computeFit();
    buildLegend();
    draw();
    const m = location.hash.match(/article=([\w-]+)/) || [null, new URLSearchParams(location.search).get("article")];
    if (m[1]) { const d = byId(m[1]); if (d) navigateTo(d); }
  }

  document.addEventListener("pl:ready", boot);
})();
