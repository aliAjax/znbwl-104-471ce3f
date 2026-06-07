const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'courier.test.db');

async function setupTestDatabase() {
  console.log(`\n🧪 初始化测试数据库: ${TEST_DB_PATH}`);

  if (fs.existsSync(TEST_DB_PATH)) {
    console.log('  清理旧的测试数据库...');
    fs.unlinkSync(TEST_DB_PATH);
  }

  process.env.DB_PATH = TEST_DB_PATH;

  const { initDatabase, closeDatabase } = require('../db');

  try {
    await initDatabase();
    console.log('✅ 测试数据库初始化完成');
    await closeDatabase();
    process.exit(0);
  } catch (err) {
    console.error('❌ 测试数据库初始化失败:', err.message);
    process.exit(1);
  }
}

setupTestDatabase();
