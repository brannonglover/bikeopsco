(function () {
  "use strict";

  var STORAGE_KEY = "bikeops_site_chat_session";
  var POLL_MS = 3000;

  var script = document.currentScript;
  var apiBase =
    (script && script.getAttribute("data-api-base")) || "https://app.bikeops.co";
  apiBase = apiBase.replace(/\/$/, "");

  var root = document.createElement("div");
  root.className = "site-chat-root is-intake";

  root.innerHTML =
    '<div class="site-chat-panel" role="dialog" aria-modal="true" aria-labelledby="site-chat-title">' +
    '<header class="site-chat-header">' +
    '<div class="site-chat-header-text">' +
    '<h2 id="site-chat-title">Chat with Bike Ops</h2>' +
    "<p>Questions about shop software? We're here to help.</p>" +
    "</div>" +
    '<button type="button" class="site-chat-close" aria-label="Close chat">&times;</button>' +
    "</header>" +
    '<form class="site-chat-form" id="site-chat-form">' +
    '<input class="site-chat-honeypot" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />' +
    '<p class="site-chat-error" id="site-chat-error" hidden></p>' +
    '<div class="site-chat-body">' +
    '<div class="site-chat-welcome" id="site-chat-welcome">' +
    "<strong>Start a conversation</strong>" +
    "<p>Tell us what you're looking for. We usually reply within a few hours on business days.</p>" +
    "</div>" +
    '<div class="site-chat-intake" id="site-chat-intake">' +
    '<div class="site-chat-field">' +
    '<span class="site-chat-field-label" id="site-chat-name-label">Your name</span>' +
    '<input id="site-chat-name" name="name" type="text" autocomplete="name" required maxlength="80" placeholder="Jane Smith" aria-labelledby="site-chat-name-label" />' +
    "</div>" +
    '<div class="site-chat-field">' +
    '<span class="site-chat-field-label" id="site-chat-phone-label">Mobile number</span>' +
    '<input id="site-chat-phone" name="phone" type="tel" autocomplete="tel" required maxlength="30" placeholder="(555) 123-4567" aria-labelledby="site-chat-phone-label" />' +
    "</div>" +
    '<div class="site-chat-consent-box">' +
    '<label class="site-chat-consent-label" for="site-chat-consent">' +
    '<input id="site-chat-consent" name="smsConsent" type="checkbox" required />' +
    "<span>Text me about this chat. Msg &amp; data rates may apply. Reply STOP to opt out.</span>" +
    "</label>" +
    "</div>" +
    '<div class="site-chat-field" id="site-chat-message-field">' +
    '<span class="site-chat-field-label" id="site-chat-message-label">Your message</span>' +
    '<textarea id="site-chat-input" name="message" required maxlength="2000" rows="3" placeholder="What would you like to know?" aria-labelledby="site-chat-message-label"></textarea>' +
    "</div>" +
    '<button type="submit" class="site-chat-send" id="site-chat-send">Start chat</button>' +
    "</div>" +
    '<div class="site-chat-messages" id="site-chat-messages" aria-live="polite"></div>' +
    "</div>" +
    '<footer class="site-chat-composer" id="site-chat-composer" hidden>' +
    '<div class="site-chat-input-wrap" id="site-chat-composer-wrap"></div>' +
    '<p class="site-chat-hint" id="site-chat-hint">You may also get replies by text if you leave this page.</p>' +
    "</footer>" +
    "</form>" +
    "</div>" +
    '<button type="button" class="site-chat-launcher" aria-expanded="false">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
    "</svg>" +
    "<span>Chat</span>" +
    "</button>";

  document.body.appendChild(root);

  var launcher = root.querySelector(".site-chat-launcher");
  var panel = root.querySelector(".site-chat-panel");
  var closeBtn = root.querySelector(".site-chat-close");
  var messagesEl = root.querySelector("#site-chat-messages");
  var form = root.querySelector("#site-chat-form");
  var intakeEl = root.querySelector("#site-chat-intake");
  var welcomeEl = root.querySelector("#site-chat-welcome");
  var messageField = root.querySelector("#site-chat-message-field");
  var composerEl = root.querySelector("#site-chat-composer");
  var composerWrap = root.querySelector("#site-chat-composer-wrap");
  var errorEl = root.querySelector("#site-chat-error");
  var hintEl = root.querySelector("#site-chat-hint");
  var sendBtn = root.querySelector("#site-chat-send");
  var inputEl = root.querySelector("#site-chat-input");
  var nameEl = root.querySelector("#site-chat-name");
  var phoneEl = root.querySelector("#site-chat-phone");
  var consentEl = root.querySelector("#site-chat-consent");
  var honeypot = form.querySelector('input[name="website"]');

  var state = {
    sessionToken: null,
    messages: [],
    started: false,
    polling: null,
    sending: false,
  };

  function mountIntakeComposer() {
    messageField.appendChild(inputEl);
    intakeEl.appendChild(sendBtn);
  }

  function mountChatComposer() {
    composerWrap.appendChild(inputEl);
    composerWrap.appendChild(sendBtn);
  }

  function setMode(mode) {
    var isChat = mode === "chat";
    root.classList.toggle("is-intake", !isChat);
    root.classList.toggle("is-chat", isChat);
    sendBtn.textContent = isChat ? "Send" : "Start chat";
    inputEl.placeholder = isChat
      ? "Type a message…"
      : "What would you like to know?";
    inputEl.rows = isChat ? 1 : 3;
    if (isChat) {
      mountChatComposer();
      intakeEl.setAttribute("hidden", "");
      welcomeEl.setAttribute("hidden", "");
      composerEl.hidden = false;
    } else {
      mountIntakeComposer();
      intakeEl.removeAttribute("hidden");
      welcomeEl.removeAttribute("hidden");
      composerEl.hidden = true;
    }
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.sessionToken === "string") {
        state.sessionToken = parsed.sessionToken;
        state.started = true;
      }
    } catch (_e) {
      /* ignore */
    }
  }

  function saveSession() {
    if (!state.sessionToken) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ sessionToken: state.sessionToken })
      );
    } catch (_e) {
      /* ignore */
    }
  }

  function setError(message) {
    if (!message) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  function setOpen(open) {
    root.classList.toggle("is-open", open);
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      if (state.started) inputEl.focus();
      else nameEl.focus();
      if (state.started) startPolling();
    } else {
      stopPolling();
    }
  }

  function renderMessages() {
    messagesEl.innerHTML = "";
    if (!state.messages.length) {
      var empty = document.createElement("p");
      empty.className = "site-chat-empty-thread";
      empty.textContent = "No messages yet. Say hello!";
      messagesEl.appendChild(empty);
      return;
    }
    state.messages.forEach(function (msg) {
      var bubble = document.createElement("div");
      bubble.className =
        "site-chat-bubble " + (msg.sender === "staff" ? "staff" : "visitor");
      bubble.textContent = msg.body;
      messagesEl.appendChild(bubble);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function mergeMessages(incoming) {
    if (!incoming || !incoming.length) return;
    var byId = {};
    state.messages.forEach(function (m) {
      byId[m.id] = m;
    });
    incoming.forEach(function (m) {
      byId[m.id] = m;
    });
    state.messages = Object.keys(byId)
      .map(function (id) {
        return byId[id];
      })
      .sort(function (a, b) {
        return a.createdAt.localeCompare(b.createdAt);
      });
    renderMessages();
  }

  function apiFetch(path, options) {
    return fetch(apiBase + path, options);
  }

  function latestSince() {
    if (!state.messages.length) return "";
    return state.messages[state.messages.length - 1].createdAt;
  }

  function pollMessages() {
    if (!state.sessionToken) return;
    var url =
      "/api/site-chat/messages?sessionToken=" +
      encodeURIComponent(state.sessionToken) +
      "&since=" +
      encodeURIComponent(latestSince());

    apiFetch(url, { method: "GET", credentials: "omit" })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!result.ok) return;
        mergeMessages(result.data.messages || []);
      })
      .catch(function () {
        /* silent */
      });
  }

  function startPolling() {
    stopPolling();
    state.polling = window.setInterval(pollMessages, POLL_MS);
  }

  function stopPolling() {
    if (state.polling) {
      window.clearInterval(state.polling);
      state.polling = null;
    }
  }

  function enterChatMode() {
    state.started = true;
    setMode("chat");
    saveSession();
    startPolling();
    renderMessages();
    inputEl.focus();
  }

  function handleStart(body) {
    return apiFetch("/api/site-chat/start", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    });
  }

  function handleSend(body) {
    return apiFetch("/api/site-chat/messages", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    });
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (state.sending) return;

    setError("");
    var text = inputEl.value.trim();
    if (!text) return;

    state.sending = true;
    sendBtn.disabled = true;

    var done = function () {
      state.sending = false;
      sendBtn.disabled = false;
    };

    if (!state.started) {
      if (!consentEl.checked) {
        setError("Please check the box to allow text updates about this chat.");
        done();
        return;
      }

      handleStart({
        name: nameEl.value.trim(),
        phone: phoneEl.value.trim(),
        message: text,
        smsConsent: true,
        website: honeypot.value,
        sessionToken: state.sessionToken || undefined,
      })
        .then(function (result) {
          if (!result.ok) {
            setError(result.data.error || "Could not start chat. Try again.");
            return;
          }
          state.sessionToken = result.data.sessionToken;
          mergeMessages(result.data.messages || []);
          inputEl.value = "";
          enterChatMode();
        })
        .catch(function () {
          setError("Network error. Please try again.");
        })
        .finally(done);
      return;
    }

    handleSend({
      sessionToken: state.sessionToken,
      body: text,
      website: honeypot.value,
    })
      .then(function (result) {
        if (!result.ok) {
          setError(result.data.error || "Could not send message.");
          return;
        }
        mergeMessages([result.data.message]);
        inputEl.value = "";
      })
      .catch(function () {
        setError("Network error. Please try again.");
      })
      .finally(done);
  });

  launcher.addEventListener("click", function () {
    setOpen(true);
  });

  closeBtn.addEventListener("click", function () {
    setOpen(false);
  });

  loadSession();

  if (state.started) {
    setMode("chat");
    apiFetch(
      "/api/site-chat/messages?sessionToken=" +
        encodeURIComponent(state.sessionToken),
      { method: "GET", credentials: "omit" }
    )
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (result.ok) {
          state.messages = result.data.messages || [];
          renderMessages();
        }
      })
      .catch(function () {
        /* ignore */
      });
  } else {
    setMode("intake");
  }
})();
