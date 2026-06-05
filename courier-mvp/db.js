const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
const DB_PATH = path.join(DB_DIR, 'courier.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('数据库连接失败:', err.message);
    process.exit(1);
  }
  console.log('已连接 SQLite 数据库:', DB_PATH);
});

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        db.run('PRAGMA foreign_keys = ON;');

        db.run(`CREATE TABLE IF NOT EXISTS courier (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ON_DUTY',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );`);

        db.run(`CREATE TABLE IF NOT EXISTS package (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tracking_no TEXT UNIQUE NOT NULL,
          sender_name TEXT,
          sender_phone TEXT,
          receiver_name TEXT NOT NULL,
          receiver_phone TEXT NOT NULL,
          receiver_address TEXT,
          weight REAL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'CREATED',
          courier_id INTEGER,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (courier_id) REFERENCES courier(id)
        );`);

        db.run(`CREATE TABLE IF NOT EXISTS exception_record (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          package_id INTEGER NOT NULL,
          courier_id INTEGER NOT NULL,
          exception_type TEXT NOT NULL,
          description TEXT,
          on_site_remark TEXT,
          status TEXT NOT NULL DEFAULT 'PENDING',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (package_id) REFERENCES package(id),
          FOREIGN KEY (courier_id) REFERENCES courier(id)
        );`);

        db.run(`CREATE TABLE IF NOT EXISTS delivery_receipt (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          package_id INTEGER NOT NULL UNIQUE,
          courier_id INTEGER NOT NULL,
          signer_name TEXT NOT NULL,
          sign_method TEXT NOT NULL,
          sign_time TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (package_id) REFERENCES package(id),
          FOREIGN KEY (courier_id) REFERENCES courier(id)
        );`);

        const courierCount = await getAsync('SELECT COUNT(*) as cnt FROM courier');
        if (courierCount.cnt === 0) {
          console.log('初始化种子数据...');

          await runAsync(`INSERT INTO courier (name, phone, status) VALUES ('张三', '13800001111', 'ON_DUTY')`);
          await runAsync(`INSERT INTO courier (name, phone, status) VALUES ('李四', '13800002222', 'ON_DUTY')`);
          await runAsync(`INSERT INTO courier (name, phone, status) VALUES ('王五', '13800003333', 'OFF_DUTY')`);

          await runAsync(`INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status) VALUES ('SF20240601000001', '发件人A', '13700001111', '客户甲', '13900001111', '北京市海淀区知春路1号', 1.50, 'CREATED')`);
          await runAsync(`INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status) VALUES ('SF20240601000002', '发件人B', '13700002222', '客户乙', '13900002222', '北京市朝阳区望京花园2号', 2.00, 'CREATED')`);
          await runAsync(`INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status, courier_id) VALUES ('SF20240601000003', '发件人C', '13700003333', '客户丙', '13900003333', '北京市海淀区五道口3号', 0.50, 'ASSIGNED', 1)`);
          await runAsync(`INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status, courier_id) VALUES ('SF20266010400001', '发件人D', '13700004444', '客户甲', '13900001111', '北京市海淀区知春路1号', 3.00, 'DELIVERING', 1)`);
          await runAsync(`INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status, courier_id) VALUES ('SF20266010400002', '发件人E', '13700005555', '客户乙', '13900002222', '北京市朝阳区望京花园2号', 1.20, 'DELIVERED', 2)`);

          console.log('种子数据初始化完成');
        } else {
          console.log('数据库已有数据，跳过种子数据初始化');
        }

        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

function closeDatabase() {
  db.close((err) => {
    if (err) console.error('关闭数据库失败:', err);
    else console.log('数据库连接已关闭');
    process.exit(0);
  });
}

module.exports = {
  db,
  runAsync,
  allAsync,
  getAsync,
  initDatabase,
  closeDatabase,
};
