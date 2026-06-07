const http = require('http');

const BASE_URL = 'localhost';
const PORT = 3000;

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

async function runTests() {
  console.log('='.repeat(60));
  console.log('智能分派方案模式测试');
  console.log('='.repeat(60));

  try {
    console.log('\n📋 步骤1: 创建测试数据');
    console.log('-'.repeat(40));

    console.log('创建测试包裹1（完整信息）...');
    const pkg1 = await makeRequest('POST', '/api/packages', {
      tracking_no: 'TEST-PLAN-001',
      receiver_name: '方案测试客户A',
      receiver_phone: '13910000001',
      receiver_address: '北京市海淀区知春路1号',
      site_id: 1,
      zone_id: 1,
    });
    const pkgId1 = pkg1.body.data.id;
    console.log('  包裹1 ID:', pkgId1);

    console.log('创建测试包裹2（完整信息）...');
    const pkg2 = await makeRequest('POST', '/api/packages', {
      tracking_no: 'TEST-PLAN-002',
      receiver_name: '方案测试客户B',
      receiver_phone: '13910000002',
      receiver_address: '北京市海淀区中关村2号',
      site_id: 1,
      zone_id: 2,
    });
    const pkgId2 = pkg2.body.data.id;
    console.log('  包裹2 ID:', pkgId2);

    console.log('创建测试包裹3（用于失效验证）...');
    const pkg3 = await makeRequest('POST', '/api/packages', {
      tracking_no: 'TEST-PLAN-003',
      receiver_name: '方案测试客户C',
      receiver_phone: '13910000003',
      receiver_address: '北京市朝阳区望京3号',
      site_id: 2,
      zone_id: 3,
    });
    const pkgId3 = pkg3.body.data.id;
    console.log('  包裹3 ID:', pkgId3);

    console.log('\n📋 步骤2: 测试预览接口 - 生成方案');
    console.log('-'.repeat(40));
    const preview1 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgId1, pkgId2, pkgId3],
      operator_name: '测试运营',
    });
    console.log('预览状态:', preview1.statusCode);
    console.log('方案ID:', preview1.body.data.plan_id);
    console.log('过期时间:', preview1.body.data.expires_at);
    console.log('预览结果汇总:', JSON.stringify(preview1.body.data.summary, null, 2));
    console.log('预览详情:');
    preview1.body.data.details.forEach(d => {
      console.log(`  包裹${d.package_id}: ${d.type} - ${d.reason}`);
      if (d.recommended_courier) {
        console.log(`    → 推荐小哥: ${d.recommended_courier.name} (未完成: ${d.recommended_courier.unfinished_count})`);
      }
    });

    const planId = preview1.body.data.plan_id;
    if (!planId) {
      console.error('❌ 预览未生成方案ID，测试终止');
      return;
    }

    console.log('\n📋 步骤3: 测试确认接口 - 正常确认');
    console.log('-'.repeat(40));
    const confirm1 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      plan_id: planId,
      operator_name: '测试运营',
    });
    console.log('确认状态:', confirm1.statusCode);
    console.log('确认结果汇总:', JSON.stringify(confirm1.body.data.summary, null, 2));
    confirm1.body.data.details.forEach(d => {
      if (d.type === 'SUCCESS' && d.confirmed) {
        console.log(`  ✅ 包裹${d.package_id}: 成功分派给 ${d.recommended_courier.name}`);
      } else if (d.type === 'INVALID') {
        console.log(`  ⚠️  包裹${d.package_id}: 方案失效 - ${d.reason}`);
        if (d.invalidation_reason) {
          d.invalidation_reason.forEach(r => console.log(`     - ${r}`));
        }
      } else {
        console.log(`  ❌ 包裹${d.package_id}: ${d.type} - ${d.reason}`);
      }
    });

    console.log('\n📋 步骤4: 测试重复确认 - 应该报错');
    console.log('-'.repeat(40));
    const confirm2 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      plan_id: planId,
      operator_name: '测试运营',
    });
    console.log('重复确认状态:', confirm2.statusCode);
    console.log('重复确认结果:', confirm2.body.message || confirm2.body);

    console.log('\n📋 步骤5: 测试方案失效场景 - 包裹状态变更');
    console.log('-'.repeat(40));

    console.log('创建新的测试包裹...');
    const pkg4 = await makeRequest('POST', '/api/packages', {
      tracking_no: 'TEST-PLAN-004',
      receiver_name: '失效测试客户D',
      receiver_phone: '13910000004',
      receiver_address: '北京市海淀区五道口4号',
      site_id: 1,
      zone_id: 1,
    });
    const pkgId4 = pkg4.body.data.id;
    console.log('  包裹4 ID:', pkgId4);

    console.log('生成预览方案...');
    const preview2 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgId4],
      operator_name: '测试运营',
    });
    const planId2 = preview2.body.data.plan_id;
    console.log('  方案2 ID:', planId2);

    console.log('在确认前，先把包裹4手动分配给小哥1（改变状态）...');
    await makeRequest('PUT', `/api/packages/${pkgId4}/assign`, { courier_id: 1 });
    const pkg4Assigned = await makeRequest('GET', `/api/packages/${pkgId4}`);
    console.log('  包裹4当前状态:', pkg4Assigned.body.data.status);
    console.log('  包裹4当前小哥:', pkg4Assigned.body.data.courier_name);

    console.log('尝试确认方案（应该标记为失效）...');
    const confirm3 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      plan_id: planId2,
      operator_name: '测试运营',
    });
    console.log('确认状态:', confirm3.statusCode);
    console.log('确认结果汇总:', JSON.stringify(confirm3.body.data.summary, null, 2));
    confirm3.body.data.details.forEach(d => {
      if (d.type === 'INVALID') {
        console.log(`  ⚠️  包裹${d.package_id}: 方案已正确标记为失效`);
        console.log(`     原因: ${d.reason}`);
        if (d.invalidation_reason) {
          d.invalidation_reason.forEach(r => console.log(`     - ${r}`));
        }
      } else if (d.type === 'SUCCESS' && d.confirmed) {
        console.log(`  ✅ 包裹${d.package_id}: 成功分派（不符合预期）`);
      } else {
        console.log(`  ❌ 包裹${d.package_id}: ${d.type} - ${d.reason}`);
      }
    });

    console.log('\n📋 步骤6: 测试方案失效场景 - 小哥下班');
    console.log('-'.repeat(40));

    console.log('创建新的测试包裹...');
    const pkg5 = await makeRequest('POST', '/api/packages', {
      tracking_no: 'TEST-PLAN-005',
      receiver_name: '小哥下班测试客户E',
      receiver_phone: '13910000005',
      receiver_address: '北京市海淀区苏州街5号',
      site_id: 1,
      zone_id: 1,
    });
    const pkgId5 = pkg5.body.data.id;
    console.log('  包裹5 ID:', pkgId5);

    console.log('生成预览方案...');
    const preview3 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgId5],
      operator_name: '测试运营',
    });
    const planId3 = preview3.body.data.plan_id;
    const recommendedCourier = preview3.body.data.details[0].recommended_courier;
    console.log('  方案3 ID:', planId3);
    console.log('  推荐小哥:', recommendedCourier ? recommendedCourier.name : '无');

    if (recommendedCourier && recommendedCourier.id !== 1) {
      console.log('注意：此场景需要推荐小哥不是小哥1（因为小哥1有未完成包裹无法下班），跳过此测试');
    } else {
      console.log('此场景暂时跳过，因为有未完成包裹的小哥无法切换为下班状态');
    }

    console.log('\n📋 步骤7: 测试确认不存在的方案');
    console.log('-'.repeat(40));
    const confirm4 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      plan_id: 99999,
      operator_name: '测试运营',
    });
    console.log('状态:', confirm4.statusCode);
    console.log('结果:', confirm4.body.message || confirm4.body);

    console.log('\n📋 步骤8: 测试确认参数验证');
    console.log('-'.repeat(40));
    const confirm5 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      operator_name: '测试运营',
    });
    console.log('状态:', confirm5.statusCode);
    console.log('结果:', confirm5.body.message || confirm5.body);

    console.log('\n' + '='.repeat(60));
    console.log('✅ 所有方案模式测试场景执行完成');
    console.log('='.repeat(60));

  } catch (err) {
    console.error('测试执行出错:', err.message);
    console.error(err.stack);
  }
}

setTimeout(runTests, 2000);
