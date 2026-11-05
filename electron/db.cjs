const fs = require('fs');
const initSqlJs = require('sql.js');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('cashier','manager','admin')),
  salt TEXT NOT NULL, hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  price REAL NOT NULL, cost REAL NOT NULL DEFAULT 0, stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS customers(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT DEFAULT '',
  credit_limit REAL NOT NULL DEFAULT 0, credit_days INTEGER NOT NULL DEFAULT 15,
  balance REAL NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sales(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, customer_id INTEGER,
  subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'done', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sale_items(
  id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
  name TEXT NOT NULL, qty REAL NOT NULL, price REAL NOT NULL);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, customer_id INTEGER,
  method TEXT NOT NULL CHECK(method IN ('cash','card','transfer','credit')),
  kind TEXT NOT NULL CHECK(kind IN ('sale','abono')),
  amount REAL NOT NULL, user_id INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_entries(
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, sale_id INTEGER,
  amount REAL NOT NULL, note TEXT DEFAULT '', due_date TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stock_movements(
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, qty REAL NOT NULL,
  type TEXT NOT NULL, note TEXT DEFAULT '', user_id INTEGER, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS loans(
  id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, customer_id INTEGER NOT NULL,
  qty REAL NOT NULL, returned_qty REAL NOT NULL DEFAULT 0, due_date TEXT, note TEXT DEFAULT '',
  user_id INTEGER NOT NULL, created_at TEXT NOT NULL, returned_at TEXT);
`;

// Thin wrapper over sql.js that persists the database file after every write.
async function openDb(file) {
  const SQL = await initSqlJs();
  const raw = file && fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  raw.run(SCHEMA);
  let inTx = 0;
  const persist = () => {
    if (file && !inTx) fs.writeFileSync(file, Buffer.from(raw.export()));
  };
  const db = {
    all(sql, params = []) {
      const st = raw.prepare(sql);
      st.bind(params);
      const rows = [];
      while (st.step()) rows.push(st.getAsObject());
      st.free();
      return rows;
    },
    get(sql, params = []) {
      return db.all(sql, params)[0];
    },
    run(sql, params = []) {
      raw.run(sql, params);
      const id = raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
      persist();
      return id;
    },
    tx(fn) {
      raw.run('BEGIN');
      inTx++;
      try {
        const r = fn();
        raw.run('COMMIT');
        inTx--;
        persist();
        return r;
      } catch (e) {
        inTx--;
        raw.run('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}

module.exports = { openDb };
