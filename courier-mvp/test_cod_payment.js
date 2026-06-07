const http = require('http');
const { runAsync, allAsync, getAsync } = require('./db');

const BASE_URL = process.env.BASE_URL || 'localhost';
const PORT = process.env.PORT || 3000;
const TEST_TRACKING_PREFIX = 'COD-TEST-';

let passedCount = 0;
let failedCount = 0;
const testResults = [];

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: body });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function generateTrackingNo(prefix) {
  const now = new Date();
  const ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  return `${TEST_TRACKING_PREFIX}${prefix}-${ts}-${rand}`;
}

function assert(condition, message) {
  if (condition) {
    passedCount++;
    console.log(`  ✅ ${message}`);
    testResults.push({ pass: true, message });
  } else {
    failedCount++;
    console.log(`  ❌ ${message}`);
    testResults.push({ pass: false, message });
  }
  return condition;
}

async function cleanupTestDataByIds(packageIds) {
  if (!packageIds || packageIds.length === 0) return;
  try {
    const placeholders = packageIds.map(() => '?').join(',');
    await runAsync(`DELETE FROM package_track WHERE package_id IN (${placeholders})`, packageIds);
    await runAsync(`DELETE FROM cod_payment WHERE package_id IN (${placeholders})`, packageIds);
    await runAsync(`DELETE FROM delivery_appointment WHERE package_id IN (${placeholders})`, packageIds);
    await runAsync(`DELETE FROM delivery_receipt WHERE package_id IN (${placeholders})`, packageIds);
    await runAsync(`DELETE FROM exception_record WHERE package_id IN (${placeholders})`, packageIds);
    await runAsync(`DELETE FROM package WHERE id IN (${placeholders})`, packageIds);
  } catch (err) {
    console.error(`    清理测试数据失败: ${err.message}`);
  }
}

async function cleanupAllTestData() {
  try {
    console.log('\n🧹 开始全局清理测试数据...');
    const testPackages = await allAsync(
      "SELECT id FROM package WHERE tracking_no LIKE ?",
      [`${TEST_TRACKING_PREFIX}%`]
    );
    const packageIds = testPackages.map(p => p.id);
    if (packageIds.length > 0) {
      await cleanupTestDataByIds(packageIds);
      console.log(`  已清理 ${packageIds.length} 个测试包裹及相关数据`);
    }
    console.log('✅ 全局测试数据清理完成');
  } catch (err) {
    console.error('❌ 全局清理测试数据失败:', err.message);
  }
}

async function createTestPackage(options = {}) {
  const {
    is_cod = false,
    cod_amount = 0,
    status = 'CREATED',
    courier_id = null,
    site_id = 1,
    zone_id = 1,
  } = options;

  const pkg = await makeRequest('POST', '/api/packages', {
    tracking_no: generateTrackingNo('PKG'),
    receiver_name: 'COD测试用户',
    receiver_phone: '13900008888',
    receiver_address: '北京市海淀区测试地址',
    site_id,
    zone_id,
    is_cod,
    cod_amount,
  });

  const packageId = pkg.body.data.id;

  if (courier_id && status !== 'CREATED') {
    await makeRequest('PUT', `/api/packages/${packageId}/assign`, { courier_id });
    if (status === 'ASSIGNED') {
    } else if (status === 'PICKED_UP' || status === 'DELIVERING') {
      await makeRequest('PUT', `/api/packages/${packageId}/status`, { status: 'PICKED_UP', courier_id });
      if (status === 'DELIVERING') {
        await makeRequest('PUT', `/api/packages/${packageId}/status`, { status: 'DELIVERING', courier_id });
      }
    }
  }

  const updatedPkg = await makeRequest('GET', `/api/packages/${packageId}`);
  return updatedPkg.body.data;
}

async function runTestScenario(name, testFn) {
  const scenarioPackageIds = [];
  console.log(`\n📋 测试场景: ${name}`);
  console.log('-'.repeat(60));

  try {
    const wrappedCreateTestPackage = async (options) => {
      const pkg = await createTestPackage(options);
      scenarioPackageIds.push(pkg.id);
      return pkg;
    };

    await testFn(wrappedCreateTestPackage, assert);
  } catch (err) {
    failedCount++;
    console.log(`  💥 场景执行异常: ${err.message}`);
    testResults.push({ pass: false, message: `${name} - 异常: ${err.message}` });
    console.error(err.stack);
  } finally {
    if (scenarioPackageIds.length > 0) {
      console.log(`  🧹 清理场景数据 (${scenarioPackageIds.length} 个包裹)`);
      await cleanupTestDataByIds(scenarioPackageIds);
    }
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('COD 到付收款回归测试');
  console.log('='.repeat(60));

  let activeCourierId, testSiteId, testZoneId;

  try {
    await cleanupAllTestData();

    console.log('\n🔧 准备测试环境');
    console.log('-'.repeat(60));

    const couriers = await allAsync('SELECT id, name, status FROM courier');
    console.log('当前快递小哥状态:');
    couriers.forEach(c => console.log(`  ID:${c.id} ${c.name} - ${c.status}`));

    const courierZones = await allAsync(`
      SELECT cz.courier_id, c.name as courier_name, cz.zone_id, dz.name as zone_name, dz.site_id, s.name as site_name
      FROM courier_zone cz
      LEFT JOIN courier c ON cz.courier_id = c.id
      LEFT JOIN delivery_zone dz ON cz.zone_id = dz.id
      LEFT JOIN site s ON dz.site_id = s.id
      ORDER BY cz.courier_id
    `);
    console.log('小哥负责区域:');
    courierZones.forEach(cz => console.log(`  小哥${cz.courier_id}(${cz.courier_name}): 站点${cz.site_id}(${cz.site_name}) - 区域${cz.zone_id}(${cz.zone_name})`));

    let onDutyCourier = couriers.find(c => c.status === 'ON_DUTY');
    let testCourierId = onDutyCourier ? onDutyCourier.id : 1;

    if (!onDutyCourier) {
      console.log(`  将小哥 ${testCourierId} 设置为在岗状态...`);
      await runAsync('UPDATE courier SET status = ? WHERE id = ?', ['ON_DUTY', testCourierId]);
      onDutyCourier = await getAsync('SELECT * FROM courier WHERE id = ?', [testCourierId]);
    }

    activeCourierId = testCourierId;
    const activeCourierZones = courierZones.filter(cz => cz.courier_id === activeCourierId);
    const testZone = activeCourierZones[0];
    testSiteId = testZone ? testZone.site_id : 1;
    testZoneId = testZone ? testZone.zone_id : 1;

    console.log(`  使用测试小哥 ID: ${activeCourierId}`);
    console.log(`  使用测试站点 ID: ${testSiteId}, 区域 ID: ${testZoneId}`);

    const testContext = { courierId: activeCourierId, siteId: testSiteId, zoneId: testZoneId };

    await runTestScenario('1. 非到付包裹不能收款', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: false,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建非到付包裹 ID: ${pkg.id}, is_cod: ${pkg.is_cod}`);

      const result = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'CASH',
        amount: 100,
        operator_name: '测试员',
      });

      assert(result.statusCode === 400, `状态码应为 400，实际为 ${result.statusCode}`);
      assert(
        result.body.message && result.body.message.includes('不是到付包裹'),
        `错误信息应包含'不是到付包裹'，实际为: ${result.body.message}`
      );
    });

    await runTestScenario('2. 金额不一致不能收款', async (createPkg, assert) => {
      const expectedAmount = 99.50;
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: expectedAmount,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建到付包裹 ID: ${pkg.id}, 应收金额: ${pkg.cod_amount}`);

      const result = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'CASH',
        amount: 88.00,
        operator_name: '测试员',
      });

      assert(result.statusCode === 400, `状态码应为 400，实际为 ${result.statusCode}`);
      assert(
        result.body.message && result.body.message.includes('金额不符'),
        `错误信息应包含'金额不符'，实际为: ${result.body.message}`
      );
    });

    await runTestScenario('3. WAIVED 必须填写免收原因', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: 50.00,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建到付包裹 ID: ${pkg.id}, 应收金额: ${pkg.cod_amount}`);

      const resultNoReason = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'WAIVED',
        operator_name: '测试员',
      });
      assert(resultNoReason.statusCode === 400, `WAIVED 不填原因状态码应为 400，实际为 ${resultNoReason.statusCode}`);
      assert(
        resultNoReason.body.message && resultNoReason.body.message.includes('免收原因'),
        `错误信息应包含'免收原因'，实际为: ${resultNoReason.body.message}`
      );

      const resultWithReason = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'WAIVED',
        waived_reason: '客户是VIP，免收到付款',
        operator_name: '测试员',
      });
      assert(resultWithReason.statusCode === 201, `WAIVED 填原因状态码应为 201，实际为 ${resultWithReason.statusCode}`);
      assert(
        resultWithReason.body.data && resultWithReason.body.data.waived_reason === '客户是VIP，免收到付款',
        `免收原因应正确保存，实际为: ${resultWithReason.body.data?.waived_reason}`
      );
    });

    await runTestScenario('4. 同一包裹不能重复收款', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: 120.00,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建到付包裹 ID: ${pkg.id}, 应收金额: ${pkg.cod_amount}`);

      const firstResult = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'SCAN',
        amount: 120.00,
        operator_name: '测试员',
      });
      assert(firstResult.statusCode === 201, `第一次收款状态码应为 201，实际为 ${firstResult.statusCode}`);

      const secondResult = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'CASH',
        amount: 120.00,
        operator_name: '测试员',
      });
      assert(secondResult.statusCode === 400, `重复收款状态码应为 400，实际为 ${secondResult.statusCode}`);
      assert(
        secondResult.body.message && secondResult.body.message.includes('重复收款'),
        `错误信息应包含'重复收款'，实际为: ${secondResult.body.message}`
      );
    });

    await runTestScenario('5. CREATED 状态包裹不能收款', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: 100.00,
        status: 'CREATED',
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建 CREATED 状态到付包裹 ID: ${pkg.id}, 当前状态: ${pkg.status}`);

      const result = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'CASH',
        amount: 100.00,
        operator_name: '测试员',
      });

      assert(result.statusCode === 400, `CREATED 状态收款状态码应为 400，实际为 ${result.statusCode}`);
      assert(
        result.body.message && (
          result.body.message.includes('尚未开始派送') ||
          result.body.message.includes('尚未分配') ||
          result.body.message.includes('无法收款')
        ),
        `错误信息应说明不能收款原因，实际为: ${result.body.message}`
      );
    });

    await runTestScenario('6. ASSIGNED 状态包裹不能收款', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: 100.00,
        status: 'ASSIGNED',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建 ASSIGNED 状态到付包裹 ID: ${pkg.id}, 当前状态: ${pkg.status}`);

      const result = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'CASH',
        amount: 100.00,
        operator_name: '测试员',
      });

      assert(result.statusCode === 400, `ASSIGNED 状态收款状态码应为 400，实际为 ${result.statusCode}`);
      assert(
        result.body.message && result.body.message.includes('尚未开始派送'),
        `错误信息应包含'尚未开始派送'，实际为: ${result.body.message}`
      );
    });

    await runTestScenario('7. PICKED_UP 状态包裹可以收款', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: 88.00,
        status: 'PICKED_UP',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建 PICKED_UP 状态到付包裹 ID: ${pkg.id}, 当前状态: ${pkg.status}`);

      const result = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'CASH',
        amount: 88.00,
        operator_name: '测试员',
      });

      assert(result.statusCode === 201, `PICKED_UP 状态收款状态码应为 201，实际为 ${result.statusCode}`);
      assert(result.body.data && result.body.data.package_id === pkg.id, '收款记录应关联正确的包裹');
    });

    await runTestScenario('8. 签收前必须先完成到付收款', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: 168.00,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建待签收到付包裹 ID: ${pkg.id}, 当前状态: ${pkg.status}`);

      const receiptBeforePayment = await makeRequest('POST', '/api/delivery-receipts', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        signer_name: 'COD签收测试人',
        sign_method: 'PERSONAL_SIGN',
        sign_time: new Date().toISOString(),
      });
      assert(receiptBeforePayment.statusCode === 400, `未收款签收状态码应为 400，实际为 ${receiptBeforePayment.statusCode}`);
      assert(
        receiptBeforePayment.body.message && receiptBeforePayment.body.message.includes('先完成收款'),
        `未收款签收错误信息应包含'先完成收款'，实际为: ${receiptBeforePayment.body.message}`
      );

      const paymentResult = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'CASH',
        amount: 168.00,
        operator_name: '测试员',
      });
      assert(paymentResult.statusCode === 201, `完成收款状态码应为 201，实际为 ${paymentResult.statusCode}`);

      const receiptAfterPayment = await makeRequest('POST', '/api/delivery-receipts', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        signer_name: 'COD签收测试人',
        sign_method: 'PERSONAL_SIGN',
        sign_time: new Date().toISOString(),
      });
      assert(receiptAfterPayment.statusCode === 201, `收款后签收状态码应为 201，实际为 ${receiptAfterPayment.statusCode}`);

      const deliveredPkg = await makeRequest('GET', `/api/packages/${pkg.id}`);
      assert(
        deliveredPkg.body.data && deliveredPkg.body.data.status === 'DELIVERED',
        `收款后签收应将包裹更新为 DELIVERED，实际为: ${deliveredPkg.body.data?.status}`
      );
    });

    await runTestScenario('9. 收款后包裹列表 cod_summary 状态正确 (PAID)', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: 200.00,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建到付包裹 ID: ${pkg.id}, 应收金额: ${pkg.cod_amount}`);

      const listBefore = await makeRequest('GET', `/api/packages?is_cod=true&courier_id=${testContext.courierId}`);
      const pkgBefore = listBefore.body.data.list.find(p => p.id === pkg.id);
      assert(
        pkgBefore?.cod_summary?.payment_status === 'UNPAID',
        `收款前 cod_summary.payment_status 应为 UNPAID，实际为: ${pkgBefore?.cod_summary?.payment_status}`
      );

      const paymentResult = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'CASH',
        amount: 200.00,
        operator_name: '测试员',
      });
      assert(paymentResult.statusCode === 201, '收款应成功');

      const listAfter = await makeRequest('GET', `/api/packages?is_cod=true&courier_id=${testContext.courierId}`);
      const pkgAfter = listAfter.body.data.list.find(p => p.id === pkg.id);
      assert(
        pkgAfter?.cod_summary?.payment_status === 'PAID',
        `收款后 cod_summary.payment_status 应为 PAID，实际为: ${pkgAfter?.cod_summary?.payment_status}`
      );
      assert(
        pkgAfter?.cod_summary?.payment_method === 'CASH',
        `cod_summary.payment_method 应为 CASH，实际为: ${pkgAfter?.cod_summary?.payment_method}`
      );
      assert(
        pkgAfter?.cod_summary?.paid_amount === 200.00,
        `cod_summary.paid_amount 应为 200.00，实际为: ${pkgAfter?.cod_summary?.paid_amount}`
      );
    });

    await runTestScenario('10. WAIVED 后包裹列表 cod_summary 状态正确 (WAIVED)', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: 88.88,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建到付包裹 ID: ${pkg.id}, 应收金额: ${pkg.cod_amount}`);

      const paymentResult = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'WAIVED',
        waived_reason: '样品件免收',
        operator_name: '测试员',
      });
      assert(paymentResult.statusCode === 201, 'WAIVED 收款应成功');

      const listWaived = await makeRequest('GET', `/api/packages?is_cod=true&courier_id=${testContext.courierId}`);
      const pkgWaived = listWaived.body.data.list.find(p => p.id === pkg.id);
      assert(
        pkgWaived?.cod_summary?.payment_status === 'WAIVED',
        `WAIVED 后 cod_summary.payment_status 应为 WAIVED，实际为: ${pkgWaived?.cod_summary?.payment_status}`
      );
      assert(
        pkgWaived?.cod_summary?.waived_reason === '样品件免收',
        `cod_summary.waived_reason 应为'样品件免收'，实际为: ${pkgWaived?.cod_summary?.waived_reason}`
      );
    });

    await runTestScenario('11. 工作台待收款列表验证', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: 150.00,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建到付包裹 ID: ${pkg.id}, 应收金额: ${pkg.cod_amount}`);

      const pendingBefore = await makeRequest('GET', `/api/workstation/${testContext.courierId}/cod/pending`);
      const isInPendingBefore = pendingBefore.body.data.some(p => p.id === pkg.id);
      assert(isInPendingBefore === true, '收款前包裹应在待收款列表中');

      await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: testContext.courierId,
        payment_method: 'SCAN',
        amount: 150.00,
        operator_name: '测试员',
      });

      const pendingAfter = await makeRequest('GET', `/api/workstation/${testContext.courierId}/cod/pending`);
      const isInPendingAfter = pendingAfter.body.data.some(p => p.id === pkg.id);
      assert(isInPendingAfter === false, '收款后包裹应从待收款列表移除');
    });

    await runTestScenario('12. 日结汇总数据验证', async (createPkg, assert) => {
      const pkgCash = await createPkg({
        is_cod: true,
        cod_amount: 300.00,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      const pkgScan = await createPkg({
        is_cod: true,
        cod_amount: 100.00,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建两个到付包裹，现金300，扫码100`);

      const summaryBefore = await makeRequest('GET', `/api/cod-payments/courier/${testContext.courierId}/daily-summary`);
      const cashBefore = summaryBefore.body.data.cash_amount || 0;
      const scanBefore = summaryBefore.body.data.scan_amount || 0;

      await makeRequest('POST', '/api/cod-payments', {
        package_id: pkgCash.id,
        courier_id: testContext.courierId,
        payment_method: 'CASH',
        amount: 300.00,
        operator_name: '测试员',
      });
      await makeRequest('POST', '/api/cod-payments', {
        package_id: pkgScan.id,
        courier_id: testContext.courierId,
        payment_method: 'SCAN',
        amount: 100.00,
        operator_name: '测试员',
      });

      const summaryAfter = await makeRequest('GET', `/api/cod-payments/courier/${testContext.courierId}/daily-summary`);
      const cashAfter = summaryAfter.body.data.cash_amount || 0;
      const scanAfter = summaryAfter.body.data.scan_amount || 0;

      assert(cashAfter >= cashBefore + 300, `现金金额应增加至少 300，之前: ${cashBefore}, 之后: ${cashAfter}`);
      assert(scanAfter >= scanBefore + 100, `扫码金额应增加至少 100，之前: ${scanBefore}, 之后: ${scanAfter}`);
    });

    await runTestScenario('13. 非负责小哥不能收款', async (createPkg, assert) => {
      const pkg = await createPkg({
        is_cod: true,
        cod_amount: 200.00,
        status: 'DELIVERING',
        courier_id: testContext.courierId,
        site_id: testContext.siteId,
        zone_id: testContext.zoneId,
      });
      console.log(`  创建到付包裹 ID: ${pkg.id}, 负责小哥: ${pkg.courier_id}`);

      const otherCourierId = testContext.courierId === 1 ? 2 : 1;
      const result = await makeRequest('POST', '/api/cod-payments', {
        package_id: pkg.id,
        courier_id: otherCourierId,
        payment_method: 'CASH',
        amount: 200.00,
        operator_name: '测试员',
      });

      assert(result.statusCode === 403, `非负责小哥收款状态码应为 403，实际为 ${result.statusCode}`);
      assert(
        result.body.message && result.body.message.includes('只有负责'),
        `错误信息应说明只有负责小哥才能收款，实际为: ${result.body.message}`
      );
    });

    console.log('\n' + '='.repeat(60));
    console.log('📊 测试结果汇总');
    console.log('='.repeat(60));
    console.log(`  总计: ${passedCount + failedCount} 个断言`);
    console.log(`  ✅ 通过: ${passedCount}`);
    console.log(`  ❌ 失败: ${failedCount}`);

    if (failedCount > 0) {
      console.log('\n❌ 失败的断言:');
      testResults.filter(r => !r.pass).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.message}`);
      });
    }

    console.log('\n' + '='.repeat(60));
    if (failedCount === 0) {
      console.log('✅ 所有测试通过！');
    } else {
      console.log(`❌ 有 ${failedCount} 个断言失败`);
    }
    console.log('='.repeat(60));

    return failedCount === 0;

  } catch (err) {
    console.error('💥 测试执行异常:', err.message);
    console.error(err.stack);
    return false;
  } finally {
    await cleanupAllTestData();
  }
}

async function main() {
  const success = await runTests();
  process.exit(success ? 0 : 1);
}
main();
