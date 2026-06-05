const express = require('express');
const cors = require('cors');
const { initDatabase, closeDatabase } = require('./db');
const courierRoutes = require('./routes/courier');
const packageRoutes = require('./routes/package');
const exceptionRoutes = require('./routes/exception');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.use('/api/couriers', courierRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/exceptions', exceptionRoutes);

app.get('/', (req, res) => {
  res.json({
    name: '快递小哥派送系统 MVP',
    version: '2.0.0',
    endpoints: {
      'POST   /api/couriers': '新增快递小哥',
      'GET    /api/couriers': '查询全部快递小哥',
      'GET    /api/couriers/:id/packages': '查询某个小哥的待派送包裹',
      'POST   /api/packages': '新增包裹',
      'GET    /api/packages': '查看全部包裹列表 (?status=xxx&courier_id=xxx)',
      'GET    /api/packages/:id': '查看包裹详情',
      'PUT    /api/packages/:id/assign': '把包裹分配给某个小哥 (body: {courier_id})',
      'PUT    /api/packages/:id/status': '更新包裹状态 (body: {status, courier_id?})',
      'POST   /api/exceptions': '登记异常件 (body: {package_id, courier_id, exception_type, description?, on_site_remark?})',
      'GET    /api/exceptions': '查询异常件列表 (?status=xxx&courier_id=xxx&package_id=xxx)',
      'GET    /api/exceptions/:id': '查看异常件详情',
      'PUT    /api/exceptions/:id/status': '更新异常件状态 (body: {status})',
    },
    packageStatusFlow: 'CREATED → ASSIGNED → PICKED_UP → DELIVERING → DELIVERED/FAILED',
    packageStatuses: ['CREATED', 'ASSIGNED', 'PICKED_UP', 'DELIVERING', 'DELIVERED', 'FAILED'],
    courierStatuses: ['ON_DUTY', 'OFF_DUTY'],
    exceptionTypes: ['REFUSED', 'NOT_HOME', 'ADDRESS_WRONG', 'DAMAGED', 'CONTACT_FAILED', 'OTHER'],
    exceptionStatusFlow: 'PENDING → PROCESSING → RESOLVED / CLOSED',
    exceptionStatuses: ['PENDING', 'PROCESSING', 'RESOLVED', 'CLOSED'],
  });
});

initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n========================================`);
      console.log(`  快递小哥派送系统 MVP 已启动`);
      console.log(`  地址: http://localhost:${PORT}`);
      console.log(`  接口文档: http://localhost:${PORT}/`);
      console.log(`========================================\n`);
    });
  })
  .catch((err) => {
    console.error('数据库初始化失败:', err);
    process.exit(1);
  });

process.on('SIGINT', closeDatabase);
