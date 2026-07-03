-- ============================================================
--  Оранжерея — схема базы данных
--  Написано для SQLite (проще всего запустить для учебного проекта).
--  Комментарии показывают отличия для MySQL/PostgreSQL.
--
--  Запуск (SQLite):
--     sqlite3 plants.db < schema.sql
-- ============================================================

PRAGMA foreign_keys = ON;   -- SQLite: включить внешние ключи

-- ------------------------------------------------------------
-- 1. Справочник растений (общий, унифицированный)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS plants;
CREATE TABLE plants (
  id                  INTEGER PRIMARY KEY,          -- MySQL: INT AUTO_INCREMENT
  name                TEXT    NOT NULL,
  latin               TEXT,
  emoji               TEXT,
  difficulty          TEXT,                          -- Новичок / Средне / Опытный
  water_interval_days INTEGER NOT NULL DEFAULT 7,
  watering            TEXT,
  lighting            TEXT,
  transplant          TEXT,
  toxicity            TEXT,
  features            TEXT
);

-- ------------------------------------------------------------
-- 2. Пользователи
--    device_token — «сессионный» токен. У анонимного пользователя он
--    случайный и свой на каждом устройстве. Если пользователь
--    регистрируется (username + пароль), этот токен становится
--    ключом аккаунта: войдя на другом устройстве, клиент получает тот
--    же токен и видит те же данные — так работает синхронизация.
-- ------------------------------------------------------------
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  device_token  TEXT    NOT NULL UNIQUE,   -- токен сессии/аккаунта
  display_name  TEXT,
  username      TEXT,                       -- логин (NULL у анонимных)
  password_hash TEXT,                       -- соль:хеш (scrypt)
  created_at    TEXT    DEFAULT (datetime('now'))
);

-- Логин уникален только среди зарегистрированных (у анонимных username = NULL)
CREATE UNIQUE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;

-- ------------------------------------------------------------
-- 3. Избранное (многие-ко-многим: пользователь ↔ растение)
-- ------------------------------------------------------------
DROP TABLE IF EXISTS favorites;
CREATE TABLE favorites (
  user_id  INTEGER NOT NULL,
  plant_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, plant_id),
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
);

-- ------------------------------------------------------------
-- 4. Личный список растений пользователя
--    plant_id — ссылка на карточку справочника.
-- ------------------------------------------------------------
DROP TABLE IF EXISTS my_plants;
CREATE TABLE my_plants (
  id                  INTEGER PRIMARY KEY,
  user_id             INTEGER NOT NULL,
  plant_id            INTEGER NOT NULL,
  custom_name         TEXT,
  date_added          TEXT    DEFAULT (date('now')),
  notes               TEXT,
  water_interval_days INTEGER NOT NULL DEFAULT 7,
  last_watered        TEXT,                 -- дата последнего полива (YYYY-MM-DD)
  next_transplant     TEXT,                 -- плановая дата пересадки
  reminders_on        INTEGER DEFAULT 1,    -- 0/1 (в MySQL можно BOOLEAN)
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
);

CREATE INDEX idx_myplants_user ON my_plants(user_id);
CREATE INDEX idx_favorites_user ON favorites(user_id);

-- ============================================================
--  ТАБЛИЦЫ ДЛЯ УСЛОЖНЕНИЙ (по желанию)
-- ============================================================

-- Обмен растениями: объявления
DROP TABLE IF EXISTS exchange_listings;
CREATE TABLE exchange_listings (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL,
  plant_id     INTEGER,               -- какое растение отдают (из справочника)
  title        TEXT    NOT NULL,
  description  TEXT,
  wants        TEXT,                  -- что хотят получить взамен
  status       TEXT    DEFAULT 'open',-- open / reserved / closed
  created_at   TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE,
  FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE SET NULL
);

-- Диалоги по объявлению: отдельный чат владельца с каждым откликнувшимся
DROP TABLE IF EXISTS exchange_conversations;
CREATE TABLE exchange_conversations (
  id           INTEGER PRIMARY KEY,
  listing_id   INTEGER NOT NULL,
  responder_id INTEGER NOT NULL,   -- откликнувшийся (не владелец объявления)
  created_at   TEXT DEFAULT (datetime('now')),
  UNIQUE (listing_id, responder_id),
  FOREIGN KEY (listing_id)   REFERENCES exchange_listings(id) ON DELETE CASCADE,
  FOREIGN KEY (responder_id) REFERENCES users(id)             ON DELETE CASCADE
);

-- Сообщения внутри диалога
DROP TABLE IF EXISTS exchange_messages;
CREATE TABLE exchange_messages (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL,
  user_id         INTEGER NOT NULL,      -- автор сообщения
  body            TEXT    NOT NULL,
  created_at      TEXT    DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES exchange_conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)         REFERENCES users(id)                  ON DELETE CASCADE
);

CREATE INDEX idx_listing_user ON exchange_listings(user_id);
CREATE INDEX idx_conv_listing ON exchange_conversations(listing_id);
CREATE INDEX idx_msg_conv      ON exchange_messages(conversation_id);

-- ============================================================
--  НАПОЛНЕНИЕ СПРАВОЧНИКА (те же 12 растений, что и в data.js)
-- ============================================================
INSERT INTO plants
  (id, name, latin, emoji, difficulty, water_interval_days, watering, lighting, transplant, toxicity, features)
VALUES
  (1, 'Монстера деликатесная', 'Monstera deliciosa', '🌿', 'Новичок', 7,
   'Летом раз в 5–7 дней, зимой раз в 10–14. Поливайте, когда просохнет верхний слой почвы на 2–3 см.',
   'Яркий рассеянный свет. Прямые солнечные лучи оставляют ожоги на листьях.',
   'Молодые растения — ежегодно весной, взрослые — раз в 2–3 года в горшок побольше.',
   'Ядовита для кошек и собак: сок содержит оксалаты кальция.',
   'Любит опрыскивание и влажный воздух. Дайте опору для воздушных корней.'),

  (2, 'Сансевиерия (щучий хвост)', 'Sansevieria trifasciata', '🌱', 'Новичок', 18,
   'Редко: раз в 2–3 недели, зимой ещё реже. Главный враг — перелив.',
   'Переносит и тень, и яркий свет. Растёт почти везде.',
   'Раз в 2–3 года, когда корни заполнят горшок.',
   'Слаботоксична при поедании — вызывает расстройство ЖКТ у животных.',
   'Очень неприхотлива, хороший выбор для новичков и тёмных комнат.'),

  (3, 'Спатифиллум (женское счастье)', 'Spathiphyllum', '🌸', 'Средне', 3,
   'Обильно, 2–3 раза в неделю. Любит стабильно влажную почву, но без застоя воды.',
   'Полутень и рассеянный свет. От прямого солнца листья бледнеют.',
   'Ежегодно весной, пока растёт активно.',
   'Ядовит: оксалаты кальция раздражают слизистые.',
   'Опускает листья при нехватке воды — это сигнал полить.'),

  (4, 'Замиокулькас (долларовое дерево)', 'Zamioculcas zamiifolia', '🪴', 'Новичок', 18,
   'Редко: раз в 2–3 недели. Запасает воду в клубнях, перелив губителен.',
   'Рассеянный свет, хорошо переносит полутень.',
   'Раз в 2–3 года — растёт медленно.',
   'Ядовит: сок раздражает кожу и слизистые.',
   'Идеален для занятых людей — прощает забывчивость в поливе.'),

  (5, 'Фикус Бенджамина', 'Ficus benjamina', '🌳', 'Средне', 5,
   'Раз в 4–7 дней, когда подсохнет верхний слой почвы.',
   'Яркий рассеянный свет. Любит постоянное место.',
   'Молодые — ежегодно, взрослые — раз в 2–3 года.',
   'Млечный сок токсичен и раздражает кожу.',
   'Не любит перестановок — от стресса может сбросить листья.'),

  (6, 'Орхидея Фаленопсис', 'Phalaenopsis', '🌺', 'Опытный', 8,
   'Погружением раз в 7–10 дней, когда корни станут серебристыми.',
   'Яркий рассеянный свет, восточные и западные окна.',
   'Раз в 2–3 года в прозрачный горшок и специальную кору.',
   'Не ядовита, безопасна для людей и животных.',
   'Любит влажность. Нельзя лить воду в центр розетки — загнивает.'),

  (7, 'Алоэ вера', 'Aloe vera', '🌵', 'Новичок', 14,
   'Раз в 2 недели, зимой раз в месяц. Обязателен хороший дренаж.',
   'Яркий свет, выносит прямое солнце.',
   'Раз в 2–3 года или когда появятся детки.',
   'Гель наружно безопасен, но при поедании вреден для животных.',
   'Суккулент: между поливами почва должна полностью просыхать.'),

  (8, 'Хлорофитум', 'Chlorophytum comosum', '🌿', 'Новичок', 4,
   'Раз в 3–5 дней, летом чаще. Не любит пересыхания.',
   'Рассеянный свет, теневынослив.',
   'Ежегодно — растёт быстро.',
   'Безопасен для людей и животных.',
   'Очищает воздух и даёт «детки», которые легко укоренить.'),

  (9, 'Драцена', 'Dracaena', '🎋', 'Средне', 6,
   'Раз в 5–7 дней. Между поливами верхний слой должен подсыхать.',
   'Яркий рассеянный свет.',
   'Раз в 2–3 года.',
   'Токсична для кошек и собак.',
   'Чувствительна к фтору в воде — поливайте отстоянной. Любит опрыскивание.'),

  (10, 'Кактус эхинопсис', 'Echinopsis', '🌵', 'Новичок', 12,
   'Летом раз в 1–2 недели, зимой почти не поливают.',
   'Максимум солнца — южные окна.',
   'Раз в 2–3 года в тесный горшок.',
   'Не ядовит, но острые колючки.',
   'Для цветения нужна прохладная и сухая зимовка.'),

  (11, 'Узамбарская фиалка', 'Saintpaulia', '🌸', 'Опытный', 4,
   'В поддон, раз в 3–5 дней, водой комнатной температуры.',
   'Яркий рассеянный свет без прямого солнца.',
   'Ежегодно в свежий рыхлый грунт.',
   'Не ядовита.',
   'Нельзя мочить листья и точку роста — появятся пятна и гниль.'),

  (12, 'Пеларгония (герань)', 'Pelargonium', '🌷', 'Средне', 3,
   'Раз в 3–4 дня, летом чаще. Под корень, не на листья.',
   'Яркий свет, любит солнце.',
   'Ежегодно весной.',
   'Слаботоксична для животных.',
   'Не любит опрыскивание. Для пышного куста нужна обрезка.');

-- Демонстрационный пользователь (можно удалить)
INSERT INTO users (id, device_token, display_name) VALUES (1, 'demo-device-token', 'Гость');