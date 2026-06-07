const path = require('path');
const fs = require('fs');

const TEST_DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'courier.test.db');

function teardownTestDatabase() {
  console.log(`\n🧹 清理测试数据库: ${TEST_DB_PATH}`);

  if (fs.existsSync(TEST_DB_PATH)) {
    try {
      fs.unlinkSync(TEST_DB_PATH);
      console.log('✅ 测试数据库已清理');
    } catch (err) {
      console.error('❌ 清理测试数据库失败:', err.message);
      process.exit(1);
    }
  } else {
    console.log('ℹ️  测试数据库不存在，跳过清理');
  }

  process.exit(0);
}

teardownTestDatabase();
