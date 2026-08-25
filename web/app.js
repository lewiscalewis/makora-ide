/* Makora Mobile — cliente SPA para la puerta de enlace remota del IDE.
 * - Emparejamiento por código de 6 dígitos (token en localStorage).
 * - Historial de chats LOCAL (localStorage), seleccionable.
 * - Selector de proveedor y modelo (sincroniza RemoteConfig vía /api/sync-config).
 * - Streaming de respuestas vía /api/chat (SSE).
 */

(() => {
  "use strict";

  const TOKEN_KEY = "makora.mobile.token";
  const CHATS_KEY = "makora.mobile.chats";
  const ACTIVE_KEY = "makora.mobile.activeChat";

  const $ = (id) => document.getElementById(id);

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    providers: [],
    models: [],
    currentProviderId: "",
    currentModel: "",
    currentKind: "openai",
    chats: loadChats(),
    activeChatId: localStorage.getItem(ACTIVE_KEY) || null,
    streaming: false,
  };

  /* ---------- persistencia local de chats ---------- */
  function loadChats() {
    try {
      const raw = localStorage.getItem(CHATS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveChats() {
    localStorage.setItem(CHATS_KEY, JSON.stringify(state.chats));
  }

  function activeChat() {
    if (!state.chats.length) return null;
    return state.chats.find((c) => c.id === state.activeChatId) || state.chats[0];
  }

  function newChat() {
    const chat = {
      id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      title: "Nueva conversación",
      messages: [],
    };
    state.chats.unshift(chat);
    state.activeChatId = chat.id;
    localStorage.setItem(ACTIVE_KEY, chat.id);
    saveChats();
    return chat;
  }

  function ensureActiveChat() {
    if (!activeChat()) newChat();
    return activeChat();
  }

  function pushMessage(chat, role, content) {
    chat.messages.push({ role, content, ts: Date.now() });
    if (chat.title === "Nueva conversación" && role === "user") {
      chat.title = content.slice(0, 48) || "Nueva conversación";
    }
    saveChats();
  }

  /* ---------- API con token ---------- */
  async function apiFetch(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (state.token) headers["Authorization"] = "Bearer " + state.token;
    const res = await fetch(path, { ...options, headers });
    if (res.status === 401) {
      showPairing("Sesión expirada. Vuelve a emparejar.");
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = await res.json();
        detail = j.error || j.message || detail;
      } catch {}
      throw new Error(detail);
    }
    return res;
  }

  /* ---------- emparejamiento ---------- */
  function showPairing(message) {
    $("pairScreen").classList.remove("hidden");
    if (message) $("pairStatus").textContent = message;
    $("pairCode").value = "";
    $("pairCode").focus();
  }

  function hidePairing() {
    $("pairScreen").classList.add("hidden");
  }

  async function pair() {
    const code = $("pairCode").value.trim();
    if (!/^\d{6}$/.test(code)) {
      $("pairStatus").textContent = "El código debe tener 6 dígitos.";
      return;
    }
    $("pairStatus").textContent = "Conectando…";
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        let d = "Código incorrecto o expirado.";
        try { d = (await res.json()).error || d; } catch {}
        $("pairStatus").textContent = d;
        return;
      }
      const data = await res.json();
      state.token = data.token;
      localStorage.setItem(TOKEN_KEY, data.token);
      applyRemoteConfig(data.config || {});
      hidePairing();
      await init();
    } catch (e) {
      $("pairStatus").textContent = "Error de red: " + e.message;
    }
  }

  /* ---------- estado / config remota ---------- */
  function applyRemoteConfig(config) {
    state.currentProviderId = config.providerId || state.currentProviderId;
    state.currentModel = config.model || state.currentModel;
    state.currentKind = config.kind || state.currentKind || "openai";
  }

  async function loadState() {
    const res = await apiFetch("/api/state");
    const data = await res.json();
    applyRemoteConfig(data.config || {});
    $("status").textContent =
      (data.config && data.config.providerId ? data.config.providerId + " · " : "") +
      (data.config && data.config.model ? data.config.model : "Conectado");
  }

  async function loadProviders() {
    const res = await apiFetch("/api/providers");
    state.providers = await res.json();
    renderProviderSelect();
  }

  async function loadModels() {
    const res = await apiFetch("/api/list-models");
    state.models = await res.json();
    renderModelSelect();
  }

  async function syncConfig(providerId, model, kind) {
    const config = {
      providerId,
      model,
      baseUrl: (state.providers.find((p) => p.id === providerId) || {}).baseUrl || "",
      kind,
    };
    await apiFetch("/api/sync-config", {
      method: "POST",
      body: JSON.stringify({ config }),
    });
    state.currentProviderId = providerId;
    state.currentModel = model;
    state.currentKind = kind;
  }

  /* ---------- render ---------- */
  function renderChats() {
    const list = $("chatsList");
    list.innerHTML = "";
    state.chats.forEach((chat) => {
      const li = document.createElement("li");
      if (chat.id === state.activeChatId) li.classList.add("active");

      const title = document.createElement("span");
      title.className = "chat-title";
      title.textContent = chat.title;

      const del = document.createElement("button");
      del.className = "chat-del";
      del.textContent = "🗑";
      del.title = "Eliminar chat";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });

      li.append(title, del);
      li.addEventListener("click", () => {
        state.activeChatId = chat.id;
        localStorage.setItem(ACTIVE_KEY, chat.id);
        renderChats();
        renderMessages();
        closeDrawers();
      });
      list.appendChild(li);
    });
  }

  function deleteChat(id) {
    state.chats = state.chats.filter((c) => c.id !== id);
    if (state.activeChatId === id) {
      state.activeChatId = state.chats.length ? state.chats[0].id : null;
      localStorage.setItem(ACTIVE_KEY, state.activeChatId || "");
    }
    saveChats();
    if (!state.chats.length) ensureActiveChat();
    renderChats();
    renderMessages();
  }

  function renderProviderSelect() {
    const sel = $("providerSelect");
    sel.innerHTML = "";
    state.providers.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label + (p.needsKey ? "" : " (local)");
      if (p.id === state.currentProviderId) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderModelSelect() {
    const sel = $("modelSelect");
    sel.innerHTML = "";
    const models = state.models.length ? state.models : [state.currentModel].filter(Boolean);
    models.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      if (m === state.currentModel) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function renderMessages() {
    const box = $("messages");
    box.innerHTML = "";
    const chat = activeChat();
    if (!chat) return;
    chat.messages.forEach((m) => {
      box.appendChild(messageEl(m));
    });
    box.scrollTop = box.scrollHeight;
  }

  function messageEl(m) {
    const div = document.createElement("div");
    div.className = "msg " + (m.role === "user" ? "user" : m.role === "error" ? "error" : "assistant");
    if (m.role === "thinking") div.classList.add("thinking");
    div.textContent = m.content;
    return div;
  }

  function closeDrawers() {
    $("chatsPanel").classList.add("hidden");
    $("configPanel").classList.add("hidden");
  }

  /* ---------- chat (SSE) ---------- */
  function historyFor(chat) {
    // último mensaje como entrada; el resto como contexto
    return chat.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
  }

  async function sendMessage() {
    if (state.streaming) return;
    const input = $("input");
    const text = input.value.trim();
    if (!text) return;

    const chat = ensureActiveChat();
    pushMessage(chat, "user", text);
    input.value = "";
    autoGrow(input);
    renderMessages();
    renderChats();

    const box = $("messages");
    const pending = document.createElement("div");
    pending.className = "msg assistant cursor";
    pending.textContent = "";
    box.appendChild(pending);
    box.scrollTop = box.scrollHeight;

    state.streaming = true;
    $("sendBtn").disabled = true;
    let acc = "";

    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          history: historyFor(chat).filter((h) => h.role === "user" || h.role === "assistant"),
        }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";
        for (const part of parts) {
          const chunk = parseSse(part);
          if (chunk !== null) {
            acc += chunk;
            pending.textContent = acc;
            box.scrollTop = box.scrollHeight;
          }
        }
      }

      pending.classList.remove("cursor");
      if (acc) {
        pushMessage(chat, "assistant", acc);
        pending.textContent = acc;
      } else {
        box.removeChild(pending);
      }
    } catch (e) {
      pending.classList.remove("cursor");
      box.removeChild(pending);
      pushMessage(chat, "error", "Error: " + e.message);
      renderMessages();
    } finally {
      state.streaming = false;
      $("sendBtn").disabled = false;
      renderChats();
    }
  }

  function parseSse(part) {
    let delta = null;
    let done = false;
    for (const line of part.split("\n")) {
      if (line.startsWith("data:")) {
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          const j = JSON.parse(raw);
          if (j.delta != null) delta = (delta || "") + j.delta;
          if (j.done === true) done = true;
        } catch {
          if (raw !== "[DONE]") delta = (delta || "") + raw;
        }
      }
    }
    return delta;
  }

  function autoGrow(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }

  /* ---------- init ---------- */
  async function init() {
    try {
      await loadState();
      await loadProviders();
      await loadModels();
      ensureActiveChat();
      renderChats();
      renderMessages();
      renderProviderSelect();
      renderModelSelect();
    } catch (e) {
      $("status").textContent = "Sin conexión: " + e.message;
    }
  }

  /* ---------- events ---------- */
  $("chatsBtn").addEventListener("click", () => {
    $("chatsPanel").classList.toggle("hidden");
    $("configPanel").classList.add("hidden");
    renderChats();
  });

  $("configBtn").addEventListener("click", async () => {
    $("configPanel").classList.toggle("hidden");
    $("chatsPanel").classList.add("hidden");
    $("configStatus").textContent = "";
    try {
      await loadProviders();
      await loadModels();
    } catch (e) {
      $("configStatus").textContent = "No se pudo cargar: " + e.message;
    }
  });

  $("closeConfigBtn").addEventListener("click", closeDrawers);
  $("newChatBtn").addEventListener("click", () => {
    newChat();
    renderChats();
    renderMessages();
    closeDrawers();
  });

  $("providerSelect").addEventListener("change", async () => {
    const providerId = $("providerSelect").value;
    // recargar modelos del proveedor seleccionado aplicándolo temporalmente
    $("configStatus").textContent = "Cargando modelos…";
    const provider = state.providers.find((p) => p.id === providerId);
    try {
      await syncConfig(providerId, state.currentModel || "", provider ? provider.kind : "openai");
      await loadModels();
      renderModelSelect();
      $("configStatus").textContent = "";
    } catch (e) {
      $("configStatus").textContent = "Error: " + e.message;
    }
  });

  $("applyConfigBtn").addEventListener("click", async () => {
    const providerId = $("providerSelect").value;
    const model = $("modelSelect").value;
    const provider = state.providers.find((p) => p.id === providerId);
    $("configStatus").textContent = "Aplicando…";
    try {
      await syncConfig(providerId, model, provider ? provider.kind : "openai");
      $("configStatus").textContent = "Configuración aplicada.";
      $("status").textContent = providerId + " · " + model;
    } catch (e) {
      $("configStatus").textContent = "Error: " + e.message;
    }
  });

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage();
  });

  $("input").addEventListener("input", (e) => autoGrow(e.target));

  $("pairBtn").addEventListener("click", pair);
  $("pairCode").addEventListener("keydown", (e) => {
    if (e.key === "Enter") pair();
  });

  /* ---------- arranque ---------- */
  if (state.token) {
    init();
  } else {
    showPairing("Empareja este dispositivo con tu Makora IDE.");
  }
})();
