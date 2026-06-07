const { runAsync, allAsync, getAsync, runInTransaction } = require('../db');
const { OPERATOR_TYPES } = require('./package_track');

const PAYMENT_METHODS = {
  CASH: 'CASH',
  SCAN: 'SCAN',
  WAIVED: 'WAIVED',
};

const VALID_PAYMENT_METHODS = Object.values(PAYMENT_METHODS);

const SETTLEMENT_STATUSES = {
  PENDING: 'PENDING',
  SETTLED: 'SETTLED',
};

async function createCodPayment({ package_id, courier_id, payment_method, amount, waived_reason, operator_type, operator_id, operator_name, remark }) {
  const pkg = await getAsync('SELECT * FROM package WHERE id = ?', [package_id]);
  if (!pkg) {
    const err = new Error('包裹不存在');
    err.statusCode = 404;
    throw err;
  }
  if (!pkg.is_cod) {
    const err = new Error('该包裹不是到付包裹，无需收款');
    err.statusCode = 400;
    throw err;
  }
  if (pkg.status === 'FAILED') {
    const err = new Error('该包裹已标记为派送失败，无法收款');
    err.statusCode = 400;
    throw err;
  }
  if (pkg.status === 'DELIVERED') {
    const err = new Error('该包裹已签收，无法重复收款');
    err.statusCode = 400;
    throw err;
  }
  if (pkg.status === 'CREATED' || pkg.status === 'ASSIGNED') {
    const err = new Error('该包裹尚未开始派送，无法收款');
    err.statusCode = 400;
    throw err;
  }
  if (!pkg.courier_id) {
    const err = new Error('该包裹尚未分配快递小哥');
    err.statusCode = 400;
    throw err;
  }
  if (pkg.courier_id !== courier_id) {
    const err = new Error('只有负责派送该包裹的快递小哥才能收款');
    err.statusCode = 403;
    throw err;
  }
  const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [courier_id]);
  if (!courier) {
    const err = new Error('快递小哥不存在');
    err.statusCode = 404;
    throw err;
  }
  if (!VALID_PAYMENT_METHODS.includes(payment_method)) {
    const err = new Error(`无效的收款方式，可选值: ${VALID_PAYMENT_METHODS.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }
  const existing = await getAsync('SELECT id FROM cod_payment WHERE package_id = ?', [package_id]);
  if (existing) {
    const err = new Error('该包裹已完成收款，不可重复收款');
    err.statusCode = 400;
    throw err;
  }

  const finalAmount = payment_method === PAYMENT_METHODS.WAIVED ? 0 : Number(amount);
  if (payment_method !== PAYMENT_METHODS.WAIVED && finalAmount <= 0) {
    const err = new Error('收款金额必须大于0');
    err.statusCode = 400;
    throw err;
  }
  if (payment_method !== PAYMENT_METHODS.WAIVED && finalAmount !== Number(pkg.cod_amount)) {
    const err = new Error(`收款金额与应收金额不符，应收金额: ${pkg.cod_amount}`);
    err.statusCode = 400;
    throw err;
  }
  if (payment_method === PAYMENT_METHODS.WAIVED && !waived_reason) {
    const err = new Error('免收必须填写免收原因');
    err.statusCode = 400;
    throw err;
  }
  if (!operator_type || !Object.values(OPERATOR_TYPES).includes(operator_type)) {
    const err = new Error(`无效的操作者类型，可选值: ${Object.values(OPERATOR_TYPES).join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const paymentId = await runInTransaction(async () => {
    const result = await runAsync(
      `INSERT INTO cod_payment (package_id, courier_id, payment_method, amount, waived_reason, operator_type, operator_id, operator_name, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [package_id, courier_id, payment_method, finalAmount, waived_reason || null, operator_type, operator_id || null, operator_name || null, remark || null]
    );
    return result.lastID;
  });

  const payment = await getAsync(
    `SELECT cp.*, p.tracking_no, p.receiver_name, p.receiver_phone, p.cod_amount,
     c.name as courier_name, c.phone as courier_phone
     FROM cod_payment cp
     LEFT JOIN package p ON cp.package_id = p.id
     LEFT JOIN courier c ON cp.courier_id = c.id
     WHERE cp.id = ?`,
    [paymentId]
  );
  return payment;
}

async function getCodPaymentByPackageId(packageId) {
  return getAsync(
    `SELECT cp.*, p.tracking_no, p.receiver_name, p.receiver_phone, p.cod_amount,
     c.name as courier_name, c.phone as courier_phone
     FROM cod_payment cp
     LEFT JOIN package p ON cp.package_id = p.id
     LEFT JOIN courier c ON cp.courier_id = c.id
     WHERE cp.package_id = ?`,
    [packageId]
  );
}

async function listCodPayments({ courier_id, start_date, end_date, payment_method, site_id }) {
  let sql = `SELECT cp.*, p.tracking_no, p.receiver_name, p.receiver_phone, p.cod_amount, p.site_id,
             c.name as courier_name, c.phone as courier_phone,
             s.name as site_name
             FROM cod_payment cp
             LEFT JOIN package p ON cp.package_id = p.id
             LEFT JOIN courier c ON cp.courier_id = c.id
             LEFT JOIN site s ON p.site_id = s.id
             WHERE 1=1`;
  const params = [];

  if (courier_id) {
    sql += ' AND cp.courier_id = ?';
    params.push(courier_id);
  }
  if (start_date) {
    sql += ' AND date(cp.created_at) >= date(?)';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND date(cp.created_at) <= date(?)';
    params.push(end_date);
  }
  if (payment_method) {
    sql += ' AND cp.payment_method = ?';
    params.push(payment_method);
  }
  if (site_id) {
    sql += ' AND p.site_id = ?';
    params.push(site_id);
  }

  sql += ' ORDER BY cp.created_at DESC';
  return allAsync(sql, params);
}

async function getCourierDailyCodSummary(courierId, date = null) {
  let dateCondition, dateParams;
  if (date) {
    dateCondition = 'date(cp.created_at) = date(?)';
    dateParams = [date];
  } else {
    dateCondition = "date(cp.created_at) = date('now','localtime')";
    dateParams = [];
  }

  const summary = await getAsync(
    `SELECT
       COUNT(*) as total_packages,
       COALESCE(SUM(CASE WHEN cp.payment_method = 'CASH' THEN cp.amount ELSE 0 END), 0) as cash_amount,
       COALESCE(SUM(CASE WHEN cp.payment_method = 'SCAN' THEN cp.amount ELSE 0 END), 0) as scan_amount,
       COALESCE(SUM(CASE WHEN cp.payment_method = 'WAIVED' THEN p.cod_amount ELSE 0 END), 0) as waived_amount,
       COALESCE(SUM(cp.amount), 0) as total_collected,
       COALESCE(SUM(p.cod_amount), 0) as total_due
     FROM cod_payment cp
     LEFT JOIN package p ON cp.package_id = p.id
     WHERE cp.courier_id = ? AND ${dateCondition}`,
    [courierId, ...dateParams]
  );

  const methodBreakdown = await allAsync(
    `SELECT cp.payment_method, COUNT(*) as count, COALESCE(SUM(cp.amount), 0) as amount
     FROM cod_payment cp
     WHERE cp.courier_id = ? AND ${dateCondition}
     GROUP BY cp.payment_method`,
    [courierId, ...dateParams]
  );

  return {
    date: date || new Date().toISOString().split('T')[0],
    courier_id: Number(courierId),
    ...summary,
    method_breakdown: methodBreakdown,
  };
}

async function getCodSettlementReport({ courier_id, site_id, start_date, end_date }) {
  let sql = `SELECT
               date(cp.created_at) as settlement_date,
               cp.courier_id,
               c.name as courier_name,
               p.site_id,
               s.name as site_name,
               COUNT(*) as total_packages,
               COALESCE(SUM(p.cod_amount), 0) as total_cod_amount,
               COALESCE(SUM(CASE WHEN cp.payment_method = 'CASH' THEN cp.amount ELSE 0 END), 0) as cash_amount,
               COALESCE(SUM(CASE WHEN cp.payment_method = 'SCAN' THEN cp.amount ELSE 0 END), 0) as scan_amount,
               COALESCE(SUM(CASE WHEN cp.payment_method = 'WAIVED' THEN p.cod_amount ELSE 0 END), 0) as waived_amount,
               COALESCE(SUM(cp.amount), 0) as total_collected
             FROM cod_payment cp
             LEFT JOIN package p ON cp.package_id = p.id
             LEFT JOIN courier c ON cp.courier_id = c.id
             LEFT JOIN site s ON p.site_id = s.id
             WHERE 1=1`;
  const params = [];

  if (courier_id) {
    sql += ' AND cp.courier_id = ?';
    params.push(courier_id);
  }
  if (site_id) {
    sql += ' AND p.site_id = ?';
    params.push(site_id);
  }
  if (start_date) {
    sql += ' AND date(cp.created_at) >= date(?)';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND date(cp.created_at) <= date(?)';
    params.push(end_date);
  }

  sql += ' GROUP BY date(cp.created_at), cp.courier_id, p.site_id ORDER BY settlement_date DESC, cp.courier_id ASC, p.site_id ASC';
  return allAsync(sql, params);
}

async function getPendingCodPackagesForCourier(courierId) {
  return allAsync(
    `SELECT p.*, c.name as courier_name, c.phone as courier_phone,
            s.name as site_name, dz.name as zone_name
     FROM package p
     LEFT JOIN courier c ON p.courier_id = c.id
     LEFT JOIN site s ON p.site_id = s.id
     LEFT JOIN delivery_zone dz ON p.zone_id = dz.id
     LEFT JOIN cod_payment cp ON p.id = cp.package_id
     WHERE p.courier_id = ?
       AND p.is_cod = 1
       AND p.status IN ('PICKED_UP', 'DELIVERING')
       AND cp.id IS NULL
     ORDER BY p.updated_at ASC`,
    [courierId]
  );
}

module.exports = {
  PAYMENT_METHODS,
  VALID_PAYMENT_METHODS,
  SETTLEMENT_STATUSES,
  createCodPayment,
  getCodPaymentByPackageId,
  listCodPayments,
  getCourierDailyCodSummary,
  getCodSettlementReport,
  getPendingCodPackagesForCourier,
};
