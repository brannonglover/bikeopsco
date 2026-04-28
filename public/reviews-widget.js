/**
 * Bike Ops Reviews Widget
 *
 * Add to your site:
 *   <div data-bikeops-reviews></div>
 *   <script src="https://YOUR-BIKEOPS-DOMAIN.com/reviews-widget.js" data-base-url="https://YOUR-BIKEOPS-DOMAIN.com"></script>
 */
(function () {
  var script = document.currentScript;
  var baseUrl = (script && script.getAttribute("data-base-url")) || "";
  if (!baseUrl && script && script.src) {
    try {
      baseUrl = new URL(script.src).origin;
    } catch (e) {}
  }
  if (!baseUrl) baseUrl = "https://bikeops.co";

  var selector = (script && script.getAttribute("data-bikeops-selector")) || "[data-bikeops-reviews]";
  var theme = ((script && script.getAttribute("data-theme")) || "light").toLowerCase();
  var containers = Array.prototype.slice.call(document.querySelectorAll(selector));

  if (containers.length === 0 && script && script.parentNode) {
    var fallback = document.createElement("div");
    fallback.setAttribute("data-bikeops-reviews", "");
    script.parentNode.insertBefore(fallback, script);
    containers = [fallback];
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function iconGoogle(size) {
    var s = size || 16;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true" class="bo-icon"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"></path><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"></path><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"></path><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"></path></svg>';
  }

  function iconYelp(size) {
    var s = size || 16;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true" class="bo-icon"><g transform="translate(12 12)" fill="#d32323"><g transform="rotate(0)"><rect x="-1.6" y="-10.6" width="3.2" height="7.2" rx="1.6"></rect></g><g transform="rotate(72)"><rect x="-1.6" y="-10.6" width="3.2" height="7.2" rx="1.6"></rect></g><g transform="rotate(144)"><rect x="-1.6" y="-10.6" width="3.2" height="7.2" rx="1.6"></rect></g><g transform="rotate(216)"><rect x="-1.6" y="-10.6" width="3.2" height="7.2" rx="1.6"></rect></g><g transform="rotate(288)"><rect x="-1.6" y="-10.6" width="3.2" height="7.2" rx="1.6"></rect></g></g></svg>';
  }

  function stars(rating) {
    var full = Math.floor(Number(rating) || 0);
    var half = rating - full >= 0.25 && rating - full < 0.75;
    var html = '<span class="bo-stars" aria-hidden="true">';
    for (var i = 1; i <= 5; i++) {
      var filled = i <= full || (half && i === full + 1);
      var opacity = half && i === full + 1 ? "0.5" : "1";
      html += '<svg width="12" height="12" viewBox="0 0 20 20" fill="' + (filled ? "#f59e0b" : "var(--bo-star-empty)") + '" style="opacity:' + opacity + '"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>';
    }
    html += '</span>';
    return html;
  }

  var accents = [
    { base: "#14b8a6", wash: "rgba(20, 184, 166, 0.12)", deep: "#0f766e" },
    { base: "#f97316", wash: "rgba(249, 115, 22, 0.13)", deep: "#c2410c" },
    { base: "#3b82f6", wash: "rgba(59, 130, 246, 0.12)", deep: "#1d4ed8" },
    { base: "#e11d48", wash: "rgba(225, 29, 72, 0.11)", deep: "#be123c" },
    { base: "#84cc16", wash: "rgba(132, 204, 22, 0.14)", deep: "#4d7c0f" },
    { base: "#a855f7", wash: "rgba(168, 85, 247, 0.12)", deep: "#7e22ce" }
  ];
  var moods = ["Smooth ride", "Workshop win", "Fresh gears", "Back rolling", "Tune-up tale", "Happy miles"];
  var perPage = 3;

  function accentFor(name) {
    var hash = 0;
    var value = String(name || "");
    for (var i = 0; i < value.length; i++) hash = value.charCodeAt(i) + ((hash << 5) - hash);
    return accents[Math.abs(hash) % accents.length];
  }

  function initials(name) {
    return String(name || "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map(function (word) { return word.charAt(0).toUpperCase(); })
      .join("") || "?";
  }

  function truncate(text, max) {
    var value = String(text || "");
    if (value.length <= max) return value;
    return value.slice(0, max - 3).trim() + "...";
  }

  function platformIcon(platform, size) {
    return platform === "yelp" ? iconYelp(size) : iconGoogle(size);
  }

  function platformSummary(data) {
    var parts = [];
    if (data.google || data.googleReviewUrl) {
      var googleMeta = data.google
        ? data.google.rating.toFixed(1) + " / " + Number(data.google.reviewCount || 0).toLocaleString() + " review" + (data.google.reviewCount === 1 ? "" : "s")
        : "Review";
      parts.push(summaryItem("Google", iconGoogle(16), googleMeta, data.googleReviewUrl));
    }
    if (data.yelp || data.yelpReviewUrl) {
      var yelpMeta = data.yelp
        ? data.yelp.rating.toFixed(1) + " / " + Number(data.yelp.reviewCount || 0).toLocaleString() + " review" + (data.yelp.reviewCount === 1 ? "" : "s")
        : "Review";
      parts.push(summaryItem("Yelp", iconYelp(16), yelpMeta, data.yelpReviewUrl));
    }
    return parts.join("");
  }

  function summaryItem(name, icon, meta, url) {
    var tag = url ? "a" : "span";
    var href = url ? ' href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer"' : "";
    return '<' + tag + href + ' class="bo-platform-summary-link">' +
      icon +
      '<span class="bo-platform-summary-copy"><span class="bo-platform-summary-name">' + escapeHtml(name) + '</span><span class="bo-platform-summary-meta">' + escapeHtml(meta) + '</span></span>' +
      '</' + tag + '>';
  }

  function card(review, index) {
    var accent = accentFor(review.author);
    var platform = review.platform === "yelp" ? "Yelp" : "Google";
    var text = truncate(review.text, 180);
    return '<article class="bo-tile" style="--bo-accent:' + accent.base + ';--bo-accent-wash:' + accent.wash + ';--bo-accent-deep:' + accent.deep + '">' +
      '<div class="bo-quote-mark" aria-hidden="true">&quot;</div>' +
      '<div class="bo-review-topline"><span class="bo-mood-pill">' + escapeHtml(moods[index % moods.length]) + '</span><span class="bo-platform-badge">' + platformIcon(review.platform, 12) + escapeHtml(platform) + '</span></div>' +
      (text ? '<p class="bo-review-copy">' + escapeHtml(text) + '</p>' : "") +
      '<div class="bo-review-footer"><div class="bo-avatar">' + escapeHtml(initials(review.author)) + '</div><div class="bo-review-person"><p class="bo-review-author">' + escapeHtml(review.author || "Anonymous") + '</p><p class="bo-review-meta">' + escapeHtml(review.relativeTime || (Number(review.rating || 0).toFixed(1) + " star review")) + '</p></div><div class="bo-stars-wrap">' + stars(review.rating) + '</div></div>' +
      '</article>';
  }

  function styles() {
    return '<style>' +
      ':host{display:block;--bo-card-bg:#fff;--bo-card-shadow:rgba(15,23,42,.08);--bo-panel-bg:#f8fafc;--bo-tile-bg:rgba(255,255,255,.88);--bo-tile-border:rgba(15,23,42,.08);--bo-text-heading:#111827;--bo-text-muted:#6b7280;--bo-text-time:#9ca3af;--bo-chevron-bg:#fff;--bo-chevron-border:#e5e7eb;--bo-chevron-icon:#374151;--bo-dot-active:#6366f1;--bo-dot-inactive:#d1d5db;--bo-star-empty:#e5e7eb;--bo-badge-bg:rgba(255,255,255,.8);--bo-quote:rgba(15,23,42,.07);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Arial,sans-serif;color:var(--bo-text-heading)}' +
      ':host(.bo-dark){--bo-card-bg:#1e293b;--bo-card-shadow:rgba(0,0,0,.24);--bo-panel-bg:#0f172a;--bo-tile-bg:rgba(15,23,42,.86);--bo-tile-border:rgba(148,163,184,.18);--bo-text-heading:#f8fafc;--bo-text-muted:#94a3b8;--bo-text-time:#64748b;--bo-chevron-bg:#1e293b;--bo-chevron-border:#334155;--bo-chevron-icon:#94a3b8;--bo-dot-active:#818cf8;--bo-dot-inactive:#475569;--bo-star-empty:#475569;--bo-badge-bg:rgba(15,23,42,.68);--bo-quote:rgba(248,250,252,.08)}' +
      '*{box-sizing:border-box}.bo-wrap{background:transparent;padding:10px}.bo-status{font-size:13px;color:var(--bo-text-muted);text-align:center;padding:18px 0}.bo-platform-summary{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}.bo-platform-summary-link{display:inline-flex;align-items:center;gap:7px;min-height:30px;border-radius:999px;padding:0 9px;color:var(--bo-text-heading);text-decoration:none;background:transparent;border:1px solid transparent;transition:border-color .15s,background .15s}.bo-platform-summary-link:hover{background:var(--bo-badge-bg);border-color:var(--bo-tile-border)}.bo-platform-summary-copy{display:inline-flex;align-items:baseline;gap:5px;white-space:nowrap}.bo-platform-summary-name{font-size:12px;font-weight:800;line-height:1}.bo-platform-summary-meta{color:var(--bo-text-muted);font-size:11px;font-weight:650;line-height:1}' +
      '.bo-carousel-shell{border-radius:16px;padding:2px 0 0;background:transparent;border:0;overflow:hidden}.bo-carousel-header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.bo-carousel-title{font-size:16px;line-height:1.15;font-weight:800;margin:0}.bo-carousel-controls{display:inline-flex;align-items:center;gap:6px;flex-shrink:0}.bo-carousel-button{display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:999px;border:1px solid var(--bo-chevron-border);background:var(--bo-chevron-bg);padding:0;outline:none;transition:transform .15s,border-color .15s;cursor:pointer}.bo-carousel-button:disabled{cursor:default;opacity:.3}.bo-carousel-button:not(:disabled):hover{transform:translateY(-1px);border-color:var(--bo-dot-active)}' +
      '.bo-tiles{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:10px;align-items:stretch}.bo-tile{position:relative;min-width:0;min-height:178px;background:linear-gradient(150deg,var(--bo-accent-wash),transparent 44%),var(--bo-tile-bg);border:1px solid var(--bo-tile-border);border-radius:8px;padding:13px;display:flex;flex-direction:column;justify-content:space-between;gap:12px;overflow:hidden;box-shadow:0 8px 20px var(--bo-card-shadow)}.bo-tile:before{content:"";position:absolute;inset:0 auto 0 0;width:4px;background:var(--bo-accent)}.bo-tile:first-child{min-height:194px}.bo-quote-mark{position:absolute;top:-18px;right:10px;color:var(--bo-quote);font-size:88px;line-height:1;font-family:Georgia,serif;pointer-events:none}.bo-review-topline,.bo-review-footer{position:relative;display:flex;align-items:center;gap:8px;min-width:0}.bo-review-topline{justify-content:space-between}.bo-mood-pill,.bo-platform-badge{display:inline-flex;align-items:center;gap:5px;min-width:0;border-radius:999px;white-space:nowrap;font-size:10.5px;line-height:1;font-weight:800}.bo-mood-pill{color:var(--bo-accent-deep);background:var(--bo-accent-wash);padding:6px 8px}.bo-platform-badge{color:var(--bo-text-muted);background:var(--bo-badge-bg);border:1px solid var(--bo-tile-border);padding:6px 7px}.bo-review-copy{position:relative;color:var(--bo-text-heading);font-size:13px;line-height:1.48;font-weight:650;margin:0;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}.bo-avatar{width:34px;height:34px;border-radius:50%;color:#fff;background:linear-gradient(135deg,var(--bo-accent),var(--bo-accent-deep));box-shadow:0 7px 18px var(--bo-accent-wash);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}.bo-review-person{min-width:0;flex:1}.bo-review-author{font-size:12px;font-weight:800;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0}.bo-review-meta{color:var(--bo-text-time);font-size:10.5px;line-height:1.3;margin:1px 0 0}.bo-stars,.bo-stars-wrap{display:inline-flex;flex-shrink:0;gap:2px}.bo-carousel-dots{display:flex;justify-content:center;gap:5px;margin-top:11px}.bo-dot{width:6px;height:6px;border-radius:999px;background:var(--bo-dot-inactive);border:0;padding:0;cursor:pointer;transition:width .2s,background .2s}.bo-dot-active{width:18px;background:var(--bo-dot-active)}' +
      '.bo-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;border-radius:16px;padding:8px 0 4px;background:transparent;border:0;text-align:center}.bo-empty-title{font-size:18px;line-height:1.15;font-weight:850;margin:0}.bo-empty-copy{color:var(--bo-text-muted);font-size:12px;line-height:1.45;margin:6px auto 0;max-width:330px}.bo-empty-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center}.bo-review-action{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:36px;border-radius:999px;padding:0 12px;background:transparent;border:1px solid var(--bo-tile-border);color:var(--bo-text-heading);font-size:12px;font-weight:800;text-decoration:none;white-space:nowrap;transition:transform .15s,border-color .15s}.bo-review-action:hover{transform:translateY(-1px);border-color:var(--bo-dot-active)}.bo-icon{flex-shrink:0}' +
      '@media(max-width:680px){.bo-tiles{grid-template-columns:1fr}.bo-tile,.bo-tile:first-child{min-height:0}.bo-review-copy{-webkit-line-clamp:4}.bo-stars-wrap{display:none}}@media(max-width:380px){.bo-carousel-header{align-items:flex-start}.bo-carousel-title{font-size:15px}.bo-platform-badge{font-size:0;gap:0}.bo-platform-badge svg{margin:0}}' +
      '</style>';
  }

  function emptyState(data) {
    var actions = "";
    if (data.googleReviewUrl) actions += '<a class="bo-review-action" href="' + escapeHtml(data.googleReviewUrl) + '" target="_blank" rel="noopener noreferrer">' + iconGoogle(15) + 'Google</a>';
    if (data.yelpReviewUrl) actions += '<a class="bo-review-action" href="' + escapeHtml(data.yelpReviewUrl) + '" target="_blank" rel="noopener noreferrer">' + iconYelp(15) + 'Yelp</a>';
    return '<div class="bo-empty"><div><p class="bo-empty-title">Fresh stories coming soon</p><p class="bo-empty-copy">Loved the tune-up? Drop a quick note for the next rider choosing a workshop.</p></div><div class="bo-empty-actions">' + actions + '</div></div>';
  }

  function render(root, data, page) {
    page = page || 0;
    var reviews = Array.isArray(data.displayReviews) ? data.displayReviews : [];
    var totalPages = Math.max(1, Math.ceil(reviews.length / perPage));
    if (page > totalPages - 1) page = totalPages - 1;
    var start = page * perPage;
    var visible = reviews.slice(start, start + perPage);
    var html = styles() + '<div class="bo-wrap">';

    if (reviews.length === 0 && (data.googleReviewUrl || data.yelpReviewUrl)) {
      html += emptyState(data);
    } else {
      html += '<div class="bo-platform-summary">' + platformSummary(data) + '</div>';
      if (reviews.length) {
        html += '<div class="bo-carousel-shell"><div class="bo-carousel-header"><p class="bo-carousel-title">Stories from the stand</p><div class="bo-carousel-controls"><button class="bo-carousel-button" data-bo-prev aria-label="Previous reviews"' + (page <= 0 ? " disabled" : "") + '><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--bo-chevron-icon)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12L6 8l4-4"></path></svg></button><button class="bo-carousel-button" data-bo-next aria-label="Next reviews"' + (page >= totalPages - 1 ? " disabled" : "") + '><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="var(--bo-chevron-icon)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"></path></svg></button></div></div>';
        html += '<div class="bo-tiles">';
        for (var i = 0; i < visible.length; i++) html += card(visible[i], start + i);
        html += '</div>';
        if (totalPages > 1) {
          html += '<div class="bo-carousel-dots">';
          for (var d = 0; d < totalPages; d++) html += '<button class="' + (d === page ? "bo-dot bo-dot-active" : "bo-dot") + '" data-bo-page="' + d + '" aria-label="Go to page ' + (d + 1) + '"></button>';
          html += '</div>';
        }
        html += '</div>';
      } else if (!data.googleReviewUrl && !data.yelpReviewUrl) {
        html += '<p class="bo-status">Configure review links in settings.</p>';
      }
    }

    html += '</div>';
    root.innerHTML = html;

    var host = root.host || root;
    if (theme === "dark" || (theme === "auto" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      host.classList.add("bo-dark");
    } else {
      host.classList.remove("bo-dark");
    }

    var prev = root.querySelector("[data-bo-prev]");
    var next = root.querySelector("[data-bo-next]");
    if (prev) prev.addEventListener("click", function () { if (page > 0) render(root, data, page - 1); });
    if (next) next.addEventListener("click", function () { if (page < totalPages - 1) render(root, data, page + 1); });
    Array.prototype.forEach.call(root.querySelectorAll("[data-bo-page]"), function (button) {
      button.addEventListener("click", function () {
        render(root, data, Number(button.getAttribute("data-bo-page")) || 0);
      });
    });
  }

  function mount(container) {
    if (container.__bikeopsReviewsMounted) return;
    container.__bikeopsReviewsMounted = true;
    var root = container.attachShadow ? container.attachShadow({ mode: "open" }) : container;
    root.innerHTML = styles() + '<div class="bo-wrap"><p class="bo-status">Loading reviews...</p></div>';

    fetch(baseUrl.replace(/\/$/, "") + "/api/widget/reviews", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("Reviews request failed");
        return res.json();
      })
      .then(function (data) { render(root, data, 0); })
      .catch(function () {
        root.innerHTML = styles() + '<div class="bo-wrap"><p class="bo-status">Reviews are unavailable right now.</p></div>';
      });
  }

  containers.forEach(mount);
})();
