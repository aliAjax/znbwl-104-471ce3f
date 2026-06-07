const { initDatabase, closeDatabase, runAsync, getAsync, allAsync } = require('./db');
const { createAppointment, updateAppointment, checkAppointmentConflict, cancelAppointment } = require('./services/delivery_appointment');

const TEST_PACKAGE_IDS = [1, 3, 4];

async function cleanupTestData() {
  await runAsync("DELETE FROM delivery_appointment_change_log WHERE package_id IN (" + TEST_PACKAGE_IDS.join(',') + ")");
  await runAsync("DELETE FROM delivery_appointment WHERE package_id IN (" + TEST_PACKAGE_IDS.join(',') + ")");
}

async function restoreOriginalData() {
  await cleanupTestData();
  await runAsync("UPDATE package SET status = 'CREATED', courier_id = NULL WHERE id = 1");
}

async function testConflictCheck() {
  console.log('=== 开始测试预约时间冲突检查 ===\n');

  try {
    await initDatabase();

    console.log('1. 清理测试数据...');
    await cleanupTestData();

    console.log('\n2. 测试为包裹 3 创建预约（小哥 ID 1）...');
    const appt1 = await createAppointment({
      packageId: 3,
      appointmentStart: '2026-06-10 14:00:00',
      appointmentEnd: '2026-06-10 16:00:00',
      deliveryPreference: '本人签收',
      operatorType: 'RECEIVER',
      operatorName: '测试用户',
    });
    console.log('✓ 创建成功:', appt1.tracking_no, appt1.appointment_start, '-', appt1.appointment_end);

    console.log('\n3. 测试为包裹 4 创建同一时间段预约（同一小哥 ID 1）...');
    try {
      const appt2 = await createAppointment({
        packageId: 4,
        appointmentStart: '2026-06-10 14:00:00',
        appointmentEnd: '2026-06-10 16:00:00',
        deliveryPreference: '本人签收',
        operatorType: 'RECEIVER',
        operatorName: '测试用户',
      });
      console.log('✗ 应该失败但成功了');
    } catch (err) {
      console.log('✓ 正确拦截冲突:', err.message);
    }

    console.log('\n4. 测试部分时间重叠...');
    try {
      await createAppointment({
        packageId: 4,
        appointmentStart: '2026-06-10 15:00:00',
        appointmentEnd: '2026-06-10 17:00:00',
        deliveryPreference: '本人签收',
        operatorType: 'RECEIVER',
        operatorName: '测试用户',
      });
      console.log('✗ 应该失败但成功了');
    } catch (err) {
      console.log('✓ 正确拦截部分重叠:', err.message);
    }

    console.log('\n5. 测试完全包含时间段...');
    try {
      await createAppointment({
        packageId: 4,
        appointmentStart: '2026-06-10 13:00:00',
        appointmentEnd: '2026-06-10 17:00:00',
        deliveryPreference: '本人签收',
        operatorType: 'RECEIVER',
        operatorName: '测试用户',
      });
      console.log('✗ 应该失败但成功了');
    } catch (err) {
      console.log('✓ 正确拦截包含关系:', err.message);
    }

    console.log('\n6. 测试不冲突的时间段...');
    const appt2 = await createAppointment({
      packageId: 4,
      appointmentStart: '2026-06-10 16:00:00',
      appointmentEnd: '2026-06-10 18:00:00',
      deliveryPreference: '本人签收',
      operatorType: 'RECEIVER',
      operatorName: '测试用户',
    });
    console.log('✓ 不冲突时段创建成功:', appt2.tracking_no, appt2.appointment_start, '-', appt2.appointment_end);

    console.log('\n7. 测试修改预约时排除自身...');
    const updated = await updateAppointment({
      packageId: 3,
      appointmentStart: '2026-06-10 14:30:00',
      appointmentEnd: '2026-06-10 15:30:00',
      operatorType: 'RECEIVER',
      operatorName: '测试用户',
    });
    console.log('✓ 修改自身预约成功（排除自身）:', updated.tracking_no, updated.appointment_start, '-', updated.appointment_end);

    console.log('\n8. 测试修改到冲突时间段...');
    try {
      await updateAppointment({
        packageId: 4,
        appointmentStart: '2026-06-10 14:00:00',
        appointmentEnd: '2026-06-10 15:00:00',
        operatorType: 'RECEIVER',
        operatorName: '测试用户',
      });
      console.log('✗ 应该失败但成功了');
    } catch (err) {
      console.log('✓ 正确拦截修改冲突:', err.message);
    }

    console.log('\n9. 测试取消预约后冲突解除...');
    await cancelAppointment({
      packageId: 3,
      operatorType: 'RECEIVER',
      operatorName: '测试用户',
    });
    console.log('✓ 已取消包裹 3 的预约');

    const conflictAfterCancel = await checkAppointmentConflict(1, '2026-06-10 14:30:00', '2026-06-10 15:30:00');
    if (!conflictAfterCancel.hasConflict) {
      console.log('✓ 取消后同一时段不再冲突');
    } else {
      console.log('✗ 取消后仍检测到冲突');
    }

    console.log('\n10. 测试未分配小哥的包裹（先修改状态和分配）...');
    await runAsync("UPDATE package SET status = 'ASSIGNED', courier_id = NULL WHERE id = 1");
    const appt4 = await createAppointment({
      packageId: 1,
      appointmentStart: '2026-06-10 14:00:00',
      appointmentEnd: '2026-06-10 16:00:00',
      deliveryPreference: '本人签收',
      operatorType: 'ADMIN',
      operatorName: '管理员',
    });
    console.log('✓ 未分配小哥的包可以创建预约（不检查冲突）');

    console.log('\n=== 所有测试完成 ===');

  } catch (err) {
    console.error('测试出错:', err);
  } finally {
    console.log('\n清理测试数据，恢复原始状态...');
    try {
      await restoreOriginalData();
      console.log('✓ 数据恢复完成');
    } catch (cleanupErr) {
      console.error('清理数据时出错:', cleanupErr.message);
    }
    await closeDatabase();
  }
}

async function main() {
  try {
    await testConflictCheck();
    process.exit(0);
  } catch (err) {
    console.error('测试执行出错:', err);
    process.exit(1);
  }
}
main();
