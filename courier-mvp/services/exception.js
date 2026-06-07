const { runAsync, allAsync, getAsync, runInTransaction } = require('../db');
const { OPERATOR_TYPES, _updatePackageStatusWithTrackInternal } = require('./package_track');

const VALID_EXCEPTION_TYPES = [
  'REFUSED',
  'NOT_HOME',
  'ADDRESS_WRONG',
  'DAMAGED',
  'CONTACT_FAILED',
  'OTHER',
];

const VALID_EXCEPTION_STATUSES = ['PENDING', 'PROCESSING', 'RESOLVED', 'CLOSED'];

const STATUS_FLOW = {
  PENDING: ['PROCESSING', 'CLOSED'],
  PROCESSING: ['RESOLVED', 'CLOSED'],
  RESOLVED: [],
  CLOSED: [],
};

async function createException({ package_id, courier_id, exception_type, description, on_site_remark }) {
  const pkg = await getAsync('SELECT * FROM package WHERE id = ?', [package_id]);
  if (!pkg) {
    const err = new Error('包裹不存在');
    err.statusCode = 404;
    throw err;
  }
  const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [courier_id]);
  if (!courier) {
    const err = new Error('快递小哥不存在');
    err.statusCode = 404;
    throw err;
  }
  if (pkg.status !== 'DELIVERING') {
    const err = new Error('只有派送中的包裹才能登记异常件');
    err.statusCode = 400;
    throw err;
  }
  if (!pkg.courier_id) {
    const err = new Error('该包裹尚未分配快递小哥');
    err.statusCode = 400;
    throw err;
  }
  if (pkg.courier_id !== courier_id) {
    const err = new Error('只有负责派送该包裹的快递小哥才能登记异常件');
    err.statusCode = 403;
    throw err;
  }
  if (!VALID_EXCEPTION_TYPES.includes(exception_type)) {
    const err = new Error(`无效的异常类型，可选值: ${VALID_EXCEPTION_TYPES.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const recordId = await runInTransaction(async () => {
    const result = await runAsync(
      `INSERT INTO exception_record (package_id, courier_id, exception_type, description, on_site_remark, status)
       VALUES (?, ?, ?, ?, ?, 'PENDING')`,
      [package_id, courier_id, exception_type, description || null, on_site_remark || null]
    );

    await _updatePackageStatusWithTrackInternal(
      package_id,
      'FAILED',
      {
        operatorType: OPERATOR_TYPES.COURIER,
        operatorId: courier_id,
        operatorName: courier.name,
        remark: `登记异常: ${exception_type}${description ? ` - ${description}` : ''}`,
      }
    );

    return result.lastID;
  });

  const record = await getAsync('SELECT * FROM exception_record WHERE id = ?', [recordId]);
  return record;
}

async function listExceptions({ status, courier_id, package_id }) {
  let sql = `SELECT er.*, p.tracking_no, p.receiver_name, p.receiver_phone,
             c.name as courier_name, c.phone as courier_phone
             FROM exception_record er
             LEFT JOIN package p ON er.package_id = p.id
             LEFT JOIN courier c ON er.courier_id = c.id
             WHERE 1=1`;
  const params = [];

  if (status) {
    sql += ' AND er.status = ?';
    params.push(status);
  }
  if (courier_id) {
    sql += ' AND er.courier_id = ?';
    params.push(courier_id);
  }
  if (package_id) {
    sql += ' AND er.package_id = ?';
    params.push(package_id);
  }

  sql += ' ORDER BY er.created_at DESC';
  return allAsync(sql, params);
}

async function getExceptionById(id) {
  const record = await getAsync(
    `SELECT er.*, p.tracking_no, p.receiver_name, p.receiver_phone, p.receiver_address,
     c.name as courier_name, c.phone as courier_phone
     FROM exception_record er
     LEFT JOIN package p ON er.package_id = p.id
     LEFT JOIN courier c ON er.courier_id = c.id
     WHERE er.id = ?`,
    [id]
  );
  if (!record) {
    const err = new Error('异常记录不存在');
    err.statusCode = 404;
    throw err;
  }
  return record;
}

async function updateExceptionStatus(id, newStatus) {
  if (!VALID_EXCEPTION_STATUSES.includes(newStatus)) {
    const err = new Error(`无效的异常状态，可选值: ${VALID_EXCEPTION_STATUSES.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const record = await getAsync('SELECT * FROM exception_record WHERE id = ?', [id]);
  if (!record) {
    const err = new Error('异常记录不存在');
    err.statusCode = 404;
    throw err;
  }

  const allowedNext = STATUS_FLOW[record.status] || [];
  if (!allowedNext.includes(newStatus)) {
    const err = new Error(
      `异常记录当前状态为 ${record.status}，不允许变更为 ${newStatus}，允许的变更: ${allowedNext.length > 0 ? allowedNext.join(', ') : '无（已终态）'}`
    );
    err.statusCode = 400;
    throw err;
  }

  await runAsync(
    `UPDATE exception_record SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
    [newStatus, id]
  );

  return getAsync('SELECT * FROM exception_record WHERE id = ?', [id]);
}

module.exports = {
  VALID_EXCEPTION_TYPES,
  VALID_EXCEPTION_STATUSES,
  createException,
  listExceptions,
  getExceptionById,
  updateExceptionStatus,
};
