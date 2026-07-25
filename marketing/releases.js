(function () {
  var root = document.getElementById("releases-root");
  if (!root) return;

  var apiBase = (root.getAttribute("data-api-base") || "https://app.bikeops.co").replace(/\/$/, "");

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatPublishedAt(iso) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat("en-US", {
        dateStyle: "long",
        timeZone: "America/New_York",
      }).format(new Date(iso));
    } catch (e) {
      return "";
    }
  }

  function renderEmpty() {
    root.innerHTML =
      '<section aria-labelledby="empty-heading">' +
      '<h2 id="empty-heading">No published releases yet</h2>' +
      "<p>When Bike Ops ships an update and the team publishes notes, they will appear here—latest first.</p>" +
      "</section>";
  }

  function renderError() {
    root.innerHTML =
      '<section aria-labelledby="error-heading">' +
      '<h2 id="error-heading">Could not load releases</h2>' +
      "<p>Please try again in a moment.</p>" +
      "</section>";
  }

  function renderReleases(releases) {
    if (!releases || !releases.length) {
      renderEmpty();
      return;
    }

    root.innerHTML = releases
      .map(function (release, index) {
        var anchor = release.anchorId || "v-" + release.version;
        var title = release.title
          ? escapeHtml(release.title)
          : "Version " + escapeHtml(release.version);
        var dateLabel = formatPublishedAt(release.publishedAt);
        var bullets = (release.bullets || [])
          .map(function (bullet) {
            return "<li>" + escapeHtml(bullet) + "</li>";
          })
          .join("");

        return (
          '<section id="' +
          escapeHtml(anchor) +
          '" aria-labelledby="' +
          escapeHtml(anchor) +
          '-heading">' +
          (index === 0 ? '<p class="eyebrow">Latest</p>' : "") +
          '<h2 id="' +
          escapeHtml(anchor) +
          '-heading">' +
          title +
          "</h2>" +
          '<p><strong>Version ' +
          escapeHtml(release.version) +
          "</strong>" +
          (dateLabel ? " · " + escapeHtml(dateLabel) : "") +
          "</p>" +
          (bullets ? "<ul>" + bullets + "</ul>" : "<p>No details listed for this release.</p>") +
          "</section>"
        );
      })
      .join("");

    if (window.location.hash) {
      var target = document.getElementById(window.location.hash.slice(1));
      if (target) {
        target.scrollIntoView({ block: "start" });
      }
    }
  }

  fetch(apiBase + "/api/releases", { credentials: "omit" })
    .then(function (response) {
      if (!response.ok) throw new Error("bad status");
      return response.json();
    })
    .then(function (data) {
      renderReleases(data && data.releases ? data.releases : []);
    })
    .catch(function () {
      renderError();
    });
})();
