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

function beginTransaction() {
  return new Promise((resolve, reject) => {
    db.run('BEGIN TRANSACTION', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function commitTransaction() {
  return new Promise((resolve, reject) => {
    db.run('COMMIT', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function rollbackTransaction() {
  return new Promise((resolve, reject) => {
    db.run('ROLLBACK', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function runInTransaction(callback) {
  try {
    await beginTransaction();
    const result = await callback();
    await commitTransaction();
    return result;
  } catch (err) {
    await rollbackTransaction();
    throw err;
  }
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
          site_id INTEGER,
          zone_id INTEGER,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (courier_id) REFERENCES courier(id),
          FOREIGN KEY (site_id) REFERENCES site(id),
          FOREIGN KEY (zone_id) REFERENCES delivery_zone(id)
        );`);

        const pragmaResult = await allAsync("PRAGMA table_info('package')");
        const packageColumns = pragmaResult.map(col => col.name);
        if (!packageColumns.includes('site_id')) {
          await runAsync("ALTER TABLE package ADD COLUMN site_id INTEGER");
        }
        if (!packageColumns.includes('zone_id')) {
          await runAsync("ALTER TABLE package ADD COLUMN zone_id INTEGER");
        }
        if (!packageColumns.includes('is_cod')) {
          await runAsync("ALTER TABLE package ADD COLUMN is_cod INTEGER NOT NULL DEFAULT 0");
        }
        if (!packageColumns.includes('cod_amount')) {
          await runAsync("ALTER TABLE package ADD COLUMN cod_amount REAL NOT NULL DEFAULT 0");
        }

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

        db.run(`CREATE TABLE IF NOT EXISTS site (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          address TEXT,
          phone TEXT,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );`);

        db.run(`CREATE TABLE IF NOT EXISTS delivery_zone (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          site_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (site_id) REFERENCES site(id),
          UNIQUE(site_id, name)
        );`);

        db.run(`CREATE TABLE IF NOT EXISTS courier_zone (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          courier_id INTEGER NOT NULL,
          zone_id INTEGER NOT NULL,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (courier_id) REFERENCES courier(id),
          FOREIGN KEY (zone_id) REFERENCES delivery_zone(id),
          UNIQUE(courier_id, zone_id)
        );`);

        db.run(`CREATE TABLE IF NOT EXISTS package_track (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          package_id INTEGER NOT NULL,
          old_status TEXT,
          new_status TEXT NOT NULL,
          operator_type TEXT NOT NULL,
          operator_id INTEGER,
          operator_name TEXT,
          remark TEXT,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (package_id) REFERENCES package(id)
        );`);

        db.run(`CREATE TABLE IF NOT EXISTS delivery_appointment (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          package_id INTEGER NOT NULL UNIQUE,
          appointment_start TEXT NOT NULL,
          appointment_end TEXT NOT NULL,
          delivery_preference TEXT,
          remark TEXT,
          status TEXT NOT NULL DEFAULT 'ACTIVE',
          creator_type TEXT NOT NULL,
          creator_id INTEGER,
          creator_name TEXT,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (package_id) REFERENCES package(id)
        );`);

        db.run(`CREATE TABLE IF NOT EXISTS delivery_appointment_change_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          appointment_id INTEGER NOT NULL,
          package_id INTEGER NOT NULL,
          old_values TEXT,
          new_values TEXT NOT NULL,
          change_type TEXT NOT NULL,
          operator_type TEXT NOT NULL,
          operator_id INTEGER,
          operator_name TEXT,
          change_reason TEXT,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (appointment_id) REFERENCES delivery_appointment(id),
          FOREIGN KEY (package_id) REFERENCES package(id)
        );`);

        db.run(`CREATE TABLE IF NOT EXISTS cod_payment (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          package_id INTEGER NOT NULL UNIQUE,
          courier_id INTEGER NOT NULL,
          payment_method TEXT NOT NULL,
          amount REAL NOT NULL,
          waived_reason TEXT,
          operator_type TEXT NOT NULL,
          operator_id INTEGER,
          operator_name TEXT,
          remark TEXT,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (package_id) REFERENCES package(id),
          FOREIGN KEY (courier_id) REFERENCES courier(id)
        );`);

        db.run(`CREATE TABLE IF NOT EXISTS cod_daily_settlement (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          settlement_date TEXT NOT NULL,
          courier_id INTEGER NOT NULL,
          site_id INTEGER,
          total_cod_packages INTEGER NOT NULL DEFAULT 0,
          total_cod_amount REAL NOT NULL DEFAULT 0,
          cash_amount REAL NOT NULL DEFAULT 0,
          scan_amount REAL NOT NULL DEFAULT 0,
          waived_amount REAL NOT NULL DEFAULT 0,
          settled_packages INTEGER NOT NULL DEFAULT 0,
          unsettled_packages INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'PENDING',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (courier_id) REFERENCES courier(id),
          FOREIGN KEY (site_id) REFERENCES site(id),
          UNIQUE(settlement_date, courier_id)
        );`);

        const courierCount = await getAsync('SELECT COUNT(*) as cnt FROM courier');
        if (courierCount.cnt === 0) {
          console.log('初始化种子数据...');

          await runAsync(`INSERT INTO courier (name, phone, status) VALUES ('张三', '13800001111', 'ON_DUTY')`);
          await runAsync(`INSERT INTO courier (name, phone, status) VALUES ('李四', '13800002222', 'ON_DUTY')`);
          await runAsync(`INSERT INTO courier (name, phone, status) VALUES ('王五', '13800003333', 'OFF_DUTY')`);

          await runAsync(`INSERT INTO site (name, address, phone) VALUES ('中关村站点', '北京市海淀区中关村大街1号', '010-88888801')`);
          await runAsync(`INSERT INTO site (name, address, phone) VALUES ('望京站点', '北京市朝阳区望京SOHO', '010-88888802')`);

          await runAsync(`INSERT INTO delivery_zone (site_id, name, description) VALUES (1, '海淀区-知春路片区', '知春路、五道口周边区域')`);
          await runAsync(`INSERT INTO delivery_zone (site_id, name, description) VALUES (1, '海淀区-中关村片区', '中关村、苏州街周边区域')`);
          await runAsync(`INSERT INTO delivery_zone (site_id, name, description) VALUES (2, '朝阳区-望京片区', '望京、酒仙桥周边区域')`);
          await runAsync(`INSERT INTO delivery_zone (site_id, name, description) VALUES (2, '朝阳区-国贸片区', '国贸、CBD周边区域')`);

          await runAsync(`INSERT INTO courier_zone (courier_id, zone_id) VALUES (1, 1)`);
          await runAsync(`INSERT INTO courier_zone (courier_id, zone_id) VALUES (1, 2)`);
          await runAsync(`INSERT INTO courier_zone (courier_id, zone_id) VALUES (2, 3)`);
          await runAsync(`INSERT INTO courier_zone (courier_id, zone_id) VALUES (2, 4)`);
          await runAsync(`INSERT INTO courier_zone (courier_id, zone_id) VALUES (3, 1)`);

          await runAsync(`INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status, site_id, zone_id) VALUES ('SF20240601000001', '发件人A', '13700001111', '客户甲', '13900001111', '北京市海淀区知春路1号', 1.50, 'CREATED', 1, 1)`);
          await runAsync(`INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status, site_id, zone_id) VALUES ('SF20240601000002', '发件人B', '13700002222', '客户乙', '13900002222', '北京市朝阳区望京花园2号', 2.00, 'CREATED', 2, 3)`);
          await runAsync(`INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status, courier_id, site_id, zone_id) VALUES ('SF20240601000003', '发件人C', '13700003333', '客户丙', '13900003333', '北京市海淀区五道口3号', 0.50, 'ASSIGNED', 1, 1, 1)`);
          await runAsync(`INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status, courier_id, site_id, zone_id) VALUES ('SF20266010400001', '发件人D', '13700004444', '客户甲', '13900001111', '北京市海淀区知春路1号', 3.00, 'DELIVERING', 1, 1, 1)`);
          await runAsync(`INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status, courier_id, site_id, zone_id) VALUES ('SF20266010400002', '发件人E', '13700005555', '客户乙', '13900002222', '北京市朝阳区望京花园2号', 1.20, 'DELIVERED', 2, 2, 3)`);

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
  beginTransaction,
  commitTransaction,
  rollbackTransaction,
  runInTransaction,
  initDatabase,
  closeDatabase,
};
