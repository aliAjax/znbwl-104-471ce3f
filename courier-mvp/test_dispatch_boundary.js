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

async function runBoundaryTests() {
  console.log('='.repeat(70));
  console.log('智能分派边界测试 & 站点兜底逻辑验证');
  console.log('='.repeat(70));

  const createdPackageIds = [];

  try {
    console.log('\n📦 阶段1: 创建各类测试包裹');
    console.log('-'.repeat(70));

    console.log('\n1.1 创建站点1下无 zone_id 的包裹（测试站点兜底）...');
    const pkgSite1NoZone = await makeRequest('POST', '/api/packages', {
      tracking_no: 'BD-S1-NOZONE-' + Date.now(),
      receiver_name: '站点1无区域客户',
      receiver_phone: '13910000001',
      site_id: 1,
    });
    console.log('  ✅ 创建成功，ID:', pkgSite1NoZone.body.data.id);
    createdPackageIds.push(pkgSite1NoZone.body.data.id);

    console.log('\n1.2 创建站点2下无 zone_id 的包裹（测试不同站点兜底）...');
    const pkgSite2NoZone = await makeRequest('POST', '/api/packages', {
      tracking_no: 'BD-S2-NOZONE-' + Date.now(),
      receiver_name: '站点2无区域客户',
      receiver_phone: '13910000002',
      site_id: 2,
    });
    console.log('  ✅ 创建成功，ID:', pkgSite2NoZone.body.data.id);
    createdPackageIds.push(pkgSite2NoZone.body.data.id);

    console.log('\n1.3 创建无 site_id 无 zone_id 的历史包裹...');
    const pkgNoSiteNoZone = await makeRequest('POST', '/api/packages', {
      tracking_no: 'BD-NOSITE-NOZONE-' + Date.now(),
      receiver_name: '无站点无区域客户',
      receiver_phone: '13910000003',
    });
    console.log('  ✅ 创建成功，ID:', pkgNoSiteNoZone.body.data.id);
    createdPackageIds.push(pkgNoSiteNoZone.body.data.id);

    console.log('\n1.4 创建站点1+区域1的完整包裹（基准）...');
    const pkgFullInfo = await makeRequest('POST', '/api/packages', {
      tracking_no: 'BD-FULL-INFO-' + Date.now(),
      receiver_name: '完整信息客户',
      receiver_phone: '13910000004',
      site_id: 1,
      zone_id: 1,
    });
    console.log('  ✅ 创建成功，ID:', pkgFullInfo.body.data.id);
    createdPackageIds.push(pkgFullInfo.body.data.id);

    console.log('\n1.5 创建站点2+区域3的跨区域包裹...');
    const pkgCrossZone = await makeRequest('POST', '/api/packages', {
      tracking_no: 'BD-CROSS-ZONE-' + Date.now(),
      receiver_name: '跨区域客户',
      receiver_phone: '13910000005',
      site_id: 2,
      zone_id: 3,
    });
    console.log('  ✅ 创建成功，ID:', pkgCrossZone.body.data.id);
    createdPackageIds.push(pkgCrossZone.body.data.id);

    console.log('\n' + '='.repeat(70));
    console.log('🔍 阶段2: 站点兜底推荐逻辑验证');
    console.log('='.repeat(70));

    console.log('\n2.1 站点1下无区域包裹 - 应该只推荐站点1下的小哥...');
    const previewSite1 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgSite1NoZone.body.data.id],
    });
    const site1Courier = previewSite1.body.data.details[0].recommended_courier;
    console.log('  推荐小哥:', site1Courier ? `${site1Courier.name} (ID: ${site1Courier.id})` : '无');
    console.log('  推荐理由:', previewSite1.body.data.details[0].reason);
    if (previewSite1.body.data.details[0].candidate_count) {
      console.log('  候选小哥数量:', previewSite1.body.data.details[0].candidate_count);
    }

    console.log('\n2.2 站点2下无区域包裹 - 应该只推荐站点2下的小哥...');
    const previewSite2 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgSite2NoZone.body.data.id],
    });
    const site2Courier = previewSite2.body.data.details[0].recommended_courier;
    console.log('  推荐小哥:', site2Courier ? `${site2Courier.name} (ID: ${site2Courier.id})` : '无');
    console.log('  推荐理由:', previewSite2.body.data.details[0].reason);
    if (previewSite2.body.data.details[0].candidate_count) {
      console.log('  候选小哥数量:', previewSite2.body.data.details[0].candidate_count);
    }

    console.log('\n2.3 无站点无区域包裹 - 应该推荐全局小哥...');
    const previewGlobal = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgNoSiteNoZone.body.data.id],
    });
    const globalCourier = previewGlobal.body.data.details[0].recommended_courier;
    console.log('  推荐小哥:', globalCourier ? `${globalCourier.name} (ID: ${globalCourier.id})` : '无');
    console.log('  推荐理由:', previewGlobal.body.data.details[0].reason);
    if (previewGlobal.body.data.details[0].candidate_count) {
      console.log('  候选小哥数量:', previewGlobal.body.data.details[0].candidate_count);
    }

    console.log('\n2.4 验证站点1和站点2的推荐小哥不同（站点隔离）...');
    if (site1Courier && site2Courier) {
      const different = site1Courier.id !== site2Courier.id;
      console.log('  站点1和站点2推荐小哥不同:', different ? '✅ 是' : '❌ 否');
    }

    console.log('\n' + '='.repeat(70));
    console.log('🧱 阶段3: 参数边界验证');
    console.log('='.repeat(70));

    console.log('\n3.1 测试空请求体...');
    const r1 = await makeRequest('POST', '/api/packages/dispatch/preview', null);
    console.log('  状态码:', r1.statusCode, '- 消息:', r1.body.message);

    console.log('\n3.2 测试 package_ids 为 null...');
    const r2 = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: null });
    console.log('  状态码:', r2.statusCode, '- 消息:', r2.body.message);

    console.log('\n3.3 测试 package_ids 为 undefined...');
    const r3 = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: undefined });
    console.log('  状态码:', r3.statusCode, '- 消息:', r3.body.message);

    console.log('\n3.4 测试 package_ids 不是数组（传数字）...');
    const r4 = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: 123 });
    console.log('  状态码:', r4.statusCode, '- 消息:', r4.body.message);

    console.log('\n3.5 测试 package_ids 是空数组...');
    const r5 = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: [] });
    console.log('  状态码:', r5.statusCode, '- 消息:', r5.body.message);

    console.log('\n3.6 测试 operator_name 为数字...');
    const r6 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [createdPackageIds[0]],
      operator_name: 12345,
    });
    console.log('  状态码:', r6.statusCode, '- 消息:', r6.body.message);

    console.log('\n3.7 测试包含 null/undefined 的 ID 数组...');
    const r7 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [createdPackageIds[0], null, undefined, createdPackageIds[1]],
    });
    console.log('  状态码:', r7.statusCode);
    console.log('  处理后总数:', r7.body.data.summary.total);
    console.log('  成功数:', r7.body.data.summary.success);

    console.log('\n3.8 测试包含重复 ID 的数组...');
    const r8 = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [createdPackageIds[0], createdPackageIds[0], createdPackageIds[0]],
    });
    console.log('  状态码:', r8.statusCode);
    console.log('  去重后总数:', r8.body.data.summary.total, '(应该为 1)');

    console.log('\n' + '='.repeat(70));
    console.log('🔄 阶段4: 可重复性 & 幂等性验证');
    console.log('='.repeat(70));

    console.log('\n4.1 连续3次调用预览接口，验证结果一致性...');
    const previewResults = [];
    for (let i = 0; i < 3; i++) {
      const r = await makeRequest('POST', '/api/packages/dispatch/preview', {
        package_ids: [createdPackageIds[0], createdPackageIds[1]],
      });
      previewResults.push(r.body.data);
    }
    const consistent = previewResults.every(r =>
      r.summary.success === previewResults[0].summary.success &&
      r.details[0].recommended_courier?.id === previewResults[0].details[0].recommended_courier?.id
    );
    console.log('  结果一致性:', consistent ? '✅ 通过' : '❌ 失败');
    console.log('  每次成功数:', previewResults.map(r => r.summary.success).join(', '));

    console.log('\n4.2 确认分派后再次预览 - 已分配包裹应该被跳过...');
    const pkgForConfirm = createdPackageIds[0];
    await makeRequest('POST', '/api/packages/dispatch/confirm', {
      package_ids: [pkgForConfirm],
      operator_name: '边界测试人员',
    });
    const previewAfterConfirm = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgForConfirm],
    });
    console.log('  包裹状态:', previewAfterConfirm.body.data.details[0].package_info?.status);
    console.log('  结果类型:', previewAfterConfirm.body.data.details[0].type);
    console.log('  原因:', previewAfterConfirm.body.data.details[0].reason);

    console.log('\n4.3 重复确认同一包裹 - 第二次应该被跳过...');
    const confirm1 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      package_ids: [createdPackageIds[1]],
    });
    const confirm2 = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      package_ids: [createdPackageIds[1]],
    });
    console.log('  第一次确认成功数:', confirm1.body.data.summary.success);
    console.log('  第二次确认成功数:', confirm2.body.data.summary.success, '(应该为 0)');
    console.log('  第二次跳过数:', confirm2.body.data.summary.skipped, '(应该为 1)');

    console.log('\n4.4 预览-确认间隔中状态变更验证（竞态条件处理）...');
    const pkgRace = createdPackageIds[2];
    const racePreview = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [pkgRace],
    });
    console.log('  预览时状态: CREATED, 结果类型:', racePreview.body.data.details[0].type);

    await makeRequest('PUT', `/api/packages/${pkgRace}/assign`, { courier_id: 1 });
    console.log('  预览后手动将包裹分配给小哥1');

    const raceConfirm = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      package_ids: [pkgRace],
    });
    const confirmDetail = raceConfirm.body.data.details.find(d => d.package_id === pkgRace);
    console.log('  确认时结果类型:', confirmDetail?.type, '(应该为 SKIPPED)');
    console.log('  确认时原因:', confirmDetail?.reason);

    console.log('\n' + '='.repeat(70));
    console.log('📊 阶段5: 混合场景验证');
    console.log('='.repeat(70));

    console.log('\n5.1 混合所有类型包裹的批量预览...');
    const mixedPreview = await makeRequest('POST', '/api/packages/dispatch/preview', {
      package_ids: [
        ...createdPackageIds,
        99999,
        -1,
      ],
    });
    console.log('  总数:', mixedPreview.body.data.summary.total);
    console.log('  成功:', mixedPreview.body.data.summary.success);
    console.log('  跳过:', mixedPreview.body.data.summary.skipped);
    console.log('  失败:', mixedPreview.body.data.summary.failed);
    console.log('  数据异常:', mixedPreview.body.data.summary.data_error);

    console.log('\n5.2 混合场景确认分派...');
    const pkgForMixed1 = createdPackageIds[3];
    const pkgForMixed2 = createdPackageIds[4];
    const mixedConfirm = await makeRequest('POST', '/api/packages/dispatch/confirm', {
      package_ids: [pkgForMixed1, pkgForMixed2, 99999, createdPackageIds[0]],
      operator_name: '混合测试运营',
    });
    console.log('  总数:', mixedConfirm.body.data.summary.total);
    console.log('  成功:', mixedConfirm.body.data.summary.success);
    console.log('  跳过:', mixedConfirm.body.data.summary.skipped);
    console.log('  失败:', mixedConfirm.body.data.summary.failed);
    console.log('  数据异常:', mixedConfirm.body.data.summary.data_error);

    console.log('\n' + '='.repeat(70));
    console.log('📝 阶段6: package_track 写入验证');
    console.log('='.repeat(70));

    const trackCheckId = pkgForMixed1;
    const pkgDetail = await makeRequest('GET', `/api/packages/${trackCheckId}`);
    console.log('\n6.1 验证确认分派后的轨迹记录...');
    console.log('  包裹当前状态:', pkgDetail.body.data.status);
    console.log('  分配小哥:', pkgDetail.body.data.courier_name);
    console.log('  轨迹记录数:', pkgDetail.body.data.tracks?.length || 0);
    if (pkgDetail.body.data.tracks) {
      pkgDetail.body.data.tracks.forEach((t, i) => {
        console.log(`    ${i + 1}. ${t.created_at}: ${t.old_status || 'NULL'} → ${t.new_status} | ${t.operator_type} | ${t.operator_name || 'N/A'} | ${t.remark || ''}`);
      });
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ 所有边界测试执行完成！');
    console.log('='.repeat(70));

  } catch (err) {
    console.error('❌ 测试执行出错:', err.message);
    console.error(err.stack);
  }
}

setTimeout(runBoundaryTests, 1500);
