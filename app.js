/* ============================================================
   app.js — точка входа. Управляет вкладками и отрисовкой.
   Асинхронная работа с сервером через REST API (Store).
   Личный список кэшируется в Care, чтобы задачи и бейдж
   считались синхронно.
   ============================================================ */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function ruDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const daysWord = (n) => plural(n, "день", "дня", "дней");

// Короткая всплывающая подсказка внизу экрана
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("is-show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("is-show"), 4500);
}

/* ---------- Периодическая проверка задач для уведомлений ---------- */
let reminderLoopId = null;
let lastReminderSig = "";

async function reminderTick() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  await refreshMyPlants(); // свежие данные из БД
  const tasks = Care.buildTasks();
  if (tasks.length === 0) {
    lastReminderSig = "";
    return;
  }
  // Не повторяем уведомление, пока набор задач не изменился
  const sig = tasks.map((t) => t.type + t.entryId).sort().join("|");
  if (sig === lastReminderSig) return;
  lastReminderSig = sig;
  Care.pushDueTasks();
}

function startReminderLoop() {
  reminderTick();
  if (reminderLoopId) return;
  reminderLoopId = setInterval(reminderTick, 15 * 60 * 1000); // каждые 15 минут
}

let currentView = "catalog";

/* ============================================================
   ВКЛАДКИ И ОБНОВЛЕНИЕ
   ============================================================ */
function switchView(view) {
  currentView = view;
  $$(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("is-active", v.id === "view-" + view));
  render();
}

// Подтягиваем личный список с сервера и кладём в кэш Care
async function refreshMyPlants() {
  const list = await Store.getMyPlants();
  Care.setMyPlants(list);
  return list;
}

async function render() {
  await refreshMyPlants(); // держим кэш свежим для задач и бейджа
  if (currentView === "catalog") await renderCatalog();
  if (currentView === "mine") renderMine();
  if (currentView === "favorites") await renderFavorites();
  if (currentView === "exchange") await renderExchange();
  if (currentView === "tasks") renderTasks();
  updateBadge();
}

function updateBadge() {
  const n = Care.taskCount();
  const badge = $("#task-badge");
  badge.textContent = n;
  badge.classList.toggle("is-hidden", n === 0);
}

/* ============================================================
   ЗНАЧКИ (inline SVG)
   ============================================================ */
const ICON = {
  water: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3s6 6.5 6 11a6 6 0 1 1-12 0c0-4.5 6-11 6-11z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M19.5 4.5l-2 2M6.5 17.5l-2 2"/></svg>',
  pot: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14l-1.5 11h-11L5 9zM4 6h16v3H4z"/></svg>',
  skull: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z"/><circle cx="9" cy="12" r="1.4" fill="#fff"/><circle cx="15" cy="12" r="1.4" fill="#fff"/></svg>',
  leaf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4C10 4 4 10 4 20c10 0 16-6 16-16zM7 17C11 11 15 9 18 8"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6L21 9.3l-4.5 4.3 1.1 6.2L12 17l-5.6 2.8 1.1-6.2L3 9.3l6.4-.7L12 3z"/></svg>'
};

/* ============================================================
   СПРАВОЧНИК
   ============================================================ */
async function renderCatalog() {
  const q = ($("#search").value || "").trim().toLowerCase();
  const plants = window.PLANTS || [];
  const filtered = plants.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      (p.latin || "").toLowerCase().includes(q)
  );

  const grid = $("#catalog-grid");
  if (filtered.length === 0) {
    grid.innerHTML = emptyState("Ничего не нашлось", "Попробуйте другое название растения.");
    return;
  }

  const favIds = await Store.getFavorites();

  grid.innerHTML = filtered
    .map((p) => {
      const fav = favIds.includes(p.id);
      return `
      <article class="card plant-card" data-id="${p.id}" tabindex="0" role="button" aria-label="Открыть карточку: ${esc(p.name)}">
        <button class="fav-btn ${fav ? "is-on" : ""}" data-fav="${p.id}" title="В избранное" aria-label="В избранное">${ICON.star}</button>
        <div class="plant-emoji">${p.emoji || "🌱"}</div>
        <h3 class="plant-name">${esc(p.name)}</h3>
        <p class="plant-latin">${esc(p.latin || "")}</p>
        <div class="plant-meta">
          <span class="chip chip--${diffClass(p.difficulty)}">${esc(p.difficulty)}</span>
          <span class="chip chip--water">${ICON.water} ${p.waterIntervalDays} ${daysWord(p.waterIntervalDays)}</span>
        </div>
      </article>`;
    })
    .join("");
}

function diffClass(d) {
  return d === "Новичок" ? "easy" : d === "Средне" ? "mid" : "hard";
}

/* ============================================================
   КАРТОЧКА РАСТЕНИЯ (модальное окно)
   ============================================================ */
async function openPlant(plantId) {
  const p = (window.PLANTS || []).find((x) => x.id === plantId);
  if (!p) return;

  const fav = await Store.isFavorite(p.id);
  const myPlants = await Store.getMyPlants();
  const inMine = myPlants.some((m) => m.plantId === p.id);

  $("#modal-body").innerHTML = `
    <div class="detail-head">
      <div class="detail-emoji">${p.emoji || "🌱"}</div>
      <div>
        <h2 class="detail-title">${esc(p.name)}</h2>
        <p class="detail-latin">${esc(p.latin || "")}</p>
        <span class="chip chip--${diffClass(p.difficulty)}">${esc(p.difficulty)}</span>
      </div>
    </div>

    <dl class="care-list">
      ${careRow(ICON.water, "Полив", p.watering)}
      ${careRow(ICON.sun, "Освещение", p.lighting)}
      ${careRow(ICON.pot, "Пересадка", p.transplant)}
      ${careRow(ICON.skull, "Ядовитость", p.toxicity)}
      ${careRow(ICON.leaf, "Особенности", p.features)}
    </dl>

    <div class="detail-actions">
      <button class="btn btn--primary" data-add="${p.id}" ${inMine ? "disabled" : ""}>
        ${inMine ? "Уже в моём списке" : "Добавить в мой список"}
      </button>
      <button class="btn btn--ghost ${fav ? "is-on" : ""}" data-fav-modal="${p.id}">
        ${ICON.star} ${fav ? "В избранном" : "В избранное"}
      </button>
    </div>`;

  showModal();
}

function careRow(icon, label, text) {
  return `
    <div class="care-row">
      <span class="care-icon">${icon}</span>
      <div>
        <dt>${label}</dt>
        <dd>${esc(text || "—")}</dd>
      </div>
    </div>`;
}

/* ============================================================
   МОЙ СПИСОК (читает кэш Care._myPlants)
   ============================================================ */
function renderMine() {
  const list = Care._myPlants;
  const wrap = $("#mine-list");

  if (list.length === 0) {
    wrap.innerHTML = emptyState(
      "Список пуст",
      "Откройте справочник и добавьте растения, за которыми ухаживаете."
    );
    return;
  }

  const plants = window.PLANTS || [];

  wrap.innerHTML = list
    .map((entry) => {
      const p = plants.find((x) => x.id === entry.plantId) || {};
      const title = entry.customName || p.name || "Растение";
      const progress = Care.waterProgress(entry);
      const nextW = Care.nextWaterDate(entry);
      const overdue = Care.daysBetween(nextW, Care.today());
      const statusText =
        overdue > 0 ? `Просрочен на ${overdue} ${daysWord(overdue)}` :
        overdue === 0 ? "Пора поливать сегодня" :
        `Полить через ${-overdue} ${daysWord(-overdue)}`;
      const statusClass = overdue >= 0 ? "danger" : "ok";

      return `
      <article class="card mine-card" data-entry="${entry.id}">
        <div class="mine-top">
          <div class="ring" style="--p:${Math.round(progress * 100)}">
            <span class="ring-emoji">${p.emoji || "🪴"}</span>
          </div>
          <div class="mine-info">
            <input class="mine-name-input" value="${esc(title)}" data-field="customName" placeholder="Название растения">
            <p class="mine-sub">${esc(p.latin || "")}</p>
            <span class="status status--${statusClass}">${statusText}</span>
          </div>
          <button class="icon-btn" data-remove="${entry.id}" title="Удалить" aria-label="Удалить">✕</button>
        </div>

        <div class="mine-grid">
          <label class="fld">
            <span>Интервал полива</span>
            <span class="fld-row">
              <input type="number" min="1" max="90" value="${entry.waterIntervalDays}" data-field="waterIntervalDays">
              <em>${daysWord(entry.waterIntervalDays)}</em>
            </span>
          </label>
          <label class="fld">
            <span>Последний полив</span>
            <input type="date" value="${entry.lastWatered}" data-field="lastWatered">
          </label>
          <label class="fld">
            <span>Дата пересадки</span>
            <input type="date" value="${entry.nextTransplant || ""}" data-field="nextTransplant">
          </label>
          <label class="fld">
            <span>Добавлено</span>
            <input type="text" value="${ruDate(entry.dateAdded)}" disabled>
          </label>
        </div>

        <label class="fld fld--full">
          <span>Заметки</span>
          <textarea rows="2" data-field="notes" placeholder="Например: стоит на восточном окне, зимой переставить">${esc(entry.notes)}</textarea>
        </label>

        <div class="mine-actions">
          <button class="btn btn--water" data-water="${entry.id}">${ICON.water} Полил сегодня</button>
          <label class="switch">
            <input type="checkbox" data-field="remindersOn" ${entry.remindersOn ? "checked" : ""}>
            <span>Напоминания</span>
          </label>
        </div>
      </article>`;
    })
    .join("");
}

/* ============================================================
   ИЗБРАННОЕ
   ============================================================ */
async function renderFavorites() {
  const favIds = await Store.getFavorites();
  const wrap = $("#favorites-grid");
  const favPlants = (window.PLANTS || []).filter((p) => favIds.includes(p.id));

  if (favPlants.length === 0) {
    wrap.innerHTML = emptyState(
      "Избранное пусто",
      "Нажмите на звёздочку у растения в справочнике, чтобы сохранить его."
    );
    return;
  }

  wrap.innerHTML = favPlants
    .map(
      (p) => `
      <article class="card plant-card" data-id="${p.id}" tabindex="0" role="button" aria-label="Открыть карточку: ${esc(p.name)}">
        <button class="fav-btn is-on" data-fav="${p.id}" title="Убрать из избранного" aria-label="Убрать из избранного">${ICON.star}</button>
        <div class="plant-emoji">${p.emoji || "🌱"}</div>
        <h3 class="plant-name">${esc(p.name)}</h3>
        <p class="plant-latin">${esc(p.latin || "")}</p>
        <div class="plant-meta">
          <span class="chip chip--${diffClass(p.difficulty)}">${esc(p.difficulty)}</span>
        </div>
      </article>`
    )
    .join("");
}

/* ============================================================
   ЗАДАЧИ / УВЕДОМЛЕНИЯ (читает кэш)
   ============================================================ */
function renderTasks() {
  const tasks = Care.buildTasks();
  const wrap = $("#tasks-list");

  if (tasks.length === 0) {
    wrap.innerHTML = emptyState(
      "Всё под контролем",
      "Сейчас нет растений, требующих внимания. Загляните позже."
    );
    return;
  }

  wrap.innerHTML = tasks
    .map((t) => {
      const isWater = t.type === "water";
      const label = isWater ? "Полить" : "Пересадить";
      const icon = isWater ? ICON.water : ICON.pot;
      const when =
        t.overdueDays > 0
          ? `просрочено на ${t.overdueDays} ${daysWord(t.overdueDays)}`
          : "сегодня";
      return `
      <article class="task ${isWater ? "task--water" : "task--pot"}">
        <span class="task-icon">${icon}</span>
        <div class="task-text">
          <strong>${label}: ${esc(t.plantName)}</strong>
          <span>Срок: ${ruDate(t.dueDate)} — ${when}</span>
        </div>
        <button class="btn btn--small" data-done="${t.entryId}" data-type="${t.type}">Готово</button>
      </article>`;
    })
    .join("");
}

/* ============================================================
   ПУСТЫЕ СОСТОЯНИЯ + МОДАЛКА
   ============================================================ */
function emptyState(title, text) {
  return `
    <div class="empty">
      <div class="empty-leaf">🌱</div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
    </div>`;
}

function showModal() {
  $("#modal").classList.add("is-open");
  document.body.style.overflow = "hidden";
}
function hideModal() {
  $("#modal").classList.remove("is-open");
  document.body.style.overflow = "";
  stopChatPolling(); // на случай, если был открыт чат обмена
}

/* ============================================================
   ОБРАБОТЧИКИ СОБЫТИЙ (делегирование)
   ============================================================ */
function bindEvents() {
  $$(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));

  $("#search").addEventListener("input", renderCatalog);

  $("#modal-close").addEventListener("click", hideModal);
  $("#modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") hideModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideModal();
  });

  $("#enable-push").addEventListener("click", async () => {
    const btn = $("#enable-push");
    const res = await Care.requestPermission();

    if (res.ok) {
      btn.textContent = "Уведомления включены";
      btn.disabled = true;
      const r = Care.pushDueTasks();
      if (r.tasks === 0) {
        toast("Уведомления включены. Задач пока нет — напомним, когда придёт срок.");
      } else if (r.shown) {
        toast("Уведомления включены.");
      } else {
        toast("Уведомления включены, но всплывающее окно недоступно на этом устройстве.");
      }
      startReminderLoop();
      return;
    }

    const reasons = {
      unsupported: "Этот браузер не поддерживает уведомления.",
      insecure: "Уведомления работают только по защищённому соединению (https).",
      denied: "Уведомления заблокированы. Разрешите их в настройках сайта — значок замка слева в адресной строке → Уведомления → Разрешить.",
      dismissed: "Вы не разрешили уведомления. Нажмите кнопку ещё раз и выберите «Разрешить» (в Chrome запрос может быть значком-колокольчиком справа в адресной строке).",
      error: "Не удалось запросить разрешение на уведомления.",
    };
    toast(reasons[res.reason] || "Не удалось включить уведомления.");
  });

  // Обмен: кнопка «Разместить растение»
  $("#new-listing").addEventListener("click", openNewListingForm);

  // Обмен: сохранить имя в чате
  $("#save-name").addEventListener("click", async () => {
    const name = $("#my-name").value.trim();
    if (!name) return;
    await Store.setMyName(name);
    const saved = $("#name-saved");
    saved.textContent = "Сохранено";
    setTimeout(() => (saved.textContent = ""), 2000);
  });

  // Обмен: отправка сообщения по Enter
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "chat-input") {
      e.preventDefault();
      sendChatMessage();
    }
  });

  document.addEventListener("click", async (e) => {
    // Звезда «избранное»
    const favBtn = e.target.closest("[data-fav]");
    if (favBtn) {
      e.stopPropagation();
      await Store.toggleFavorite(Number(favBtn.dataset.fav));
      await render();
      return;
    }
    // Открыть карточку
    const card = e.target.closest(".plant-card");
    if (card) {
      await openPlant(Number(card.dataset.id));
      return;
    }
    // Добавить в мой список (из модалки)
    const addBtn = e.target.closest("[data-add]");
    if (addBtn) {
      await Store.addMyPlant(Number(addBtn.dataset.add));
      hideModal();
      switchView("mine");
      return;
    }
    // Звезда в модалке
    const favModal = e.target.closest("[data-fav-modal]");
    if (favModal) {
      const id = Number(favModal.dataset.favModal);
      await Store.toggleFavorite(id);
      await openPlant(id);
      return;
    }
    // Удалить из моего списка
    const rm = e.target.closest("[data-remove]");
    if (rm) {
      await Store.removeMyPlant(rm.dataset.remove);
      await render();
      return;
    }
    // Полил сегодня
    const water = e.target.closest("[data-water]");
    if (water) {
      await Store.markWatered(water.dataset.water);
      await render();
      return;
    }
    // Задача выполнена
    const done = e.target.closest("[data-done]");
    if (done) {
      const entryId = done.dataset.done;
      if (done.dataset.type === "water") {
        await Store.markWatered(entryId);
      } else {
        await Store.updateMyPlant(entryId, { nextTransplant: "" });
      }
      await render();
      return;
    }

    /* ----- Обмен ----- */
    // Отправить объявление (кнопка в форме)
    if (e.target.closest("#listing-submit")) {
      await submitListing();
      return;
    }
    // Открыть отклики на моё объявление
    const resp = e.target.closest("[data-responders]");
    if (resp) {
      await openResponders(Number(resp.dataset.responders));
      return;
    }
    // Написать владельцу чужого объявления (создаётся/открывается диалог)
    const write = e.target.closest("[data-write]");
    if (write) {
      const cid = await Store.openConversation(Number(write.dataset.write));
      if (cid) await openConversation(cid);
      return;
    }
    // Открыть конкретный диалог из списка откликов
    const openConv = e.target.closest("[data-open-conv]");
    if (openConv) {
      await openConversation(Number(openConv.dataset.openConv));
      return;
    }
    // Отправить сообщение
    if (e.target.closest("#chat-send")) {
      await sendChatMessage();
      return;
    }
    // Сменить статус объявления (кнопки на карточке владельца)
    const seg = e.target.closest("[data-listing-status]");
    if (seg) {
      await Store.setListingStatus(Number(seg.dataset.listingStatus), seg.dataset.status);
      await renderExchange();
      return;
    }
    // Удалить объявление (владелец)
    const delL = e.target.closest("[data-delete-listing]");
    if (delL) {
      if (confirm("Удалить объявление вместе со всеми диалогами?")) {
        await Store.deleteListing(Number(delL.dataset.deleteListing));
        hideModal();
        renderExchange();
      }
      return;
    }
  });

  // Изменение полей в «моём списке»
  $("#mine-list").addEventListener("change", onMineFieldChange);
  $("#mine-list").addEventListener("input", (e) => {
    if (e.target.matches('[data-field="customName"], [data-field="notes"]')) {
      onMineFieldChange(e);
    }
  });
}

async function onMineFieldChange(e) {
  const field = e.target.dataset.field;
  if (!field) return;
  const card = e.target.closest("[data-entry]");
  if (!card) return;
  const entryId = card.dataset.entry;

  let value;
  if (e.target.type === "checkbox") value = e.target.checked;
  else if (e.target.type === "number") value = Math.max(1, Number(e.target.value) || 1);
  else value = e.target.value;

  await Store.updateMyPlant(entryId, { [field]: value });

  // Поля, влияющие на расписание, требуют пересчёта статуса и бейджа
  if (["waterIntervalDays", "lastWatered", "nextTransplant", "remindersOn"].includes(field)) {
    await refreshMyPlants();
    renderMine();
    updateBadge();
  }
}

/* ============================================================
   ОБМЕН РАСТЕНИЯМИ
   Модель: на каждое объявление — отдельный диалог с каждым
   откликнувшимся. Сверху «Мои объявления», снизу «Другие».
   ============================================================ */
let chatPollId = null;    // таймер опроса диалога
let currentConvId = null; // id открытого диалога

const STATUS_LABEL = { open: "Открыто", reserved: "Зарезервировано", closed: "Закрыто" };

async function renderExchange() {
  // Имя в профиле (не затираем, если пользователь сейчас печатает)
  const me = await Store.getMe();
  const nameInput = $("#my-name");
  if (nameInput && document.activeElement !== nameInput) {
    nameInput.value = me.displayName === "Гость" ? "" : me.displayName;
  }

  const listings = await Store.getListings();
  const mine = listings.filter((l) => l.mine);
  const others = listings.filter((l) => !l.mine);

  const mineHtml = mine.length
    ? mine.map((l) => listingCardMine(l)).join("")
    : emptyState("У вас нет объявлений", "Нажмите «Разместить растение», чтобы предложить растение к обмену.");

  const othersHtml = others.length
    ? others.map((l) => listingCardOther(l)).join("")
    : emptyState("Пока нет чужих объявлений", "Здесь появятся растения, которые предлагают другие пользователи.");

  $("#exchange-list").innerHTML = `
    <h2 class="group-title">Мои объявления</h2>
    <div class="stack">${mineHtml}</div>
    <h2 class="group-title group-title--spaced">Другие объявления</h2>
    <div class="stack">${othersHtml}</div>`;
}

// Карточка моего объявления: статус, отклики, управление
function listingCardMine(l) {
  const emoji = l.plant_emoji || "🪴";
  const plantLine = l.plant_name ? ` · ${esc(l.plant_name)}` : "";
  const segs = ["open", "reserved", "closed"]
    .map((s) => `<button class="seg ${l.status === s ? "is-on" : ""}" data-listing-status="${l.id}" data-status="${s}">${STATUS_LABEL[s]}</button>`)
    .join("");
  return `
    <article class="card listing-card">
      <div class="listing-emoji">${emoji}</div>
      <div class="listing-body">
        <div class="listing-head">
          <h3 class="listing-title">${esc(l.title)}<span class="mine-badge">моё</span></h3>
          <span class="status-tag status-tag--${l.status}">${STATUS_LABEL[l.status] || l.status}</span>
        </div>
        <p class="listing-owner">${esc(l.owner_name || "Вы")}${plantLine}</p>
        ${l.description ? `<p class="listing-desc">${esc(l.description)}</p>` : ""}
        ${l.wants ? `<p class="listing-wants"><strong>Хочу взамен:</strong> ${esc(l.wants)}</p>` : ""}
        <div class="listing-actions">
          <button class="btn btn--small" data-responders="${l.id}">Отклики · ${l.response_count}</button>
          <span class="seg-group">${segs}</span>
          <button class="btn btn--small btn--danger" data-delete-listing="${l.id}">Удалить</button>
        </div>
      </div>
    </article>`;
}

// Карточка чужого объявления: кнопка «Написать»
function listingCardOther(l) {
  const emoji = l.plant_emoji || "🪴";
  const plantLine = l.plant_name ? ` · ${esc(l.plant_name)}` : "";
  return `
    <article class="card listing-card">
      <div class="listing-emoji">${emoji}</div>
      <div class="listing-body">
        <div class="listing-head">
          <h3 class="listing-title">${esc(l.title)}</h3>
          <span class="status-tag status-tag--${l.status}">${STATUS_LABEL[l.status] || l.status}</span>
        </div>
        <p class="listing-owner">от ${esc(l.owner_name || "Гость")}${plantLine}</p>
        ${l.description ? `<p class="listing-desc">${esc(l.description)}</p>` : ""}
        ${l.wants ? `<p class="listing-wants"><strong>Хочет взамен:</strong> ${esc(l.wants)}</p>` : ""}
        <div class="listing-actions">
          <button class="btn btn--small btn--primary" data-write="${l.id}">Написать владельцу</button>
        </div>
      </div>
    </article>`;
}

/* ----- Форма создания объявления ----- */
function openNewListingForm() {
  const options = (window.PLANTS || [])
    .map((p) => `<option value="${p.id}">${p.emoji} ${esc(p.name)}</option>`)
    .join("");

  $("#modal-body").innerHTML = `
    <h2 class="detail-title" style="margin-bottom:18px">Разместить растение</h2>
    <div class="form-grid">
      <label class="fld">
        <span>Растение из справочника (необязательно)</span>
        <select id="listing-plant"><option value="">— не выбрано —</option>${options}</select>
      </label>
      <label class="fld">
        <span>Заголовок объявления *</span>
        <input id="listing-title" type="text" maxlength="120" placeholder="Например: Отдам отросток монстеры">
      </label>
      <label class="fld">
        <span>Описание</span>
        <textarea id="listing-desc" rows="3" placeholder="Состояние растения, размер, есть ли корни…"></textarea>
      </label>
      <label class="fld">
        <span>Что хотите взамен</span>
        <textarea id="listing-wants" rows="2" placeholder="Например: суккуленты, орхидею или просто в добрые руки"></textarea>
      </label>
      <div class="detail-actions">
        <button id="listing-submit" class="btn btn--primary">Разместить</button>
      </div>
      <p id="listing-error" class="form-error"></p>
    </div>`;

  showModal();
  setTimeout(() => $("#listing-title") && $("#listing-title").focus(), 50);
}

async function submitListing() {
  const title = $("#listing-title").value.trim();
  if (!title) {
    $("#listing-error").textContent = "Введите заголовок объявления.";
    return;
  }
  await Store.createListing({
    plantId: $("#listing-plant").value || null,
    title,
    description: $("#listing-desc").value.trim(),
    wants: $("#listing-wants").value.trim(),
  });
  hideModal();
  renderExchange();
}

/* ----- Отклики на моё объявление (список диалогов) ----- */
async function openResponders(listingId) {
  const convs = await Store.getConversations(listingId);

  const rows = convs.length
    ? convs
        .map(
          (c) => `
        <button class="conv-row" data-open-conv="${c.id}">
          <span class="conv-avatar">${esc((c.responder_name || "?").slice(0, 1).toUpperCase())}</span>
          <span class="conv-text">
            <span class="conv-name">${esc(c.responder_name || "Гость")}</span>
            <span class="conv-last">${esc(c.last_body || "")}</span>
          </span>
          <span class="conv-count">${c.message_count}</span>
        </button>`
        )
        .join("")
    : `<p class="chat-empty">Пока никто не написал по этому объявлению.</p>`;

  $("#modal-body").innerHTML = `
    <h2 class="detail-title" style="margin-bottom:16px">Отклики на объявление</h2>
    <div class="conv-list">${rows}</div>`;
  showModal();
}

/* ----- Диалог (чат) ----- */
async function openConversation(cid) {
  const data = await Store.getConversation(cid);
  if (!data || !data.conversation) return;
  currentConvId = cid;
  const c = data.conversation;
  const emoji = c.plant_emoji || "🪴";

  $("#modal-body").innerHTML = `
    <div class="chat-head">
      <div class="chat-head-top">
        <span class="detail-emoji" style="font-size:34px;padding:6px 8px">${emoji}</span>
        <div>
          <h2 class="detail-title" style="font-size:19px">${esc(c.otherName || "Гость")}</h2>
          <p class="detail-latin" style="font-style:normal">по объявлению: ${esc(c.listing_title)}${c.plant_name ? " · " + esc(c.plant_name) : ""}</p>
          <span class="status-tag status-tag--${c.status}">${STATUS_LABEL[c.status] || c.status}</span>
        </div>
      </div>
      ${c.wants ? `<p class="listing-wants"><strong>Хочет взамен:</strong> ${esc(c.wants)}</p>` : ""}
    </div>

    <div id="chat-messages" class="chat-messages"></div>

    <div class="chat-input-row">
      <input id="chat-input" type="text" maxlength="1000" placeholder="Напишите сообщение…" autocomplete="off">
      <button id="chat-send" class="btn btn--primary">Отправить</button>
    </div>`;

  renderMessages(data.messages);
  showModal();
  startChatPolling();
  setTimeout(() => $("#chat-input") && $("#chat-input").focus(), 50);
}

function renderMessages(messages) {
  const box = $("#chat-messages");
  if (!box) return;
  if (!messages || messages.length === 0) {
    box.innerHTML = `<p class="chat-empty">Пока нет сообщений. Начните обсуждение первым.</p>`;
    box.dataset.count = "0";
    return;
  }
  box.innerHTML = messages
    .map(
      (m) => `
      <div class="msg ${m.mine ? "msg--mine" : "msg--other"}">
        ${m.mine ? "" : `<span class="msg-author">${esc(m.author_name || "Гость")}</span>`}
        <p class="msg-body">${esc(m.body)}</p>
      </div>`
    )
    .join("");
  box.dataset.count = String(messages.length);
  box.scrollTop = box.scrollHeight;
}

async function refreshChatMessages() {
  if (!currentConvId) return;
  const msgs = await Store.getConversationMessages(currentConvId);
  const box = $("#chat-messages");
  if (box && box.dataset.count === String(msgs.length)) return; // без изменений
  renderMessages(msgs);
}

async function sendChatMessage() {
  const input = $("#chat-input");
  if (!input || !currentConvId) return;
  const body = input.value.trim();
  if (!body) return;
  input.value = "";
  await Store.sendConversationMessage(currentConvId, body);
  await refreshChatMessages();
}

function startChatPolling() {
  if (chatPollId) clearInterval(chatPollId);
  chatPollId = setInterval(refreshChatMessages, 3000);
}
function stopChatPolling() {
  if (chatPollId) {
    clearInterval(chatPollId);
    chatPollId = null;
  }
  currentConvId = null;
}


/* ============================================================
   СТАРТ
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();

  // Пробуем взять справочник с сервера. Если сервер недоступен —
  // остаётся встроенный список из data.js (window.PLANTS).
  const serverCatalog = await Store.getCatalog();
  if (serverCatalog && serverCatalog.length > 0) {
    window.PLANTS = serverCatalog;
  }

  // Если уведомления уже разрешены — сразу отражаем это и запускаем проверку
  if ("Notification" in window && Notification.permission === "granted") {
    const btn = $("#enable-push");
    if (btn) {
      btn.textContent = "Уведомления включены";
      btn.disabled = true;
    }
    startReminderLoop();
  }

  switchView("catalog");
});
