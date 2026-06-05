const express = require('express');
const cors = require('cors');
const { initDatabase, closeDatabase } = require('./db');
const courierRoutes = require('./routes/courier');
const packageRoutes = require('./routes/package');
const exceptionRoutes = require('./routes/exception');
const deliveryReceiptRoutes = require('./routes/delivery_receipt');
const workstationRoutes = require('./routes/workstation');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.use('/api/couriers', courierRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/exceptions', exceptionRoutes);
app.use('/api/delivery-receipts', deliveryReceiptRoutes);
app.use('/api/workstation', workstationRoutes);

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
      'GET    /api/packages/:id': '查看包裹详情（含签收凭证）',
      'PUT    /api/packages/:id/assign': '把包裹分配给某个小哥 (body: {courier_id})',
      'POST   /api/packages/batch-assign': '批量分配包裹给某个小哥 (body: {package_ids: [1,2,3], courier_id})，每个包裹独立返回成功或失败原因',
      'PUT    /api/packages/:id/status': '更新包裹状态 (body: {status, courier_id?})，不可直接变更为 DELIVERED',
      'POST   /api/exceptions': '登记异常件 (body: {package_id, courier_id, exception_type, description?, on_site_remark?})',
      'GET    /api/exceptions': '查询异常件列表 (?status=xxx&courier_id=xxx&package_id=xxx)',
      'GET    /api/exceptions/:id': '查看异常件详情',
      'PUT    /api/exceptions/:id/status': '更新异常件状态 (body: {status})',
      'POST   /api/delivery-receipts': '提交签收凭证，包裹自动变为 DELIVERED (body: {package_id, courier_id, signer_name, sign_method, sign_time})',
      'GET    /api/delivery-receipts': '查询签收凭证列表 (?courier_id=xxx&package_id=xxx)',
      'GET    /api/delivery-receipts/:id': '查看签收凭证详情',
      'GET    /api/workstation/:courierId/dashboard': '快递小哥工作台总览（今日统计+待处理包裹）',
      'GET    /api/workstation/:courierId/stats': '快递小哥今日包裹统计',
      'GET    /api/workstation/:courierId/pending-packages': '快递小哥今日待处理包裹列表',
    },
    packageStatusFlow: 'CREATED → ASSIGNED → PICKED_UP → DELIVERING → DELIVERED/FAILED',
    packageStatuses: ['CREATED', 'ASSIGNED', 'PICKED_UP', 'DELIVERING', 'DELIVERED', 'FAILED'],
    courierStatuses: ['ON_DUTY', 'OFF_DUTY'],
    exceptionTypes: ['REFUSED', 'NOT_HOME', 'ADDRESS_WRONG', 'DAMAGED', 'CONTACT_FAILED', 'OTHER'],
    exceptionStatusFlow: 'PENDING → PROCESSING → RESOLVED / CLOSED',
    exceptionStatuses: ['PENDING', 'PROCESSING', 'RESOLVED', 'CLOSED'],
    signMethods: ['PERSONAL_SIGN', 'AGENT_SIGN', 'CODE_SIGN', 'SMART_CABINET'],
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
