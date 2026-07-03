/* ============================================================
   notifications.js — расчёт задач по уходу и напоминания.

   ВАЖНО: список растений теперь приходит с сервера асинхронно,
   поэтому buildTasks() работает не с сервером напрямую, а с
   кэшем, который обновляет app.js через Care.setMyPlants(list).

   Задача появляется, когда:
     • полив: сегодня >= lastWatered + waterIntervalDays
     • пересадка: задана дата nextTransplant и сегодня >= неё
   ============================================================ */

const Care = {
  _myPlants: [], // кэш личного списка (заполняет app.js)

  setMyPlants(list) {
    this._myPlants = Array.isArray(list) ? list : [];
  },

  daysBetween(a, b) {
    const ms = new Date(b) - new Date(a);
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  },

  today() {
    return new Date().toISOString().slice(0, 10);
  },

  nextWaterDate(entry) {
    const d = new Date(entry.lastWatered);
    d.setDate(d.getDate() + Number(entry.waterIntervalDays || 0));
    return d.toISOString().slice(0, 10);
  },

  // Прогресс до следующего полива, 0..1 (1 = пора поливать)
  waterProgress(entry) {
    const passed = this.daysBetween(entry.lastWatered, this.today());
    const interval = Number(entry.waterIntervalDays || 1);
    return Math.max(0, Math.min(1, passed / interval));
  },

  // Собрать все актуальные задачи из кэша
  buildTasks() {
    const today = this.today();
    const tasks = [];
    const plants = window.PLANTS || [];

    this._myPlants.forEach((entry) => {
      if (!entry.remindersOn) return;
      const plant = plants.find((p) => p.id === entry.plantId);
      const title = entry.customName || (plant ? plant.name : "Растение");

      // Полив
      const nextW = this.nextWaterDate(entry);
      const overdueW = this.daysBetween(nextW, today);
      if (overdueW >= 0) {
        tasks.push({
          entryId: entry.id,
          type: "water",
          plantName: title,
          dueDate: nextW,
          overdueDays: overdueW,
        });
      }

      // Пересадка
      if (entry.nextTransplant) {
        const overdueT = this.daysBetween(entry.nextTransplant, today);
        if (overdueT >= 0) {
          tasks.push({
            entryId: entry.id,
            type: "transplant",
            plantName: title,
            dueDate: entry.nextTransplant,
            overdueDays: overdueT,
          });
        }
      }
    });

    tasks.sort((a, b) => b.overdueDays - a.overdueDays);
    return tasks;
  },

  taskCount() {
    return this.buildTasks().length;
  },

  /* ---------- Браузерные push-уведомления ---------- */
  // Возвращает { ok, reason } — reason объясняет, почему не получилось
  async requestPermission() {
    if (!("Notification" in window)) return { ok: false, reason: "unsupported" };
    if (!window.isSecureContext) return { ok: false, reason: "insecure" };

    let perm = Notification.permission;
    if (perm === "default") {
      try {
        perm = await Notification.requestPermission();
      } catch (e) {
        return { ok: false, reason: "error" };
      }
    }
    if (perm === "granted") return { ok: true };
    if (perm === "denied") return { ok: false, reason: "denied" };
    return { ok: false, reason: "dismissed" };
  },

  // Показать одно системное уведомление. true — если удалось.
  notify(title, body) {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, {
          body,
          icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🪴%3C/text%3E%3C/svg%3E",
        });
        return true;
      }
    } catch (e) {
      // Некоторые мобильные браузеры требуют service worker — тихо игнорируем
      console.warn("Уведомление не показано:", e);
    }
    return false;
  },

  // Показать уведомление по текущим задачам. Возвращает { tasks, shown }.
  pushDueTasks() {
    const tasks = this.buildTasks();
    if (tasks.length === 0) return { tasks: 0, shown: false };

    const actions = tasks
      .map((t) => (t.type === "water" ? "полить " : "пересадить ") + t.plantName)
      .join(", ");

    const shown = this.notify("Уход за растениями", `Пора: ${actions}`);
    return { tasks: tasks.length, shown };
  },
};

window.Care = Care;
