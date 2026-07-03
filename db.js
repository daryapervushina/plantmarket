/* ============================================================
   db.js — подключение к SQLite через ВСТРОЕННЫЙ модуль node:sqlite.
   Работает на Node 22.5+ и 24 без установки и компиляции пакетов.

   Путь к файлу базы можно задать переменной окружения DATA_DIR —
   это нужно для Render: там файловая система эфемерна, и чтобы
   данные не пропадали, базу кладут на постоянный диск (Persistent
   Disk), примонтированный, например, в /var/data.
   ============================================================ */

const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite"); // встроено в Node, ставить не нужно

// Куда класть файл базы. Локально — рядом с кодом; на Render — на диск.
const dataDir = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "plants.db");
const isNew = !fs.existsSync(dbPath);

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON");

// При первом запуске (файла ещё нет) создаём таблицы и наполняем справочник
if (isNew) {
  const schemaPath = path.join(__dirname, "schema.sql");
  if (!fs.existsSync(schemaPath)) {
    console.error("Файл схемы schema.sql не найден рядом с db.js!");
  } else {
    const schema = fs.readFileSync(schemaPath, "utf-8");
    db.exec(schema);
    console.log("База данных создана и наполнена справочником:", dbPath);
  }
}

// Мягкая миграция: если база создана старой версией — добавим новые поля.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`Миграция: добавлен столбец ${table}.${column}`);
  }
}
ensureColumn("users", "username", "TEXT");
ensureColumn("users", "password_hash", "TEXT");
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL"
);

// Найти пользователя по токену устройства или создать нового
function getOrCreateUser(deviceToken) {
  if (!deviceToken) deviceToken = "anonymous";

  let user = db
    .prepare("SELECT * FROM users WHERE device_token = ?")
    .get(deviceToken);

  if (!user) {
    const info = db
      .prepare("INSERT INTO users (device_token, display_name) VALUES (?, ?)")
      .run(deviceToken, "Гость");
    user = { id: Number(info.lastInsertRowid), device_token: deviceToken, display_name: "Гость" };
  }
  return user;
}

module.exports = { db, getOrCreateUser };