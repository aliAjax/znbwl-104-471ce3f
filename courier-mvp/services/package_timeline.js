const { allAsync, getAsync } = require('../db');

const EVENT_TYPES = {
  PACKAGE_CREATED: 'PACKAGE_CREATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  APPOINTMENT_CREATED: 'APPOINTMENT_CREATED',
  APPOINTMENT_UPDATED: 'APPOINTMENT_UPDATED',
  APPOINTMENT_CANCELLED: 'APPOINTMENT_CANCELLED',
  EXCEPTION_CREATED: 'EXCEPTION_CREATED',
  EXCEPTION_STATUS_UPDATED: 'EXCEPTION_STATUS_UPDATED',
  DELIVERY_RECEIPT: 'DELIVERY_RECEIPT',
  COD_PAYMENT: 'COD_PAYMENT',
};

const EVENT_TYPE_ORDER = {
  [EVENT_TYPES.PACKAGE_CREATED]: 0,
  [EVENT_TYPES.STATUS_CHANGED]: 1,
  [EVENT_TYPES.APPOINTMENT_CREATED]: 2,
  [EVENT_TYPES.APPOINTMENT_UPDATED]: 3,
  [EVENT_TYPES.APPOINTMENT_CANCELLED]: 4,
  [EVENT_TYPES.EXCEPTION_CREATED]: 5,
  [EVENT_TYPES.EXCEPTION_STATUS_UPDATED]: 6,
  [EVENT_TYPES.COD_PAYMENT]: 7,
  [EVENT_TYPES.DELIVERY_RECEIPT]: 8,
};

function parseJsonSafely(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function formatOperator(operatorType, operatorName, operatorId) {
  if (operatorName) {
    return operatorName;
  }
  if (operatorType === 'SYSTEM') {
    return '系统';
  }
  if (operatorType === 'ADMIN') {
    return '管理员';
  }
  if (operatorType === 'COURIER') {
    return `快递员(ID:${operatorId || '-'})`;
  }
  if (operatorType === 'RECEIVER') {
    return `收件人(ID:${operatorId || '-'})`;
  }
  if (operatorType === 'SITE') {
    return '站点';
  }
  return operatorType || '未知';
}

function generateSummary(eventType, data) {
  switch (eventType) {
    case EVENT_TYPES.PACKAGE_CREATED:
      return '包裹创建';
    case EVENT_TYPES.STATUS_CHANGED:
      return `状态变更: ${data.old_status || '-'} → ${data.new_status || '-'}`;
    case EVENT_TYPES.APPOINTMENT_CREATED: {
      const newValues = parseJsonSafely(data.new_values);
      if (newValues) {
        return `创建预约: ${newValues.appointment_start || '-'} ~ ${newValues.appointment_end || '-'}`;
      }
      return '创建预约';
    }
    case EVENT_TYPES.APPOINTMENT_UPDATED: {
      const newValues = parseJsonSafely(data.new_values);
      if (newValues) {
        return `修改预约: ${newValues.appointment_start || '-'} ~ ${newValues.appointment_end || '-'}`;
      }
      return '修改预约';
    }
    case EVENT_TYPES.APPOINTMENT_CANCELLED:
      return data.change_reason || '取消预约';
    case EVENT_TYPES.EXCEPTION_CREATED:
      return `登记异常: ${data.exception_type}${data.description ? ` - ${data.description}` : ''}`;
    case EVENT_TYPES.EXCEPTION_STATUS_UPDATED:
      return `异常状态变更: ${data.old_status || '-'} → ${data.new_status || '-'}`;
    case EVENT_TYPES.DELIVERY_RECEIPT:
      return `包裹签收: ${data.sign_method}, 签收人: ${data.signer_name}`;
    case EVENT_TYPES.COD_PAYMENT: {
      if (data.payment_method === 'WAIVED') {
        return `COD免收: ${data.waived_reason || '免收'}`;
      }
      return `COD收款: ¥${data.amount} (${data.payment_method})`;
    }
    default:
      return '-';
  }
}

async function getPackageTimeline(packageId) {
  if (!packageId) {
    const err = new Error('包裹ID不能为空');
    err.statusCode = 400;
    throw err;
  }

  const pkg = await getAsync('SELECT * FROM package WHERE id = ?', [packageId]);
  if (!pkg) {
    const err = new Error('包裹不存在');
    err.statusCode = 404;
    throw err;
  }

  const [tracks, appointmentLogs, exceptions, receipt, codPayment] = await Promise.all([
    allAsync(
      `SELECT pt.*, c.name as courier_name
       FROM package_track pt
       LEFT JOIN courier c ON pt.operator_id = c.id AND pt.operator_type = 'COURIER'
       WHERE pt.package_id = ?
       ORDER BY pt.created_at ASC, pt.id ASC`,
      [packageId]
    ),
    allAsync(
      `SELECT * FROM delivery_appointment_change_log
       WHERE package_id = ?
       ORDER BY created_at ASC, id ASC`,
      [packageId]
    ),
    allAsync(
      `SELECT * FROM exception_record
       WHERE package_id = ?
       ORDER BY created_at ASC, id ASC`,
      [packageId]
    ),
    getAsync(
      `SELECT dr.*, c.name as courier_name
       FROM delivery_receipt dr
       LEFT JOIN courier c ON dr.courier_id = c.id
       WHERE dr.package_id = ?`,
      [packageId]
    ),
    getAsync(
      `SELECT cp.*, c.name as courier_name
       FROM cod_payment cp
       LEFT JOIN courier c ON cp.courier_id = c.id
       WHERE cp.package_id = ?`,
      [packageId]
    ),
  ]);

  const events = [];

  for (const track of tracks) {
    const isCreated = track.old_status === null && track.new_status === 'CREATED';
    events.push({
      event_id: `track_${track.id}`,
      event_type: isCreated ? EVENT_TYPES.PACKAGE_CREATED : EVENT_TYPES.STATUS_CHANGED,
      occurred_at: track.created_at,
      operator: formatOperator(track.operator_type, track.operator_name || track.courier_name, track.operator_id),
      operator_type: track.operator_type,
      operator_id: track.operator_id,
      summary: track.remark || generateSummary(isCreated ? EVENT_TYPES.PACKAGE_CREATED : EVENT_TYPES.STATUS_CHANGED, track),
      raw_data_id: track.id,
      raw_data_type: 'package_track',
      details: {
        old_status: track.old_status,
        new_status: track.new_status,
        remark: track.remark,
      },
    });
  }

  if (tracks.length === 0) {
    events.push({
      event_id: `legacy_created_${packageId}`,
      event_type: EVENT_TYPES.PACKAGE_CREATED,
      occurred_at: pkg.created_at,
      operator: formatOperator('SYSTEM', null, null),
      operator_type: 'SYSTEM',
      operator_id: null,
      summary: '包裹创建（历史数据）',
      raw_data_id: packageId,
      raw_data_type: 'package',
      details: {
        old_status: null,
        new_status: pkg.status,
      },
    });

    const statusTransitions = [
      { from: 'CREATED', to: 'ASSIGNED', label: '分配快递员' },
      { from: 'ASSIGNED', to: 'PICKED_UP', label: '已揽收' },
      { from: 'PICKED_UP', to: 'DELIVERING', label: '开始派送' },
      { from: 'DELIVERING', to: 'DELIVERED', label: '已签收' },
      { from: 'DELIVERING', to: 'FAILED', label: '派送失败' },
    ];

    for (let i = 0; i < statusTransitions.length - 1; i++) {
      const transition = statusTransitions[i];
      if (pkg.status === transition.to || i > statusTransitions.findIndex(t => t.to === pkg.status)) {
        events.push({
          event_id: `legacy_status_${packageId}_${transition.to}`,
          event_type: EVENT_TYPES.STATUS_CHANGED,
          occurred_at: pkg.updated_at,
          operator: formatOperator('SYSTEM', null, null),
          operator_type: 'SYSTEM',
          operator_id: null,
          summary: `${transition.label}（历史数据）`,
          raw_data_id: packageId,
          raw_data_type: 'package',
          details: {
            old_status: transition.from,
            new_status: transition.to,
          },
        });
        break;
      }
    }
  }

  for (const log of appointmentLogs) {
    let eventType;
    if (log.change_type === 'CREATE') {
      eventType = EVENT_TYPES.APPOINTMENT_CREATED;
    } else if (log.change_type === 'UPDATE') {
      eventType = EVENT_TYPES.APPOINTMENT_UPDATED;
    } else if (log.change_type === 'CANCEL') {
      eventType = EVENT_TYPES.APPOINTMENT_CANCELLED;
    } else {
      eventType = EVENT_TYPES.APPOINTMENT_UPDATED;
    }

    events.push({
      event_id: `appt_log_${log.id}`,
      event_type: eventType,
      occurred_at: log.created_at,
      operator: formatOperator(log.operator_type, log.operator_name, log.operator_id),
      operator_type: log.operator_type,
      operator_id: log.operator_id,
      summary: log.change_reason || generateSummary(eventType, log),
      raw_data_id: log.id,
      raw_data_type: 'delivery_appointment_change_log',
      details: {
        appointment_id: log.appointment_id,
        change_type: log.change_type,
        old_values: parseJsonSafely(log.old_values),
        new_values: parseJsonSafely(log.new_values),
        change_reason: log.change_reason,
      },
    });
  }

  for (const exc of exceptions) {
    events.push({
      event_id: `exc_${exc.id}`,
      event_type: EVENT_TYPES.EXCEPTION_CREATED,
      occurred_at: exc.created_at,
      operator: formatOperator('COURIER', exc.courier_name, exc.courier_id),
      operator_type: 'COURIER',
      operator_id: exc.courier_id,
      summary: generateSummary(EVENT_TYPES.EXCEPTION_CREATED, exc),
      raw_data_id: exc.id,
      raw_data_type: 'exception_record',
      details: {
        exception_type: exc.exception_type,
        description: exc.description,
        on_site_remark: exc.on_site_remark,
        status: exc.status,
      },
    });

    if (exc.created_at !== exc.updated_at) {
      events.push({
        event_id: `exc_status_${exc.id}`,
        event_type: EVENT_TYPES.EXCEPTION_STATUS_UPDATED,
        occurred_at: exc.updated_at,
        operator: formatOperator('SYSTEM', null, null),
        operator_type: 'SYSTEM',
        operator_id: null,
        summary: `异常状态更新: ${exc.status}`,
        raw_data_id: exc.id,
        raw_data_type: 'exception_record',
        details: {
          exception_id: exc.id,
          old_status: 'PENDING',
          new_status: exc.status,
        },
      });
    }
  }

  if (receipt) {
    events.push({
      event_id: `receipt_${receipt.id}`,
      event_type: EVENT_TYPES.DELIVERY_RECEIPT,
      occurred_at: receipt.sign_time || receipt.created_at,
      operator: formatOperator('COURIER', receipt.courier_name, receipt.courier_id),
      operator_type: 'COURIER',
      operator_id: receipt.courier_id,
      summary: generateSummary(EVENT_TYPES.DELIVERY_RECEIPT, receipt),
      raw_data_id: receipt.id,
      raw_data_type: 'delivery_receipt',
      details: {
        signer_name: receipt.signer_name,
        sign_method: receipt.sign_method,
        sign_time: receipt.sign_time,
      },
    });
  }

  if (codPayment) {
    events.push({
      event_id: `cod_${codPayment.id}`,
      event_type: EVENT_TYPES.COD_PAYMENT,
      occurred_at: codPayment.created_at,
      operator: formatOperator(codPayment.operator_type, codPayment.operator_name || codPayment.courier_name, codPayment.operator_id),
      operator_type: codPayment.operator_type,
      operator_id: codPayment.operator_id,
      summary: generateSummary(EVENT_TYPES.COD_PAYMENT, codPayment),
      raw_data_id: codPayment.id,
      raw_data_type: 'cod_payment',
      details: {
        payment_method: codPayment.payment_method,
        amount: codPayment.amount,
        waived_reason: codPayment.waived_reason,
        remark: codPayment.remark,
      },
    });
  }

  events.sort((a, b) => {
    const timeA = new Date(a.occurred_at).getTime();
    const timeB = new Date(b.occurred_at).getTime();
    
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    
    const orderA = EVENT_TYPE_ORDER[a.event_type] ?? 99;
    const orderB = EVENT_TYPE_ORDER[b.event_type] ?? 99;
    
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    
    const idA = parseInt(a.raw_data_id) || 0;
    const idB = parseInt(b.raw_data_id) || 0;
    return idA - idB;
  });

  return events;
}

module.exports = {
  EVENT_TYPES,
  getPackageTimeline,
};
