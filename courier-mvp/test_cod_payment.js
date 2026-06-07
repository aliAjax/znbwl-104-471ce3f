const http = require('http');
const { runAsync, allAsync } = require('./db');

const BASE_URL = 'localhost';
const PORT = 3000;
const TEST_TRACKING_PREFIX = 'COD-TEST-';

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

async function cleanupTestData() {
  try {
    console.log('\n🧹 开始清理测试数据...');

    const testPackages = await allAsync(
      "SELECT id FROM package WHERE tracking_no LIKE ?",
      [`${TEST_TRACKING_PREFIX}%`]
    );

    const packageIds = testPackages.map(p => p.id);

    if (packageIds.length > 0) {
      const placeholders = packageIds.map(() => '?').join(',');

      await runAsync(
        `DELETE FROM package_track WHERE package_id IN (${placeholders})`,
        packageIds
      );
      console.log(`  已清理 ${packageIds.length} 条包裹轨迹记录`);

      await runAsync(
        `DELETE FROM cod_payment WHERE package_id IN (${placeholders})`,
        packageIds
      );
      console.log(`  已清理 COD 收款记录`);

      await runAsync(
        `DELETE FROM delivery_appointment WHERE package_id IN (${placeholders})`,
        packageIds
      );
      console.log(`  已清理预约记录`);

      await runAsync(
        `DELETE FROM delivery_receipt WHERE package_id IN (${placeholders})`,
        packageIds
      );
      console.log(`  已清理签收记录`);

      await runAsync(
        `DELETE FROM exception_record WHERE package_id IN (${placeholders})`,
        packageIds
      );
      console.log(`  已清理异常记录`);

      await runAsync(
        `DELETE FROM package WHERE id IN (${placeholders})`,
        packageIds
      );
      console.log(`  已清理 ${packageIds.length} 个测试包裹`);
    }

    console.log('✅ 测试数据清理完成');
  } catch (err) {
    console.error('❌ 清理测试数据失败:', err.message);
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
    tracking_no: generateTrackingNo('COD-TEST'),
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
    const assignResult = await makeRequest('PUT', `/api/packages/${packageId}/assign`, { courier_id });
    if (assignResult.statusCode !== 200) {
      console.error(`  分配包裹失败: ${assignResult.body.message}`);
    }
    if (status === 'PICKED_UP' || status === 'DELIVERING') {
      const pickResult = await makeRequest('PUT', `/api/packages/${packageId}/status`, { status: 'PICKED_UP', courier_id });
      if (pickResult.statusCode !== 200) {
        console.error(`  更新状态到 PICKED_UP 失败: ${pickResult.body.message}`);
      }
      if (status === 'DELIVERING') {
        const deliverResult = await makeRequest('PUT', `/api/packages/${packageId}/status`, { status: 'DELIVERING', courier_id });
        if (deliverResult.statusCode !== 200) {
          console.error(`  更新状态到 DELIVERING 失败: ${deliverResult.body.message}`);
        }
      }
    }
  }

  const updatedPkg = await makeRequest('GET', `/api/packages/${packageId}`);
  return updatedPkg.body.data;
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('COD 到付收款回归测试');
  console.log('='.repeat(60));

  try {
    await cleanupTestData();

    console.log('\n🔧 准备测试环境：确保快递小哥在岗');
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
    
    const activeCourierId = testCourierId;
    const activeCourierZones = courierZones.filter(cz => cz.courier_id === activeCourierId);
    const testZone = activeCourierZones[0];
    const testSiteId = testZone ? testZone.site_id : 1;
    const testZoneId = testZone ? testZone.zone_id : 1;
    
    console.log(`  使用测试小哥 ID: ${activeCourierId}`);
    console.log(`  使用测试站点 ID: ${testSiteId}, 区域 ID: ${testZoneId}`);
    console.log('\n📋 测试场景 1: 非到付包裹不能收款');
    console.log('-'.repeat(60));

    const nonCodPkg = await createTestPackage({
      is_cod: false,
      status: 'DELIVERING',
      courier_id: activeCourierId,
      site_id: testSiteId,
      zone_id: testZoneId,
    });
    console.log(`创建非到付包裹 ID: ${nonCodPkg.id}, is_cod: ${nonCodPkg.is_cod}`);

    const payment1 = await makeRequest('POST', '/api/cod-payments', {
      package_id: nonCodPkg.id,
      courier_id: activeCourierId,
      payment_method: 'CASH',
      amount: 100,
      operator_name: '测试员',
    });
    console.log(`收款请求状态码: ${payment1.statusCode}`);
    console.log(`收款请求响应: ${payment1.body.message}`);
    if (payment1.statusCode === 400 && payment1.body.message.includes('不是到付包裹')) {
      console.log('✅ 非到付包裹收款被正确拒绝');
    } else {
      console.log('❌ 非到付包裹收款未被正确拒绝');
    }

    console.log('\n📋 测试场景 2: 金额不一致不能收款');
    console.log('-'.repeat(60));

    const codPkg1 = await createTestPackage({
      is_cod: true,
      cod_amount: 99.50,
      status: 'DELIVERING',
      courier_id: activeCourierId,
      site_id: testSiteId,
      zone_id: testZoneId,
    });

    console.log(`创建到付包裹 ID: ${codPkg1.id}, 应收金额: ${codPkg1.cod_amount}`);

    const payment2 = await makeRequest('POST', '/api/cod-payments', {
      package_id: codPkg1.id,
      courier_id: activeCourierId,
      payment_method: 'CASH',
      amount: 88.00,
      operator_name: '测试员',
    });
    console.log(`使用错误金额 88.00 收款，状态码: ${payment2.statusCode}`);
    console.log(`收款请求响应: ${payment2.body.message}`);
    if (payment2.statusCode === 400 && payment2.body.message.includes('金额不符')) {
      console.log('✅ 金额不一致收款被正确拒绝');
    } else {
      console.log('❌ 金额不一致收款未被正确拒绝');
    }

    console.log('\n📋 测试场景 3: WAIVED 必须填写免收原因');
    console.log('-'.repeat(60));

    const codPkg2 = await createTestPackage({
      is_cod: true,
      cod_amount: 50.00,
      status: 'DELIVERING',
      courier_id: activeCourierId,
      site_id: testSiteId,
      zone_id: testZoneId,
    });

    console.log(`创建到付包裹 ID: ${codPkg2.id}, 应收金额: ${codPkg2.cod_amount}`);

    const payment3 = await makeRequest('POST', '/api/cod-payments', {
      package_id: codPkg2.id,
      courier_id: activeCourierId,
      payment_method: 'WAIVED',
      operator_name: '测试员',
    });
    console.log(`WAIVED 方式不填原因收款，状态码: ${payment3.statusCode}`);
    console.log(`收款请求响应: ${payment3.body.message}`);
    if (payment3.statusCode === 400 && payment3.body.message.includes('免收原因')) {
      console.log('✅ WAIVED 不填原因被正确拒绝');
    } else {
      console.log('❌ WAIVED 不填原因未被正确拒绝');
    }

    const payment3Valid = await makeRequest('POST', '/api/cod-payments', {
      package_id: codPkg2.id,
      courier_id: activeCourierId,
      payment_method: 'WAIVED',
      waived_reason: '客户是VIP，免收到付款',
      operator_name: '测试员',
    });
    console.log(`WAIVED 方式填写原因收款，状态码: ${payment3Valid.statusCode}`);
    if (payment3Valid.statusCode === 201) {
      console.log('✅ WAIVED 填写原因收款成功');
      console.log(`   收款记录 ID: ${payment3Valid.body.data.id}`);
      console.log(`   免收原因: ${payment3Valid.body.data.waived_reason}`);
    } else {
      console.log('❌ WAIVED 填写原因收款失败:', payment3Valid.body.message);
    }

    console.log('\n📋 测试场景 4: 同一包裹不能重复收款');
    console.log('-'.repeat(60));

    const codPkg3 = await createTestPackage({
      is_cod: true,
      cod_amount: 120.00,
      status: 'DELIVERING',
      courier_id: activeCourierId,
      site_id: testSiteId,
      zone_id: testZoneId,
    });

    console.log(`创建到付包裹 ID: ${codPkg3.id}, 应收金额: ${codPkg3.cod_amount}`);

    const payment4First = await makeRequest('POST', '/api/cod-payments', {
      package_id: codPkg3.id,
      courier_id: activeCourierId,
      payment_method: 'SCAN',
      amount: 120.00,
      operator_name: '测试员',
    });
    console.log(`第一次收款，状态码: ${payment4First.statusCode}`);
    if (payment4First.statusCode === 201) {
      console.log('✅ 第一次收款成功');
    } else {
      console.log('❌ 第一次收款失败:', payment4First.body.message);
    }

    const payment4Second = await makeRequest('POST', '/api/cod-payments', {
      package_id: codPkg3.id,
      courier_id: activeCourierId,
      payment_method: 'CASH',
      amount: 120.00,
      operator_name: '测试员',
    });
    console.log(`第二次收款，状态码: ${payment4Second.statusCode}`);
    console.log(`第二次收款响应: ${payment4Second.body.message}`);
    if (payment4Second.statusCode === 400 && payment4Second.body.message.includes('重复收款')) {
      console.log('✅ 重复收款被正确拒绝');
    } else {
      console.log('❌ 重复收款未被正确拒绝');
    }

    console.log('\n📋 测试场景 5: 收款后包裹列表 cod_summary 状态正确');
    console.log('-'.repeat(60));

    const codPkg4 = await createTestPackage({
      is_cod: true,
      cod_amount: 200.00,
      status: 'DELIVERING',
      courier_id: activeCourierId,
      site_id: testSiteId,
      zone_id: testZoneId,
    });

    console.log(`创建到付包裹 ID: ${codPkg4.id}, 应收金额: ${codPkg4.cod_amount}`);

    const listBefore = await makeRequest('GET', `/api/packages?is_cod=true&courier_id=${activeCourierId}`);
    const pkgBefore = listBefore.body.data.list.find(p => p.id === codPkg4.id);
    console.log(`收款前 cod_summary:`, JSON.stringify(pkgBefore?.cod_summary));
    if (pkgBefore?.cod_summary?.payment_status === 'UNPAID') {
      console.log('✅ 收款前状态为 UNPAID');
    } else {
      console.log('❌ 收款前状态不正确');
    }

    const payment5 = await makeRequest('POST', '/api/cod-payments', {
      package_id: codPkg4.id,
      courier_id: activeCourierId,
      payment_method: 'CASH',
      amount: 200.00,
      operator_name: '测试员',
    });
    if (payment5.statusCode === 201) {
      console.log('✅ 收款成功');
    } else {
      console.log('❌ 收款失败:', payment5.body.message);
    }

    const listAfter = await makeRequest('GET', `/api/packages?is_cod=true&courier_id=${activeCourierId}`);
    const pkgAfter = listAfter.body.data.list.find(p => p.id === codPkg4.id);
    console.log(`收款后 cod_summary:`, JSON.stringify(pkgAfter?.cod_summary));
    if (pkgAfter?.cod_summary?.payment_status === 'PAID') {
      console.log('✅ 收款后状态为 PAID');
      console.log(`   payment_method: ${pkgAfter.cod_summary.payment_method}`);
      console.log(`   paid_amount: ${pkgAfter.cod_summary.paid_amount}`);
    } else {
      console.log('❌ 收款后状态不正确');
    }

    console.log('\n📋 测试场景 6: WAIVED 后包裹列表 cod_summary 状态正确');
    console.log('-'.repeat(60));

    const codPkg5 = await createTestPackage({
      is_cod: true,
      cod_amount: 88.88,
      status: 'DELIVERING',
      courier_id: activeCourierId,
      site_id: testSiteId,
      zone_id: testZoneId,
    });

    console.log(`创建到付包裹 ID: ${codPkg5.id}, 应收金额: ${codPkg5.cod_amount}`);

    const payment6 = await makeRequest('POST', '/api/cod-payments', {
      package_id: codPkg5.id,
      courier_id: activeCourierId,
      payment_method: 'WAIVED',
      waived_reason: '样品件免收',
      operator_name: '测试员',
    });
    if (payment6.statusCode === 201) {
      console.log('✅ WAIVED 收款成功');
    } else {
      console.log('❌ WAIVED 收款失败:', payment6.body.message);
    }

    const listWaived = await makeRequest('GET', `/api/packages?is_cod=true&courier_id=${activeCourierId}`);
    const pkgWaived = listWaived.body.data.list.find(p => p.id === codPkg5.id);
    console.log(`WAIVED 后 cod_summary:`, JSON.stringify(pkgWaived?.cod_summary));
    if (pkgWaived?.cod_summary?.payment_status === 'WAIVED') {
      console.log('✅ WAIVED 后状态为 WAIVED');
      console.log(`   payment_method: ${pkgWaived.cod_summary.payment_method}`);
      console.log(`   waived_reason: ${pkgWaived.cod_summary.waived_reason}`);
    } else {
      console.log('❌ WAIVED 后状态不正确');
    }

    console.log('\n📋 测试场景 7: 工作台待收款列表验证');
    console.log('-'.repeat(60));

    const codPkg6 = await createTestPackage({
      is_cod: true,
      cod_amount: 150.00,
      status: 'DELIVERING',
      courier_id: activeCourierId,
      site_id: testSiteId,
      zone_id: testZoneId,
    });

    console.log(`创建到付包裹 ID: ${codPkg6.id}, 应收金额: ${codPkg6.cod_amount}`);

    const pendingBefore = await makeRequest('GET', `/api/workstation/${activeCourierId}/cod/pending`);
    const isInPendingBefore = pendingBefore.body.data.some(p => p.id === codPkg6.id);
    console.log(`收款前待收款列表包含该包裹: ${isInPendingBefore}`);
    if (isInPendingBefore) {
      console.log('✅ 收款前在待收款列表中');
    } else {
      console.log('❌ 收款前不在待收款列表中');
    }

    await makeRequest('POST', '/api/cod-payments', {
      package_id: codPkg6.id,
      courier_id: activeCourierId,
      payment_method: 'SCAN',
      amount: 150.00,
      operator_name: '测试员',
    });

    const pendingAfter = await makeRequest('GET', `/api/workstation/${activeCourierId}/cod/pending`);
    const isInPendingAfter = pendingAfter.body.data.some(p => p.id === codPkg6.id);
    console.log(`收款后待收款列表包含该包裹: ${isInPendingAfter}`);
    if (!isInPendingAfter) {
      console.log('✅ 收款后从待收款列表移除');
    } else {
      console.log('❌ 收款后仍在待收款列表中');
    }

    console.log('\n📋 测试场景 8: 日结汇总数据验证');
    console.log('-'.repeat(60));

    const codPkg7 = await createTestPackage({
      is_cod: true,
      cod_amount: 300.00,
      status: 'DELIVERING',
      courier_id: activeCourierId,
      site_id: testSiteId,
      zone_id: testZoneId,
    });
    const codPkg8 = await createTestPackage({
      is_cod: true,
      cod_amount: 100.00,
      status: 'DELIVERING',
      courier_id: activeCourierId,
      site_id: testSiteId,
      zone_id: testZoneId,
    });
    console.log(`创建两个到付包裹，现金300，扫码100`);

    await makeRequest('POST', '/api/cod-payments', {
      package_id: codPkg7.id,
      courier_id: activeCourierId,
      payment_method: 'CASH',
      amount: 300.00,
      operator_name: '测试员',
    });
    await makeRequest('POST', '/api/cod-payments', {
      package_id: codPkg8.id,
      courier_id: activeCourierId,
      payment_method: 'SCAN',
      amount: 100.00,
      operator_name: '测试员',
    });

    const summary = await makeRequest('GET', `/api/cod-payments/courier/${activeCourierId}/daily-summary`);
    console.log(`今日汇总:`, JSON.stringify(summary.body.data, null, 2));
    if (summary.body.data.cash_amount >= 300 && summary.body.data.scan_amount >= 100) {
      console.log('✅ 日结汇总金额正确');
      console.log(`   现金: ${summary.body.data.cash_amount}`);
      console.log(`   扫码: ${summary.body.data.scan_amount}`);
    } else {
      console.log('❌ 日结汇总金额不正确');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ 所有 COD 收款回归测试场景执行完成');
    console.log('='.repeat(60));

  } catch (err) {
    console.error('测试执行出错:', err.message);
    console.error(err.stack);
  } finally {
    await cleanupTestData();
  }
}

setTimeout(runTests, 2000);
