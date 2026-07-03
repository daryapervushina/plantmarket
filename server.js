/* ============================================================
   server.js — REST API + раздача статики.
   Запуск:  node server.js   (после npm install)
   Открыть: http://localhost:3000

   Пользователь определяется по заголовку X-Device-Token.
   ============================================================ */

const express = require("express");
const crypto = require("crypto");
const { db, getOrCreateUser } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

// Хеширование пароля через встроенный scrypt (без внешних пакетов)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.use(express.json());
app.use(express.static(__dirname));

// Мидлвар: по токену устройства находим/создаём пользователя
app.use("/api", (req, res, next) => {
  const token = req.header("X-Device-Token") || "anonymous";
  req.user = getOrCreateUser(token);
  next();
});

/* ---------------- Профиль и аккаунт ---------------- */
app.get("/api/me", (req, res) => {
  const u = db
    .prepare("SELECT id, display_name, username FROM users WHERE id = ?")
    .get(req.user.id);
  res.json({
    id: u.id,
    displayName: u.display_name || "Гость",
    username: u.username || null, // null → вошёл как гость
  });
});

app.patch("/api/me", (req, res) => {
  const name = (req.body.displayName || "").toString().trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: "Пустое имя" });
  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(name, req.user.id);
  res.json({ ok: true, displayName: name });
});

// Регистрация: «превращаем» текущего анонимного пользователя в аккаунт,
// сохраняя все его нынешние списки и избранное.
app.post("/api/auth/register", (req, res) => {
  const username = (req.body.username || "").toString().trim().toLowerCase().slice(0, 32);
  const password = (req.body.password || "").toString();
  if (username.length < 3) return res.status(400).json({ error: "Логин не короче 3 символов" });
  if (password.length < 4) return res.status(400).json({ error: "Пароль не короче 4 символов" });

  const taken = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (taken) return res.status(409).json({ error: "Такой логин уже занят" });

  db.prepare(
    `UPDATE users
       SET username = ?, password_hash = ?,
           display_name = CASE WHEN display_name IS NULL OR display_name = 'Гость'
                               THEN ? ELSE display_name END
     WHERE id = ?`
  ).run(username, hashPassword(password), username, req.user.id);

  const u = db.prepare("SELECT device_token, username FROM users WHERE id = ?").get(req.user.id);
  res.json({ ok: true, token: u.device_token, username: u.username });
});

// Вход: возвращаем токен аккаунта. Клиент начинает использовать его как
// X-Device-Token — и получает те же данные на любом устройстве.
app.post("/api/auth/login", (req, res) => {
  const username = (req.body.username || "").toString().trim().toLowerCase();
  const password = (req.body.password || "").toString();

  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!u || !verifyPassword(password, u.password_hash))
    return res.status(401).json({ error: "Неверный логин или пароль" });

  res.json({ ok: true, token: u.device_token, username: u.username });
});

/* ---------------- Справочник ---------------- */
app.get("/api/plants", (req, res) => {
  res.json(db.prepare("SELECT * FROM plants ORDER BY id").all());
});
app.get("/api/plants/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM plants WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Растение не найдено" });
  res.json(row);
});

/* ---------------- Избранное ---------------- */
app.get("/api/favorites", (req, res) => {
  const rows = db.prepare("SELECT plant_id FROM favorites WHERE user_id = ?").all(req.user.id);
  res.json(rows.map((r) => r.plant_id));
});
app.post("/api/favorites/:plantId", (req, res) => {
  db.prepare("INSERT OR IGNORE INTO favorites (user_id, plant_id) VALUES (?, ?)")
    .run(req.user.id, Number(req.params.plantId));
  res.json({ ok: true });
});
app.delete("/api/favorites/:plantId", (req, res) => {
  db.prepare("DELETE FROM favorites WHERE user_id = ? AND plant_id = ?")
    .run(req.user.id, Number(req.params.plantId));
  res.json({ ok: true });
});

/* ---------------- Личный список ---------------- */
app.get("/api/my-plants", (req, res) => {
  res.json(db.prepare("SELECT * FROM my_plants WHERE user_id = ? ORDER BY id").all(req.user.id));
});
app.post("/api/my-plants", (req, res) => {
  const { plantId } = req.body;
  const plant = db.prepare("SELECT * FROM plants WHERE id = ?").get(plantId);
  if (!plant) return res.status(400).json({ error: "Нет такого растения" });
  const today = new Date().toISOString().slice(0, 10);
  const info = db
    .prepare(
      `INSERT INTO my_plants
        (user_id, plant_id, custom_name, date_added, notes,
         water_interval_days, last_watered, next_transplant, reminders_on)
       VALUES (?, ?, '', ?, '', ?, ?, '', 1)`
    )
    .run(req.user.id, plantId, today, plant.water_interval_days, today);
  res.status(201).json(db.prepare("SELECT * FROM my_plants WHERE id = ?").get(info.lastInsertRowid));
});
app.patch("/api/my-plants/:id", (req, res) => {
  const allowed = ["custom_name", "notes", "water_interval_days", "last_watered", "next_transplant", "reminders_on"];
  const fields = Object.keys(req.body).filter((k) => allowed.includes(k));
  if (fields.length === 0) return res.status(400).json({ error: "Нет полей для обновления" });
  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  const values = fields.map((f) => req.body[f]);
  values.push(req.params.id, req.user.id);
  db.prepare(`UPDATE my_plants SET ${setClause} WHERE id = ? AND user_id = ?`).run(...values);
  res.json(db.prepare("SELECT * FROM my_plants WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id));
});
app.post("/api/my-plants/:id/water", (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare("UPDATE my_plants SET last_watered = ? WHERE id = ? AND user_id = ?")
    .run(today, req.params.id, req.user.id);
  res.json({ ok: true, last_watered: today });
});
app.delete("/api/my-plants/:id", (req, res) => {
  db.prepare("DELETE FROM my_plants WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ============================================================
   ОБМЕН РАСТЕНИЯМИ (усложнение)
   Модель: на каждое объявление — отдельный диалог с каждым
   откликнувшимся. Владелец видит по одному чату на человека.
   ============================================================ */

// Объявление + автор + растение + число реальных откликов
// (отклик = диалог, в котором есть хотя бы одно сообщение)
const LISTING_SELECT = `
  SELECT l.*, u.display_name AS owner_name,
         p.name AS plant_name, p.emoji AS plant_emoji,
         (SELECT COUNT(*) FROM exchange_conversations c
            WHERE c.listing_id = l.id
              AND EXISTS (SELECT 1 FROM exchange_messages m WHERE m.conversation_id = c.id)
         ) AS response_count
  FROM exchange_listings l
  JOIN users u ON u.id = l.user_id
  LEFT JOIN plants p ON p.id = l.plant_id`;

function withMine(row, userId) {
  return row ? { ...row, mine: row.user_id === userId } : row;
}

// Список всех объявлений (клиент сам делит на «мои» и «чужие»)
app.get("/api/exchange", (req, res) => {
  const rows = db.prepare(LISTING_SELECT + " ORDER BY l.created_at DESC, l.id DESC").all();
  res.json(rows.map((r) => withMine(r, req.user.id)));
});

// Создать объявление
app.post("/api/exchange", (req, res) => {
  const title = (req.body.title || "").toString().trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: "Нужен заголовок" });
  const plantId = req.body.plantId ? Number(req.body.plantId) : null;
  const description = (req.body.description || "").toString().slice(0, 1000);
  const wants = (req.body.wants || "").toString().slice(0, 500);

  const info = db
    .prepare(
      `INSERT INTO exchange_listings (user_id, plant_id, title, description, wants, status)
       VALUES (?, ?, ?, ?, ?, 'open')`
    )
    .run(req.user.id, plantId, title, description, wants);

  const row = db.prepare(LISTING_SELECT + " WHERE l.id = ?").get(info.lastInsertRowid);
  res.status(201).json(withMine(row, req.user.id));
});

// Изменить статус (только владелец)
app.patch("/api/exchange/:id", (req, res) => {
  const listing = db.prepare("SELECT * FROM exchange_listings WHERE id = ?").get(req.params.id);
  if (!listing) return res.status(404).json({ error: "Объявление не найдено" });
  if (listing.user_id !== req.user.id) return res.status(403).json({ error: "Это не ваше объявление" });
  const status = req.body.status;
  if (!["open", "reserved", "closed"].includes(status))
    return res.status(400).json({ error: "Недопустимый статус" });
  db.prepare("UPDATE exchange_listings SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true, status });
});

// Удалить объявление (только владелец)
app.delete("/api/exchange/:id", (req, res) => {
  const listing = db.prepare("SELECT * FROM exchange_listings WHERE id = ?").get(req.params.id);
  if (!listing) return res.status(404).json({ error: "Объявление не найдено" });
  if (listing.user_id !== req.user.id) return res.status(403).json({ error: "Это не ваше объявление" });
  db.prepare("DELETE FROM exchange_listings WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Отклики на моё объявление: список диалогов (только владелец),
// показываем только диалоги, где есть сообщения
app.get("/api/exchange/:id/conversations", (req, res) => {
  const listing = db.prepare("SELECT * FROM exchange_listings WHERE id = ?").get(req.params.id);
  if (!listing) return res.status(404).json({ error: "Объявление не найдено" });
  if (listing.user_id !== req.user.id) return res.status(403).json({ error: "Это не ваше объявление" });

  const rows = db
    .prepare(
      `SELECT c.id, c.responder_id, u.display_name AS responder_name,
              (SELECT COUNT(*) FROM exchange_messages m WHERE m.conversation_id = c.id) AS message_count,
              (SELECT body FROM exchange_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body
       FROM exchange_conversations c
       JOIN users u ON u.id = c.responder_id
       WHERE c.listing_id = ?
       ORDER BY c.id DESC`
    )
    .all(req.params.id)
    .filter((r) => r.message_count > 0);

  res.json(rows);
});

// Откликнуться на чужое объявление: получить/создать свой диалог с владельцем
app.post("/api/exchange/:id/open", (req, res) => {
  const listing = db.prepare("SELECT * FROM exchange_listings WHERE id = ?").get(req.params.id);
  if (!listing) return res.status(404).json({ error: "Объявление не найдено" });
  if (listing.user_id === req.user.id)
    return res.status(400).json({ error: "Нельзя откликнуться на своё объявление" });

  db.prepare(
    "INSERT OR IGNORE INTO exchange_conversations (listing_id, responder_id) VALUES (?, ?)"
  ).run(req.params.id, req.user.id);

  const conv = db
    .prepare("SELECT id FROM exchange_conversations WHERE listing_id = ? AND responder_id = ?")
    .get(req.params.id, req.user.id);

  res.json({ conversationId: conv.id });
});

// Загрузить диалог с проверкой доступа (участник = владелец или откликнувшийся)
function loadConversation(cid, userId) {
  const c = db
    .prepare(
      `SELECT c.id, c.listing_id, c.responder_id,
              l.user_id AS owner_id, l.title AS listing_title, l.status, l.wants,
              ownr.display_name AS owner_name,
              resp.display_name AS responder_name,
              p.name AS plant_name, p.emoji AS plant_emoji
       FROM exchange_conversations c
       JOIN exchange_listings l ON l.id = c.listing_id
       JOIN users ownr ON ownr.id = l.user_id
       JOIN users resp ON resp.id = c.responder_id
       LEFT JOIN plants p ON p.id = l.plant_id
       WHERE c.id = ?`
    )
    .get(cid);
  if (!c) return { error: 404 };
  if (userId !== c.owner_id && userId !== c.responder_id) return { error: 403 };
  // Имя собеседника с точки зрения текущего пользователя
  c.iAmOwner = userId === c.owner_id;
  c.otherName = c.iAmOwner ? c.responder_name : c.owner_name;
  return { conversation: c };
}

function messagesOf(cid, userId) {
  return db
    .prepare(
      `SELECT m.id, m.user_id, m.body, m.created_at, u.display_name AS author_name
       FROM exchange_messages m JOIN users u ON u.id = m.user_id
       WHERE m.conversation_id = ? ORDER BY m.id ASC`
    )
    .all(cid)
    .map((m) => ({ ...m, mine: m.user_id === userId }));
}

// Диалог + сообщения
app.get("/api/conversations/:cid", (req, res) => {
  const r = loadConversation(req.params.cid, req.user.id);
  if (r.error) return res.status(r.error).json({ error: "Нет доступа к диалогу" });
  res.json({ conversation: r.conversation, messages: messagesOf(req.params.cid, req.user.id) });
});

// Только сообщения (для опроса)
app.get("/api/conversations/:cid/messages", (req, res) => {
  const r = loadConversation(req.params.cid, req.user.id);
  if (r.error) return res.status(r.error).json({ error: "Нет доступа к диалогу" });
  res.json(messagesOf(req.params.cid, req.user.id));
});

// Отправить сообщение в диалог
app.post("/api/conversations/:cid/messages", (req, res) => {
  const r = loadConversation(req.params.cid, req.user.id);
  if (r.error) return res.status(r.error).json({ error: "Нет доступа к диалогу" });
  const body = (req.body.body || "").toString().trim().slice(0, 1000);
  if (!body) return res.status(400).json({ error: "Пустое сообщение" });

  db.prepare("INSERT INTO exchange_messages (conversation_id, user_id, body) VALUES (?, ?, ?)")
    .run(req.params.cid, req.user.id, body);
  res.status(201).json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Оранжерея запущена: http://localhost:${PORT}`);
});