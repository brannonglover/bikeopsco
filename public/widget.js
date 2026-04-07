/**
 * Bike Ops Booking Widget
 * Add to your site:
 *   <script src="https://YOUR-BIKEOPS-DOMAIN.com/widget.js" data-base-url="https://YOUR-BIKEOPS-DOMAIN.com"></script>
 * Then add data-bikeops-book to any button/link:
 *   <a href="#" data-bikeops-book>Book Now</a>
 *
 * Or use a custom selector via data-bikeops-selector=".my-book-button"
 */
(function () {
  var script = document.currentScript;
  var baseUrl = (script && script.getAttribute("data-base-url")) || "";
  if (!baseUrl && script && script.src) {
    try {
      var url = new URL(script.src);
      baseUrl = url.origin;
    } catch (e) {}
  }
  if (!baseUrl) baseUrl = "https://bikeops.co";

  var bookUrl = baseUrl + "/book?embed=1";

  function prefersDark() {
    if (document.documentElement.classList.contains("dark")) return true;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function openModal() {
    if (document.getElementById("bikeops-widget-overlay")) return;

    var dark = prefersDark();

    var overlay = document.createElement("div");
    overlay.id = "bikeops-widget-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Book a repair");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;" +
      "padding:16px;box-sizing:border-box;";

    var container = document.createElement("div");
    container.style.cssText =
      "position:relative;width:100%;max-width:720px;max-height:90vh;" +
      "background:" + (dark ? "#1e293b" : "#fff") + ";border-radius:12px;" +
      "box-shadow:0 25px 50px -12px rgba(0,0,0," + (dark ? "0.5" : "0.25") + ");overflow:hidden;display:flex;flex-direction:column;";

    var closeBtnBg      = dark ? "#334155" : "#f1f5f9";
    var closeBtnColor   = dark ? "#94a3b8" : "#64748b";
    var closeBtnBgHover = dark ? "#475569" : "#e2e8f0";
    var closeBtnColorHover = dark ? "#e2e8f0" : "#334155";

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML =
      '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    closeBtn.style.cssText =
      "position:absolute;top:12px;right:12px;z-index:10;width:40px;height:40px;border:none;background:" + closeBtnBg + ";" +
      "border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;" +
      "color:" + closeBtnColor + ";transition:color .15s, background .15s;";
    closeBtn.onmouseover = function () {
      closeBtn.style.background = closeBtnBgHover;
      closeBtn.style.color = closeBtnColorHover;
    };
    closeBtn.onmouseout = function () {
      closeBtn.style.background = closeBtnBg;
      closeBtn.style.color = closeBtnColor;
    };
    closeBtn.onclick = closeModal;

    var iframe = document.createElement("iframe");
    iframe.src = bookUrl;
    iframe.style.cssText =
      "width:100%;flex:1;min-height:600px;border:none;border-radius:0 0 12px 12px;";
    iframe.title = "Book a repair";

    container.appendChild(closeBtn);
    container.appendChild(iframe);
    overlay.appendChild(container);

    overlay.onclick = function (e) {
      if (e.target === overlay) closeModal();
    };

    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    var overlay = document.getElementById("bikeops-widget-overlay");
    if (overlay) {
      overlay.remove();
      document.body.style.overflow = "";
    }
  }

  function init() {
    var selector = (script && script.getAttribute("data-bikeops-selector")) || "[data-bikeops-book]";
    var elements = document.querySelectorAll(selector);

    elements.forEach(function (el) {
      if (el._bikeopsBound) return;
      el._bikeopsBound = true;
      el.addEventListener("click", function (e) {
        if (el.tagName === "A" && (!el.getAttribute("href") || el.getAttribute("href") === "#")) {
          e.preventDefault();
        }
        openModal();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && document.getElementById("bikeops-widget-overlay")) {
      closeModal();
    }
  });
})();
