const Store = {
  _getToken() {
    let token = localStorage.getItem("pc_device_token");
    if (!token) {
      token =
        "dev_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();
      localStorage.setItem("pc_device_token", token);
    }
    return token;
  },

  _headers() {
    return {
      "Content-Type": "application/json",
      "X-Device-Token": this._getToken(),
    };
  },

  _mapFromDb(row) {
    if (!row) return null;
    return {
      id: row.id,
      plantId: Number(row.plant_id),
      customName: row.custom_name || "",
      dateAdded: row.date_added,
      notes: row.notes || "",
      waterIntervalDays: Number(row.water_interval_days),
      lastWatered: row.last_watered,
      nextTransplant: row.next_transplant || "",
      remindersOn: Boolean(row.reminders_on),
    };
  },

  _mapToDb(patch) {
    const out = {};
    if (patch.customName !== undefined) out.custom_name = patch.customName;
    if (patch.notes !== undefined) out.notes = patch.notes;
    if (patch.waterIntervalDays !== undefined)
      out.water_interval_days = patch.waterIntervalDays;
    if (patch.lastWatered !== undefined) out.last_watered = patch.lastWatered;
    if (patch.nextTransplant !== undefined)
      out.next_transplant = patch.nextTransplant;
    if (patch.remindersOn !== undefined)
      out.reminders_on = patch.remindersOn ? 1 : 0;
    return out;
  },

  async getCatalog() {
    try {
      const res = await fetch("/api/plants");
      const data = await res.json();
      return data.map((p) => ({
        id: p.id,
        name: p.name,
        latin: p.latin,
        emoji: p.emoji,
        difficulty: p.difficulty,
        waterIntervalDays: Number(p.water_interval_days),
        watering: p.watering,
        lighting: p.lighting,
        transplant: p.transplant,
        toxicity: p.toxicity,
        features: p.features,
      }));
    } catch (e) {
      console.error("Не удалось загрузить каталог:", e);
      return [];
    }
  },

  async getFavorites() {
    try {
      const res = await fetch("/api/favorites", { headers: this._headers() });
      return await res.json();
    } catch (e) {
      console.warn("Не удалось получить избранное:", e);
      return [];
    }
  },

  async isFavorite(plantId) {
    const list = await this.getFavorites();
    return list.includes(Number(plantId));
  },

  async toggleFavorite(plantId) {
    try {
      const isFav = await this.isFavorite(plantId);
      const method = isFav ? "DELETE" : "POST";
      const res = await fetch(`/api/favorites/${plantId}`, {
        method,
        headers: this._headers(),
      });
      const status = await res.json();
      return status.ok ? !isFav : isFav;
    } catch (e) {
      console.warn("Не удалось переключить избранное:", e);
      return false;
    }
  },

  async getMyPlants() {
    try {
      const res = await fetch("/api/my-plants", { headers: this._headers() });
      const rows = await res.json();
      return rows.map((row) => this._mapFromDb(row));
    } catch (e) {
      console.warn("Не удалось прочитать список растений:", e);
      return [];
    }
  },

  async addMyPlant(plantId) {
    try {
      const res = await fetch("/api/my-plants", {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ plantId: Number(plantId) }),
      });
      return this._mapFromDb(await res.json());
    } catch (e) {
      console.error("Не удалось добавить растение:", e);
      return null;
    }
  },

  async updateMyPlant(entryId, patch) {
    try {
      const res = await fetch(`/api/my-plants/${entryId}`, {
        method: "PATCH",
        headers: this._headers(),
        body: JSON.stringify(this._mapToDb(patch)),
      });
      return this._mapFromDb(await res.json());
    } catch (e) {
      console.error("Не удалось обновить растение:", e);
      return null;
    }
  },

  async removeMyPlant(entryId) {
    try {
      await fetch(`/api/my-plants/${entryId}`, {
        method: "DELETE",
        headers: this._headers(),
      });
    } catch (e) {
      console.error("Не удалось удалить растение:", e);
    }
  },

  async markWatered(entryId) {
    try {
      await fetch(`/api/my-plants/${entryId}/water`, {
        method: "POST",
        headers: this._headers(),
      });
    } catch (e) {
      console.error("Не удалось отметить полив:", e);
    }
  },

  async getMe() {
    try {
      const res = await fetch("/api/me", { headers: this._headers() });
      return await res.json();
    } catch (e) {
      console.warn("Не удалось получить профиль:", e);
      return { id: null, displayName: "Гость" };
    }
  },

  async setMyName(displayName) {
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: this._headers(),
        body: JSON.stringify({ displayName }),
      });
      return await res.json();
    } catch (e) {
      console.error("Не удалось сохранить имя:", e);
      return null;
    }
  },

  async register(username, password) {
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.ok && data.token) {
        localStorage.setItem("pc_device_token", data.token);
      }
      return data;
    } catch (e) {
      return { error: "Ошибка сети" };
    }
  },

  async login(username, password) {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.ok && data.token) {
        localStorage.setItem("pc_device_token", data.token);
      }
      return data;
    } catch (e) {
      return { error: "Ошибка сети" };
    }
  },

  logout() {
    const fresh =
      "dev_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();
    localStorage.setItem("pc_device_token", fresh);
  },

  async getListings() {
    try {
      const res = await fetch("/api/exchange", { headers: this._headers() });
      return await res.json();
    } catch (e) {
      console.warn("Не удалось получить объявления:", e);
      return [];
    }
  },

  async createListing(data) {
    try {
      const res = await fetch("/api/exchange", {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(data),
      });
      return await res.json();
    } catch (e) {
      console.error("Не удалось создать объявление:", e);
      return null;
    }
  },

  async getListing(id) {
    try {
      const res = await fetch(`/api/exchange/${id}`, {
        headers: this._headers(),
      });
      return await res.json();
    } catch (e) {
      console.warn("Не удалось открыть объявление:", e);
      return null;
    }
  },

  async setListingStatus(id, status) {
    try {
      const res = await fetch(`/api/exchange/${id}`, {
        method: "PATCH",
        headers: this._headers(),
        body: JSON.stringify({ status }),
      });
      return await res.json();
    } catch (e) {
      console.error("Не удалось изменить статус:", e);
      return null;
    }
  },

  async deleteListing(id) {
    try {
      await fetch(`/api/exchange/${id}`, {
        method: "DELETE",
        headers: this._headers(),
      });
    } catch (e) {
      console.error("Не удалось удалить объявление:", e);
    }
  },

  async getConversations(listingId) {
    try {
      const res = await fetch(`/api/exchange/${listingId}/conversations`, {
        headers: this._headers(),
      });
      return await res.json();
    } catch (e) {
      console.warn("Не удалось получить отклики:", e);
      return [];
    }
  },

  async openConversation(listingId) {
    try {
      const res = await fetch(`/api/exchange/${listingId}/open`, {
        method: "POST",
        headers: this._headers(),
      });
      const data = await res.json();
      return data.conversationId || null;
    } catch (e) {
      console.error("Не удалось открыть диалог:", e);
      return null;
    }
  },

  async getConversation(cid) {
    try {
      const res = await fetch(`/api/conversations/${cid}`, {
        headers: this._headers(),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.warn("Не удалось загрузить диалог:", e);
      return null;
    }
  },

  async getConversationMessages(cid) {
    try {
      const res = await fetch(`/api/conversations/${cid}/messages`, {
        headers: this._headers(),
      });
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      return [];
    }
  },

  async sendConversationMessage(cid, body) {
    try {
      await fetch(`/api/conversations/${cid}/messages`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({ body }),
      });
    } catch (e) {
      console.error("Не удалось отправить сообщение:", e);
    }
  },
};

window.Store = Store;
