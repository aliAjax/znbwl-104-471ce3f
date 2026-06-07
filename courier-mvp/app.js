const express = require('express');
const cors = require('cors');
const { initDatabase, closeDatabase } = require('./db');
const courierRoutes = require('./routes/courier');
const packageRoutes = require('./routes/package');
const exceptionRoutes = require('./routes/exception');
const deliveryReceiptRoutes = require('./routes/delivery_receipt');
const workstationRoutes = require('./routes/workstation');
const zoneRoutes = require('./routes/zone');
const deliveryAppointmentRoutes = require('./routes/delivery_appointment');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.use('/api/couriers', courierRoutes);
app.use('/api/packages', packageRoutes);
app.use('/api/exceptions', exceptionRoutes);
app.use('/api/delivery-receipts', deliveryReceiptRoutes);
app.use('/api/workstation', workstationRoutes);
app.use('/api', zoneRoutes);
app.use('/api/delivery-appointments', deliveryAppointmentRoutes);

app.get('/', (req, res) => {
  res.json({
    name: '快递小哥派送系统 MVP',
    version: '2.0.0',
    endpoints: {
      'POST   /api/couriers': '新增快递小哥',
      'GET    /api/couriers': '查询全部快递小哥',
      'GET    /api/couriers/:id/packages': '查询某个小哥的待派送包裹',
      'POST   /api/packages': '新增包裹 (body: {tracking_no?, sender_name?, sender_phone?, receiver_name, receiver_phone, receiver_address?, weight?, site_id?, zone_id?})',
      'GET    /api/packages': '查看全部包裹列表 (?status=xxx&courier_id=xxx&site_id=xxx&zone_id=xxx&tracking_no=xxx&receiver_phone=xxx&receiver_address=xxx)',
      'GET    /api/packages/:id': '查看包裹详情（含签收凭证、站点、区域信息）',
      'PUT    /api/packages/:id/assign': '把包裹分配给某个小哥 (body: {courier_id})，只能分配给负责同一区域且在岗的小哥',
      'POST   /api/packages/batch-assign': '批量分配包裹给某个小哥 (body: {package_ids: [1,2,3], courier_id})，每个包裹独立返回成功或失败原因',
      'POST   /api/packages/dispatch/preview': '智能分派预览 (body: {package_ids: [1,2,3]})，按站点、区域、小哥在岗状态和负载生成推荐方案，仅返回预览结果不真正分配',
      'POST   /api/packages/dispatch/confirm': '确认智能分派 (body: {package_ids: [1,2,3], operator_name?: "运营人员"})，批量落库并写入 package_track',
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
      'PUT    /api/workstation/:courierId/status': '更新快递小哥上下班状态 (body: {status: ON_DUTY|OFF_DUTY})，名下有未完成包裹时不可切换为OFF_DUTY',
      'POST   /api/sites': '新增站点 (body: {name, address?, phone?})',
      'GET    /api/sites': '查询全部站点列表',
      'GET    /api/sites/:id': '查看站点详情',
      'PUT    /api/sites/:id': '更新站点信息 (body: {name?, address?, phone?})',
      'DELETE /api/sites/:id': '删除站点',
      'POST   /api/zones': '新增配送区域 (body: {site_id, name, description?})',
      'GET    /api/zones': '查询全部配送区域列表 (?site_id=xxx)',
      'GET    /api/zones/:id': '查看配送区域详情',
      'PUT    /api/zones/:id': '更新配送区域 (body: {name?, description?})',
      'DELETE /api/zones/:id': '删除配送区域',
      'GET    /api/zones/:id/available-couriers': '查询该区域可分配的在岗快递小哥',
      'POST   /api/courier-zones': '为快递小哥分配负责区域 (body: {courier_id, zone_id})',
      'DELETE /api/courier-zones': '移除快递小哥的负责区域 (body: {courier_id, zone_id})',
      'GET    /api/couriers/:id/zones': '查询快递小哥负责的所有区域',
      'GET    /api/zones/:id/couriers': '查询负责该区域的所有快递小哥',
      'POST   /api/delivery-appointments': '创建派送预约 (body: {package_id, appointment_start, appointment_end, delivery_preference?, remark?, operator_type, operator_id?, operator_name?, change_reason?})',
      'PUT    /api/delivery-appointments/:packageId': '修改派送预约 (body: {appointment_start?, appointment_end?, delivery_preference?, remark?, operator_type, operator_id?, operator_name?, change_reason?})',
      'PUT    /api/delivery-appointments/:packageId/cancel': '取消派送预约 (body: {operator_type, operator_id?, operator_name?, change_reason?})',
      'GET    /api/delivery-appointments/package/:packageId': '查询包裹的当前预约信息',
      'GET    /api/delivery-appointments/package/:packageId/change-logs': '查询包裹的预约变更历史记录',
      'GET    /api/delivery-appointments/meta': '查询预约相关的枚举元数据',
      'GET    /api/workstation/:courierId/dashboard?appointment_filter=today|overdue|upcoming|no_appointment': '快递小哥工作台总览，支持按预约状态筛选',
      'GET    /api/workstation/:courierId/pending-packages?appointment_filter=today|overdue|upcoming|no_appointment': '快递小哥待处理包裹列表，支持按预约状态筛选，有预约的优先按预约时间排序',
    },
    packageStatusFlow: 'CREATED → ASSIGNED → PICKED_UP → DELIVERING → DELIVERED/FAILED',
    packageStatuses: ['CREATED', 'ASSIGNED', 'PICKED_UP', 'DELIVERING', 'DELIVERED', 'FAILED'],
    courierStatuses: ['ON_DUTY', 'OFF_DUTY'],
    exceptionTypes: ['REFUSED', 'NOT_HOME', 'ADDRESS_WRONG', 'DAMAGED', 'CONTACT_FAILED', 'OTHER'],
    exceptionStatusFlow: 'PENDING → PROCESSING → RESOLVED / CLOSED',
    exceptionStatuses: ['PENDING', 'PROCESSING', 'RESOLVED', 'CLOSED'],
    signMethods: ['PERSONAL_SIGN', 'AGENT_SIGN', 'CODE_SIGN', 'SMART_CABINET'],
    appointmentStatuses: ['ACTIVE', 'CANCELLED', 'COMPLETED'],
    appointmentOperatorTypes: ['RECEIVER', 'COURIER', 'ADMIN', 'SYSTEM'],
    appointmentChangeTypes: ['CREATE', 'UPDATE', 'CANCEL'],
    deliveryPreferences: ['PERSONAL_SIGN', 'AGENT_SIGN', 'SMART_CABINET', 'DOORSTEP', 'OTHER'],
    appointmentFilterTypes: ['today', 'overdue', 'upcoming', 'no_appointment'],
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
