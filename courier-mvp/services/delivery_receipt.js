const { runAsync, allAsync, getAsync } = require('../db');

const VALID_SIGN_METHODS = [
  'PERSONAL_SIGN',
  'AGENT_SIGN',
  'CODE_SIGN',
  'SMART_CABINET',
];

async function createDeliveryReceipt({ package_id, courier_id, signer_name, sign_method, sign_time }) {
  const pkg = await getAsync('SELECT * FROM package WHERE id = ?', [package_id]);
  if (!pkg) {
    const err = new Error('包裹不存在');
    err.statusCode = 404;
    throw err;
  }
  if (pkg.status !== 'DELIVERING') {
    const err = new Error('只有派送中的包裹才能提交签收凭证');
    err.statusCode = 400;
    throw err;
  }
  if (!pkg.courier_id) {
    const err = new Error('该包裹尚未分配快递小哥');
    err.statusCode = 400;
    throw err;
  }
  if (pkg.courier_id !== courier_id) {
    const err = new Error('只有负责派送该包裹的快递小哥才能提交签收凭证');
    err.statusCode = 403;
    throw err;
  }
  const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [courier_id]);
  if (!courier) {
    const err = new Error('快递小哥不存在');
    err.statusCode = 404;
    throw err;
  }
  if (!VALID_SIGN_METHODS.includes(sign_method)) {
    const err = new Error(`无效的签收方式，可选值: ${VALID_SIGN_METHODS.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
  const existing = await getAsync('SELECT id FROM delivery_receipt WHERE package_id = ?', [package_id]);
  if (existing) {
    const err = new Error('该包裹已存在签收凭证，不可重复提交');
    err.statusCode = 400;
    throw err;
  }

  const result = await runAsync(
    `INSERT INTO delivery_receipt (package_id, courier_id, signer_name, sign_method, sign_time)
     VALUES (?, ?, ?, ?, ?)`,
    [package_id, courier_id, signer_name, sign_method, sign_time]
  );

  await runAsync(
    `UPDATE package SET status = 'DELIVERED', updated_at = datetime('now','localtime') WHERE id = ?`,
    [package_id]
  );

  const receipt = await getAsync('SELECT * FROM delivery_receipt WHERE id = ?', [result.lastID]);
  return receipt;
}

async function listDeliveryReceipts({ courier_id, package_id }) {
  let sql = `SELECT dr.*, p.tracking_no, p.receiver_name, p.receiver_phone,
             c.name as courier_name, c.phone as courier_phone
             FROM delivery_receipt dr
             LEFT JOIN package p ON dr.package_id = p.id
             LEFT JOIN courier c ON dr.courier_id = c.id
             WHERE 1=1`;
  const params = [];

  if (courier_id) {
    sql += ' AND dr.courier_id = ?';
    params.push(courier_id);
  }
  if (package_id) {
    sql += ' AND dr.package_id = ?';
    params.push(package_id);
  }

  sql += ' ORDER BY dr.created_at DESC';
  return allAsync(sql, params);
}

async function getDeliveryReceiptById(id) {
  const receipt = await getAsync(
    `SELECT dr.*, p.tracking_no, p.receiver_name, p.receiver_phone, p.receiver_address,
     c.name as courier_name, c.phone as courier_phone
     FROM delivery_receipt dr
     LEFT JOIN package p ON dr.package_id = p.id
     LEFT JOIN courier c ON dr.courier_id = c.id
     WHERE dr.id = ?`,
    [id]
  );
  if (!receipt) {
    const err = new Error('签收凭证不存在');
    err.statusCode = 404;
    throw err;
  }
  return receipt;
}

async function getDeliveryReceiptByPackageId(packageId) {
  return getAsync(
    `SELECT dr.*, c.name as courier_name, c.phone as courier_phone
     FROM delivery_receipt dr
     LEFT JOIN courier c ON dr.courier_id = c.id
     WHERE dr.package_id = ?`,
    [packageId]
  );
}

module.exports = {
  VALID_SIGN_METHODS,
  createDeliveryReceipt,
  listDeliveryReceipts,
  getDeliveryReceiptById,
  getDeliveryReceiptByPackageId,
};
