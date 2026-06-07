const http = require('http');

function makeRequest(method, path, data) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode, body: JSON.parse(body) }); }
        catch(e) { resolve({ statusCode: res.statusCode, body: body }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

(async () => {
  console.log('='.repeat(60));
  console.log('验证修复效果');
  console.log('='.repeat(60));

  console.log('\n✅ 1. 参数边界验证');
  console.log('-'.repeat(60));

  const r1 = await makeRequest('POST', '/api/packages/dispatch/preview', null);
  console.log('空请求体:', r1.statusCode, '-', r1.body.message || '');

  const r2 = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: null });
  console.log('package_ids=null:', r2.statusCode, '-', r2.body.message || '');

  const r3 = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: 123 });
  console.log('package_ids=数字:', r3.statusCode, '-', r3.body.message || '');

  const r4 = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: [] });
  console.log('package_ids=空数组:', r4.statusCode, '-', r4.body.message || '');

  const r5 = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: [1], operator_name: 12345 });
  console.log('operator_name=数字:', r5.statusCode, '-', r5.body.message || '');

  console.log('\n✅ 2. 站点隔离逻辑验证');
  console.log('-'.repeat(60));

  const p1 = await makeRequest('POST', '/api/packages', {
    tracking_no: 'VRFY-S1-' + Date.now(),
    receiver_name: '站点1测试',
    receiver_phone: '13900000011',
    site_id: 1,
  });
  const p2 = await makeRequest('POST', '/api/packages', {
    tracking_no: 'VRFY-S2-' + Date.now(),
    receiver_name: '站点2测试',
    receiver_phone: '13900000012',
    site_id: 2,
  });

  const id1 = p1.body.data.id;
  const id2 = p2.body.data.id;
  console.log('站点1包裹:', id1, '- 站点2包裹:', id2);

  const prev1 = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: [id1] });
  const prev2 = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: [id2] });

  const c1 = prev1.body.data.details[0].recommended_courier;
  const c2 = prev2.body.data.details[0].recommended_courier;

  console.log('站点1推荐:', c1 ? `${c1.name}(ID:${c1.id}) 未完成:${c1.unfinished_count}` : '无');
  console.log('站点1理由:', prev1.body.data.details[0].reason);
  console.log('站点1候选数:', prev1.body.data.details[0].candidate_count);

  console.log('站点2推荐:', c2 ? `${c2.name}(ID:${c2.id}) 未完成:${c2.unfinished_count}` : '无');
  console.log('站点2理由:', prev2.body.data.details[0].reason);
  console.log('站点2候选数:', prev2.body.data.details[0].candidate_count);

  const isIsolated = c1 && c2 && c1.id !== c2.id;
  console.log('站点隔离:', isIsolated ? '✅ 通过' : '❌ 失败');

  console.log('\n✅ 3. 幂等性验证');
  console.log('-'.repeat(60));

  const p3 = await makeRequest('POST', '/api/packages', {
    tracking_no: 'VRFY-IDEM-' + Date.now(),
    receiver_name: '幂等测试',
    receiver_phone: '13900000013',
    site_id: 1,
    zone_id: 1,
  });
  const id3 = p3.body.data.id;

  const conf1 = await makeRequest('POST', '/api/packages/dispatch/confirm', { package_ids: [id3] });
  console.log('第一次确认成功数:', conf1.body.data.summary.success);

  const conf2 = await makeRequest('POST', '/api/packages/dispatch/confirm', { package_ids: [id3] });
  console.log('第二次确认成功数:', conf2.body.data.summary.success, '(应该为 0)');
  console.log('第二次确认跳过数:', conf2.body.data.summary.skipped, '(应该为 1)');

  console.log('\n✅ 4. 竞态条件验证');
  console.log('-'.repeat(60));

  const p4 = await makeRequest('POST', '/api/packages', {
    tracking_no: 'VRFY-RACE-' + Date.now(),
    receiver_name: '竞态测试',
    receiver_phone: '13900000014',
    site_id: 2,
    zone_id: 3,
  });
  const id4 = p4.body.data.id;

  const racePrev = await makeRequest('POST', '/api/packages/dispatch/preview', { package_ids: [id4] });
  console.log('预览状态:', racePrev.body.data.details[0].type);

  await makeRequest('PUT', `/api/packages/${id4}/assign`, { courier_id: 2 });
  console.log('预览后手动分配给小哥2');

  const raceConf = await makeRequest('POST', '/api/packages/dispatch/confirm', { package_ids: [id4] });
  const raceDetail = raceConf.body.data.details.find(d => d.package_id === id4);
  console.log('确认状态:', raceDetail?.type, '(应该为 SKIPPED)');
  console.log('确认原因:', raceDetail?.reason);

  console.log('\n' + '='.repeat(60));
  console.log('验证完成');
  console.log('='.repeat(60));
})();
