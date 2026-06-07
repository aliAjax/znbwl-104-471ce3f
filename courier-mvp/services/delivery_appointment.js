const { allAsync, getAsync, runAsync, runInTransaction } = require('../db');

const APPOINTMENT_STATUSES = {
  ACTIVE: 'ACTIVE',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
};

const CHANGE_TYPES = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  CANCEL: 'CANCEL',
};

const OPERATOR_TYPES = {
  RECEIVER: 'RECEIVER',
  COURIER: 'COURIER',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
};

const VALID_STATUSES_FOR_APPOINTMENT = ['ASSIGNED', 'PICKED_UP', 'DELIVERING'];
const FINAL_STATUSES = ['DELIVERED', 'FAILED'];

const DELIVERY_PREFERENCES = {
  PERSONAL_SIGN: '本人签收',
  AGENT_SIGN: '代收',
  SMART_CABINET: '快递柜',
  DOORSTEP: '放门口',
  OTHER: '其他',
};

function validateDateTime(datetimeStr) {
  const dt = new Date(datetimeStr);
  return !isNaN(dt.getTime());
}

function normalizeDateTime(datetimeStr) {
  const dt = new Date(datetimeStr);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

async function canModifyAppointment(packageId) {
  const pkg = await getAsync('SELECT status FROM package WHERE id = ?', [packageId]);
  if (!pkg) {
    const err = new Error('包裹不存在');
    err.statusCode = 404;
    throw err;
  }
  if (FINAL_STATUSES.includes(pkg.status)) {
    const err = new Error(`包裹当前状态为 ${pkg.status}，不允许修改预约`);
    err.statusCode = 400;
    throw err;
  }
  return true;
}

async function createAppointment({
  packageId,
  appointmentStart,
  appointmentEnd,
  deliveryPreference,
  remark,
  operatorType,
  operatorId,
  operatorName,
  changeReason,
}) {
  if (!packageId) {
    const err = new Error('包裹ID不能为空');
    err.statusCode = 400;
    throw err;
  }
  if (!appointmentStart || !validateDateTime(appointmentStart)) {
    const err = new Error('预约开始时间不能为空且必须为有效时间格式');
    err.statusCode = 400;
    throw err;
  }
  if (!appointmentEnd || !validateDateTime(appointmentEnd)) {
    const err = new Error('预约结束时间不能为空且必须为有效时间格式');
    err.statusCode = 400;
    throw err;
  }
  if (new Date(appointmentStart) >= new Date(appointmentEnd)) {
    const err = new Error('预约开始时间必须早于结束时间');
    err.statusCode = 400;
    throw err;
  }
  if (!operatorType || !Object.values(OPERATOR_TYPES).includes(operatorType)) {
    const err = new Error(`操作者类型无效，可选值: ${Object.values(OPERATOR_TYPES).join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const pkg = await getAsync('SELECT * FROM package WHERE id = ?', [packageId]);
  if (!pkg) {
    const err = new Error('包裹不存在');
    err.statusCode = 404;
    throw err;
  }
  if (!VALID_STATUSES_FOR_APPOINTMENT.includes(pkg.status)) {
    const err = new Error(`包裹当前状态为 ${pkg.status}，只有状态为 ${VALID_STATUSES_FOR_APPOINTMENT.join('、')} 的包裹可以创建预约`);
    err.statusCode = 400;
    throw err;
  }

  const existingAppointment = await getAsync('SELECT * FROM delivery_appointment WHERE package_id = ?', [packageId]);
  if (existingAppointment) {
    const err = new Error('该包裹已有预约，请使用修改接口');
    err.statusCode = 400;
    throw err;
  }

  const normalizedStart = normalizeDateTime(appointmentStart);
  const normalizedEnd = normalizeDateTime(appointmentEnd);

  const result = await runInTransaction(async () => {
    const insertResult = await runAsync(
      `INSERT INTO delivery_appointment (
        package_id, appointment_start, appointment_end, delivery_preference, remark,
        status, creator_type, creator_id, creator_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        packageId,
        normalizedStart,
        normalizedEnd,
        deliveryPreference || null,
        remark || null,
        APPOINTMENT_STATUSES.ACTIVE,
        operatorType,
        operatorId || null,
        operatorName || null,
      ]
    );

    const newValues = JSON.stringify({
      appointment_start: normalizedStart,
      appointment_end: normalizedEnd,
      delivery_preference: deliveryPreference || null,
      remark: remark || null,
      status: APPOINTMENT_STATUSES.ACTIVE,
    });

    await runAsync(
      `INSERT INTO delivery_appointment_change_log (
        appointment_id, package_id, old_values, new_values, change_type,
        operator_type, operator_id, operator_name, change_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        insertResult.lastID,
        packageId,
        null,
        newValues,
        CHANGE_TYPES.CREATE,
        operatorType,
        operatorId || null,
        operatorName || null,
        changeReason || '创建预约',
      ]
    );

    return insertResult.lastID;
  });

  return getAppointmentByPackageId(packageId);
}

async function updateAppointment({
  packageId,
  appointmentStart,
  appointmentEnd,
  deliveryPreference,
  remark,
  operatorType,
  operatorId,
  operatorName,
  changeReason,
}) {
  if (!packageId) {
    const err = new Error('包裹ID不能为空');
    err.statusCode = 400;
    throw err;
  }
  if (!operatorType || !Object.values(OPERATOR_TYPES).includes(operatorType)) {
    const err = new Error(`操作者类型无效，可选值: ${Object.values(OPERATOR_TYPES).join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  await canModifyAppointment(packageId);

  const appointment = await getAsync('SELECT * FROM delivery_appointment WHERE package_id = ?', [packageId]);
  if (!appointment) {
    const err = new Error('该包裹暂无预约，请先创建预约');
    err.statusCode = 404;
    throw err;
  }
  if (appointment.status !== APPOINTMENT_STATUSES.ACTIVE) {
    const err = new Error(`当前预约状态为 ${appointment.status}，无法修改`);
    err.statusCode = 400;
    throw err;
  }

  if (appointmentStart !== undefined && !validateDateTime(appointmentStart)) {
    const err = new Error('预约开始时间格式无效');
    err.statusCode = 400;
    throw err;
  }
  if (appointmentEnd !== undefined && !validateDateTime(appointmentEnd)) {
    const err = new Error('预约结束时间格式无效');
    err.statusCode = 400;
    throw err;
  }

  const normalizedStart = appointmentStart !== undefined ? normalizeDateTime(appointmentStart) : appointment.appointment_start;
  const normalizedEnd = appointmentEnd !== undefined ? normalizeDateTime(appointmentEnd) : appointment.appointment_end;

  if (new Date(normalizedStart) >= new Date(normalizedEnd)) {
    const err = new Error('预约开始时间必须早于结束时间');
    err.statusCode = 400;
    throw err;
  }

  const oldValues = JSON.stringify({
    appointment_start: appointment.appointment_start,
    appointment_end: appointment.appointment_end,
    delivery_preference: appointment.delivery_preference,
    remark: appointment.remark,
  });

  const updateFields = ['updated_at = datetime(\'now\',\'localtime\')'];
  const updateParams = [];

  if (appointmentStart !== undefined) {
    updateFields.push('appointment_start = ?');
    updateParams.push(normalizedStart);
  }
  if (appointmentEnd !== undefined) {
    updateFields.push('appointment_end = ?');
    updateParams.push(normalizedEnd);
  }
  if (deliveryPreference !== undefined) {
    updateFields.push('delivery_preference = ?');
    updateParams.push(deliveryPreference);
  }
  if (remark !== undefined) {
    updateFields.push('remark = ?');
    updateParams.push(remark);
  }

  if (updateFields.length === 1) {
    const err = new Error('没有需要更新的字段');
    err.statusCode = 400;
    throw err;
  }

  updateParams.push(packageId);

  const result = await runInTransaction(async () => {
    await runAsync(
      `UPDATE delivery_appointment SET ${updateFields.join(', ')} WHERE package_id = ?`,
      updateParams
    );

    const updated = await getAsync('SELECT * FROM delivery_appointment WHERE package_id = ?', [packageId]);
    const newValues = JSON.stringify({
      appointment_start: updated.appointment_start,
      appointment_end: updated.appointment_end,
      delivery_preference: updated.delivery_preference,
      remark: updated.remark,
    });

    await runAsync(
      `INSERT INTO delivery_appointment_change_log (
        appointment_id, package_id, old_values, new_values, change_type,
        operator_type, operator_id, operator_name, change_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        appointment.id,
        packageId,
        oldValues,
        newValues,
        CHANGE_TYPES.UPDATE,
        operatorType,
        operatorId || null,
        operatorName || null,
        changeReason || '修改预约',
      ]
    );

    return updated;
  });

  return getAppointmentByPackageId(packageId);
}

async function cancelAppointment({
  packageId,
  operatorType,
  operatorId,
  operatorName,
  changeReason,
}) {
  if (!packageId) {
    const err = new Error('包裹ID不能为空');
    err.statusCode = 400;
    throw err;
  }
  if (!operatorType || !Object.values(OPERATOR_TYPES).includes(operatorType)) {
    const err = new Error(`操作者类型无效，可选值: ${Object.values(OPERATOR_TYPES).join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  await canModifyAppointment(packageId);

  const appointment = await getAsync('SELECT * FROM delivery_appointment WHERE package_id = ?', [packageId]);
  if (!appointment) {
    const err = new Error('该包裹暂无预约');
    err.statusCode = 404;
    throw err;
  }
  if (appointment.status === APPOINTMENT_STATUSES.CANCELLED) {
    const err = new Error('该预约已取消');
    err.statusCode = 400;
    throw err;
  }

  await runInTransaction(async () => {
    await runAsync(
      `UPDATE delivery_appointment SET status = ?, updated_at = datetime('now','localtime') WHERE package_id = ?`,
      [APPOINTMENT_STATUSES.CANCELLED, packageId]
    );

    const oldValues = JSON.stringify({ status: appointment.status });
    const newValues = JSON.stringify({ status: APPOINTMENT_STATUSES.CANCELLED });

    await runAsync(
      `INSERT INTO delivery_appointment_change_log (
        appointment_id, package_id, old_values, new_values, change_type,
        operator_type, operator_id, operator_name, change_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        appointment.id,
        packageId,
        oldValues,
        newValues,
        CHANGE_TYPES.CANCEL,
        operatorType,
        operatorId || null,
        operatorName || null,
        changeReason || '取消预约',
      ]
    );
  });

  return getAppointmentByPackageId(packageId);
}

async function getAppointmentByPackageId(packageId) {
  if (!packageId) {
    const err = new Error('包裹ID不能为空');
    err.statusCode = 400;
    throw err;
  }

  const appointment = await getAsync(
    `SELECT da.*, p.tracking_no, p.receiver_name, p.receiver_phone, p.status as package_status
     FROM delivery_appointment da
     LEFT JOIN package p ON da.package_id = p.id
     WHERE da.package_id = ?`,
    [packageId]
  );

  if (appointment && appointment.old_values) {
    try { appointment.old_values = JSON.parse(appointment.old_values); } catch (e) {}
  }
  if (appointment && appointment.new_values) {
    try { appointment.new_values = JSON.parse(appointment.new_values); } catch (e) {}
  }

  return appointment;
}

async function getAppointmentChangeLogs(packageId) {
  if (!packageId) {
    const err = new Error('包裹ID不能为空');
    err.statusCode = 400;
    throw err;
  }

  const logs = await allAsync(
    `SELECT * FROM delivery_appointment_change_log
     WHERE package_id = ?
     ORDER BY created_at DESC, id DESC`,
    [packageId]
  );

  return logs.map(log => {
    const result = { ...log };
    if (result.old_values) {
      try { result.old_values = JSON.parse(result.old_values); } catch (e) {}
    }
    if (result.new_values) {
      try { result.new_values = JSON.parse(result.new_values); } catch (e) {}
    }
    return result;
  });
}

async function getAppointmentSummaryForPackage(packageId) {
  if (!packageId) {
    return null;
  }

  const appointment = await getAsync(
    `SELECT * FROM delivery_appointment WHERE package_id = ?`,
    [packageId]
  );

  if (!appointment) {
    return null;
  }

  const latestLog = await getAsync(
    `SELECT * FROM delivery_appointment_change_log
     WHERE package_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [packageId]
  );

  if (appointment.status === APPOINTMENT_STATUSES.ACTIVE) {
    return {
      status: appointment.status,
      appointment_start: appointment.appointment_start,
      appointment_end: appointment.appointment_end,
      delivery_preference: appointment.delivery_preference,
      remark: appointment.remark,
      latest_change_reason: latestLog ? latestLog.change_reason : null,
      latest_change_at: latestLog ? latestLog.created_at : null,
      latest_change_by: latestLog ? latestLog.operator_name : null,
    };
  }

  if (appointment.status === APPOINTMENT_STATUSES.CANCELLED) {
    const cancelLog = await getAsync(
      `SELECT * FROM delivery_appointment_change_log
       WHERE package_id = ? AND change_type = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [packageId, CHANGE_TYPES.CANCEL]
    );
    return {
      status: appointment.status,
      cancelled_at: cancelLog ? cancelLog.created_at : appointment.updated_at,
      cancelled_by: cancelLog ? cancelLog.operator_name : null,
      cancel_reason: cancelLog ? cancelLog.change_reason : null,
    };
  }

  return {
    status: appointment.status,
  };
}

async function getPackagesWithAppointmentFilter(courierId, filterType) {
  if (!courierId) {
    const err = new Error('快递小哥ID不能为空');
    err.statusCode = 400;
    throw err;
  }

  const validFilters = ['today', 'overdue', 'upcoming', 'no_appointment'];
  if (filterType && !validFilters.includes(filterType)) {
    const err = new Error(`无效的筛选类型，可选值: ${validFilters.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  let baseSql = `
    SELECT p.*, c.name as courier_name, c.phone as courier_phone,
           da.appointment_start, da.appointment_end, da.delivery_preference, da.remark as appointment_remark, da.status as appointment_status
    FROM package p
    LEFT JOIN courier c ON p.courier_id = c.id
    LEFT JOIN delivery_appointment da ON p.id = da.package_id AND da.status = 'ACTIVE'
    WHERE p.courier_id = ? AND p.status IN ('ASSIGNED', 'PICKED_UP', 'DELIVERING')
    AND date(p.updated_at) = date('now', 'localtime')
  `;

  const params = [courierId];

  if (filterType === 'today') {
    baseSql += ` AND date(da.appointment_start) = date('now', 'localtime')`;
  } else if (filterType === 'overdue') {
    baseSql += ` AND datetime(da.appointment_end) < datetime('now', 'localtime')`;
  } else if (filterType === 'upcoming') {
    baseSql += ` AND datetime(da.appointment_start) > datetime('now', 'localtime')`;
  } else if (filterType === 'no_appointment') {
    baseSql += ` AND da.id IS NULL`;
  }

  baseSql += `
    ORDER BY
      CASE WHEN da.appointment_start IS NOT NULL THEN 0 ELSE 1 END,
      datetime(da.appointment_start) ASC,
      CASE p.status
        WHEN 'DELIVERING' THEN 1
        WHEN 'PICKED_UP' THEN 2
        WHEN 'ASSIGNED' THEN 3
      END,
      p.updated_at ASC
  `;

  const packages = await allAsync(baseSql, params);
  return packages;
}

module.exports = {
  APPOINTMENT_STATUSES,
  CHANGE_TYPES,
  OPERATOR_TYPES,
  DELIVERY_PREFERENCES,
  VALID_STATUSES_FOR_APPOINTMENT,
  FINAL_STATUSES,
  createAppointment,
  updateAppointment,
  cancelAppointment,
  getAppointmentByPackageId,
  getAppointmentChangeLogs,
  getAppointmentSummaryForPackage,
  getPackagesWithAppointmentFilter,
  canModifyAppointment,
};
