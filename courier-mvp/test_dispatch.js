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

async function runTests() {
  console.log('='.repeat(60));
  console.log('智能分派模块测试');
  console.log('='.repeat(60));

  try {
    console.log('\n📋 步骤1: 创建测试数据');
    console.log('-'.repeat(40));

    console.log('创建无 site_id 和 zone_id 的历史包裹...');
    const pkg1 = await makeRequest('POST', '/api/packages', {
      tracking_no: 'TEST-HISTORY-001',
      receiver_name: '历史客户A',
      receiver_phone: '13900000001',
      receiver_address: '北京市朝阳区历史地址1号',
    });
    console.log('  历史包裹1 ID:', pkg1.body.data && pkg1.body.data.id);

    console.log('创建有 site_id 无 zone_id 的包裹...');
    const pkg2 = await makeRequest('POST', '/api/packages', {
      tracking_no: 'TEST-PARTIAL-001',
      receiver_name: '半完整客户B',
      receiver_phone: '13900000002',
      receiver_address: '北京市海淀区中关村大街2号',
      site_id: 1,
    });
    console.log('  半完整包裹2 ID:', pkg2.body.data && pkg2.body.data.id);

    console.log('创建完整信息包裹（站点1+区域1）...');
    const pkg3 = await makeRequest('POST', '/api/packages', {
      tracking_no: 'TEST-FULL-001',
      receiver_name: '完整客户C',
      receiver_phone: '13900000003',
      receiver_address: '北京市海淀区知春路3号',
      site_id: 1,
      zone_id: 1,
    });
    console.log('  完整包裹3 ID:', pkg3.body.data && pkg3.body.data.id);

    console.log('创建跨区域包裹（站点2+区域3）...');
    const pkg4 = await makeRequest('POST', '/api/packages', {
      tracking_no: 'TEST-CROSS-ZONE-001',
      receiver_name: '跨区客户D',
      receiver_phone: '13900000004',
      receiver_address: '北京市朝阳区望京4号',
      site_id: 2,
      zone_id: 3,
    });
    console.log('  跨区域包裹4 ID:', pkg4.body.data && pkg4.body.data.id);

    const pkgId1 = pkg1.body.data.id;
    const pkgId2 = pkg2.body.data.id;
    const pkgId3 = pkg3.body.data.id;
    const pkgId4 = pkg4.body.data.id;

    console.log('\n📋 步骤2: 测试预览接口 - 基础成功场景');
    console.log('-'.repeat(40));
    const preview1 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgId1, pkgId2, pkgId3, pkgId4],
    });
    console.log('预览结果汇总:', JSON.stringify(preview1.body.data.summary, null, 2));
    console.log('预览详情:');
    preview1.body.data.details.forEach(d => {
      console.log(`  包裹${d.package_id}: ${d.type} - ${d.reason}`);
      if (d.recommended_courier) {
        console.log(`    → 推荐小哥: ${d.recommended_courier.name} (未完成: ${d.recommended_courier.unfinished_count})`);
      }
    });

    console.log('\n📋 步骤3: 测试跳过场景 - 非 CREATED 状态包裹');
    console.log('-'.repeat(40));
    console.log('先把包裹3分配给小哥1...');
    await makeRequest('PUT', `/api/packages/${pkgId3}/assign`, { courier_id: 1 });
    const pkg3Assigned = await makeRequest('GET', `/api/packages/${pkgId3}`);
    console.log('  包裹3当前状态:', pkg3Assigned.body.data.status);

    console.log('再次预览（包含已分配包裹3）...');
    const preview2 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgId1, pkgId3],
    });
    console.log('预览结果汇总:', JSON.stringify(preview2.body.data.summary, null, 2));
    preview2.body.data.details.forEach(d => {
      console.log(`  包裹${d.package_id}: ${d.type} - ${d.reason}`);
    });

    console.log('\n📋 步骤4: 测试数据异常场景');
    console.log('-'.repeat(40));
    const preview3 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgId1, 99999, -1, 'invalid'],
    });
    console.log('预览结果汇总:', JSON.stringify(preview3.body.data.summary, null, 2));
    preview3.body.data.details.forEach(d => {
      console.log(`  包裹${d.package_id}: ${d.type} - ${d.reason}`);
    });

    console.log('\n📋 步骤5: 测试无法分派场景 - 下班小哥区域');
    console.log('-'.repeat(40));
    console.log('创建一个只有下班小哥负责的区域的包裹...');
    console.log('(种子数据中王五 OFF_DUTY 负责区域1，张三和李四也负责区域1，所以需要先找一个区域)');
    console.log('实际情况：所有区域都有在岗小哥，所以这个场景需要特定设置下才会触发');

    console.log('\n📋 步骤6: 测试确认分派 - 部分成功场景');
    console.log('-'.repeat(40));
    const confirmResult = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      package_ids: [pkgId1, pkgId2, pkgId3, 99999],
      operator_name: '测试运营人员',
    });
    console.log('确认结果汇总:', JSON.stringify(confirmResult.body.data.summary, null, 2));
    confirmResult.body.data.details.forEach(d => {
      if (d.type === 'SUCCESS') {
        console.log(`  ✅ 包裹${d.package_id}: 成功分派给 ${d.recommended_courier.name}, 确认状态: ${d.confirmed ? '已确认' : '未确认'}`);
      } else {
        console.log(`  ❌ 包裹${d.package_id}: ${d.type} - ${d.reason}`);
      }
    });

    console.log('\n📋 步骤7: 验证 package_track 已写入');
    console.log('-'.repeat(40));
    if (confirmResult.body.data.details[0].type === 'SUCCESS') {
      const trackResult = await makeRequest('GET', `/api/packages/${pkgId1}`);
      console.log('包裹1的轨迹记录数:', trackResult.body.data.tracks ? trackResult.body.data.tracks.length : 0);
      if (trackResult.body.data.tracks) {
        trackResult.body.data.tracks.forEach(t => {
          console.log(`  - ${t.created_at}: ${t.old_status || '无'} → ${t.new_status} (${t.operator_type} - ${t.operator_name || '未知'})`);
        });
      }
    }

    console.log('\n📋 步骤8: 验证包裹状态已更新');
    console.log('-'.repeat(40));
    const pkg1Updated = await makeRequest('GET', `/api/packages/${pkgId1}`);
    const pkg2Updated = await makeRequest('GET', `/api/packages/${pkgId2}`);
    console.log('包裹1状态:', pkg1Updated.body.data.status, '小哥:', pkg1Updated.body.data.courier_name);
    console.log('包裹2状态:', pkg2Updated.body.data.status, '小哥:', pkg2Updated.body.data.courier_name);

    console.log('\n' + '='.repeat(60));
    console.log('✅ 所有测试场景执行完成');
    console.log('='.repeat(60));

  } catch (err) {
    console.error('测试执行出错:', err.message);
    console.error(err.stack);
  }
}

async function main() {
  try {
    await runTests();
    process.exit(0);
  } catch (err) {
    console.error('测试执行出错:', err.message);
    process.exit(1);
  }
}
main();
