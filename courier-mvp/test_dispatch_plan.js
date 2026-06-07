const http = require('http');

const BASE_URL = process.env.BASE_URL || 'localhost';
const PORT = process.env.PORT || 3000;

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

function genTrackingNo(prefix) {
  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${prefix}-${ts}-${rand}`;
}

async function runTests() {
  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      passCount++;
      console.log(`  ✅ ${message}`);
    } else {
      failCount++;
      console.log(`  ❌ ${message}`);
    }
  }

  console.log('='.repeat(60));
  console.log('智能分派方案模式测试');
  console.log('='.repeat(60));

  try {
    console.log('\n📋 步骤1: 创建测试数据');
    console.log('-'.repeat(40));

    console.log('创建测试包裹1（完整信息）...');
    const pkg1 = await makeRequest('POST', '/api/packages', {
      tracking_no: genTrackingNo('PLAN-A'),
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
      tracking_no: genTrackingNo('PLAN-B'),
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
      tracking_no: genTrackingNo('PLAN-C'),
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
    assert(preview1.statusCode === 200, '预览接口返回 200');
    assert(preview1.body.data && preview1.body.data.plan_id, '返回 plan_id');
    assert(preview1.body.data && preview1.body.data.expires_at, '返回 expires_at');
    assert(preview1.body.data.summary.success === 3, '预览成功 3 个包裹');

    const planId = preview1.body.data.plan_id;
    console.log('  方案ID:', planId);
    console.log('  过期时间:', preview1.body.data.expires_at);

    console.log('\n📋 步骤3: 测试确认接口 - 正常确认');
    console.log('-'.repeat(40));
    const confirm1 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      plan_id: planId,
      operator_name: '测试运营',
    });
    assert(confirm1.statusCode === 200, '确认接口返回 200');
    assert(confirm1.body.data.summary.success === 3, '确认成功 3 个包裹');
    assert(confirm1.body.data.summary.invalid === 0, '无失效包裹');

    const confirmedItems = confirm1.body.data.details.filter(d => d.type === 'SUCCESS' && d.confirmed);
    assert(confirmedItems.length === 3, '3 个包裹标记为已确认');

    console.log('\n📋 步骤4: 测试重复确认 - 应该报错');
    console.log('-'.repeat(40));
    const confirm2 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      plan_id: planId,
      operator_name: '测试运营',
    });
    assert(confirm2.statusCode === 400, '重复确认返回 400');
    assert(confirm2.body.message && confirm2.body.message.includes('已确认'), '错误信息提示已确认');

    console.log('\n📋 步骤5: 测试方案失效场景 - 包裹状态变更');
    console.log('-'.repeat(40));

    console.log('创建新的测试包裹...');
    const pkg4 = await makeRequest('POST', '/api/packages', {
      tracking_no: genTrackingNo('INVALID'),
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
    assert(pkg4Assigned.body.data.status === 'ASSIGNED', '包裹已手动分配');

    console.log('尝试确认方案（应该标记为失效）...');
    const confirm3 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      plan_id: planId2,
      operator_name: '测试运营',
    });
    assert(confirm3.statusCode === 200, '确认接口返回 200');
    assert(confirm3.body.data.summary.invalid === 1, '有 1 个失效包裹');
    assert(confirm3.body.data.summary.success === 0, '无成功确认的包裹');

    const invalidItem = confirm3.body.data.details.find(d => d.type === 'INVALID');
    assert(invalidItem, '存在 INVALID 类型的结果');
    assert(invalidItem.invalidation_reason && invalidItem.invalidation_reason.length > 0, '包含失效原因列表');
    console.log('  失效原因:', invalidItem.invalidation_reason.join('; '));

    console.log('\n📋 步骤6: 测试确认不存在的方案');
    console.log('-'.repeat(40));
    const confirm4 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      plan_id: 99999999,
      operator_name: '测试运营',
    });
    assert(confirm4.statusCode === 400, '不存在的方案返回 400');
    assert(confirm4.body.message && confirm4.body.message.includes('不存在'), '错误信息提示不存在');

    console.log('\n📋 步骤7: 测试确认参数验证');
    console.log('-'.repeat(40));
    const confirm5 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      operator_name: '测试运营',
    });
    assert(confirm5.statusCode === 400, '缺少 plan_id 返回 400');
    assert(confirm5.body.message && confirm5.body.message.includes('plan_id'), '错误信息提示缺少 plan_id');

    const confirm6 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      plan_id: 'invalid',
      operator_name: '测试运营',
    });
    assert(confirm6.statusCode === 400, 'plan_id 类型错误返回 400');

    console.log('\n📋 步骤8: 测试预览参数验证');
    console.log('-'.repeat(40));
    const preview3 = await makeRequest('POST', '/api/packages/dispatch/preview', {});
    assert(preview3.statusCode === 400, '缺少 package_ids 返回 400');

    console.log('\n' + '='.repeat(60));
    console.log(`测试结果: ${passCount} 通过, ${failCount} 失败`);
    if (failCount === 0) {
      console.log('✅ 所有测试通过');
    } else {
      console.log('❌ 部分测试失败');
    }
    console.log('='.repeat(60));

    return failCount === 0;

  } catch (err) {
    console.error('💥 测试执行异常:', err.message);
    console.error(err.stack);
    return false;
  }
}

async function main() {
  const success = await runTests();
  process.exit(success ? 0 : 1);
}
main();
