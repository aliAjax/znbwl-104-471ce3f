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

const COD_PAYMENT_STATUSES = {
  UNPAID: 'UNPAID',
  PAID: 'PAID',
  WAIVED: 'WAIVED',
};

const VALID_COD_PAYMENT_STATUSES = Object.values(COD_PAYMENT_STATUSES);

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

async function calculateDailySettlementDataBySite(courierId, settlementDate, siteId = null) {
  const siteCondition = siteId ? 'AND p.site_id = ?' : '';
  const siteParams = siteId ? [siteId] : [];

  const paidStatsBySite = await allAsync(
    `SELECT
       p.site_id,
       s.name as site_name,
       COUNT(*) as paid_packages,
       COALESCE(SUM(CASE WHEN cp.payment_method = 'CASH' THEN cp.amount ELSE 0 END), 0) as cash_amount,
       COALESCE(SUM(CASE WHEN cp.payment_method = 'SCAN' THEN cp.amount ELSE 0 END), 0) as scan_amount,
       COALESCE(SUM(CASE WHEN cp.payment_method = 'WAIVED' THEN p.cod_amount ELSE 0 END), 0) as waived_amount,
       COALESCE(SUM(cp.amount), 0) as total_collected,
       COALESCE(SUM(p.cod_amount), 0) as total_paid_cod_amount
     FROM cod_payment cp
     LEFT JOIN package p ON cp.package_id = p.id
     LEFT JOIN site s ON p.site_id = s.id
     WHERE cp.courier_id = ? AND date(cp.created_at) = date(?) ${siteCondition}
     GROUP BY p.site_id, s.name`,
    [courierId, settlementDate, ...siteParams]
  );

  const unpaidStatsBySite = await allAsync(
    `SELECT
       p.site_id,
       s.name as site_name,
       COUNT(*) as unpaid_packages,
       COALESCE(SUM(p.cod_amount), 0) as total_unpaid_cod_amount
     FROM package p
     LEFT JOIN cod_payment cp ON p.id = cp.package_id
     LEFT JOIN site s ON p.site_id = s.id
     WHERE p.courier_id = ?
       AND p.is_cod = 1
       AND cp.id IS NULL
       AND date(p.updated_at) = date(?)
       ${siteCondition}
     GROUP BY p.site_id, s.name`,
    [courierId, settlementDate, ...siteParams]
  );

  const siteMap = {};

  for (const stat of paidStatsBySite) {
    const key = stat.site_id || 'null';
    if (!siteMap[key]) {
      siteMap[key] = {
        site_id: stat.site_id,
        site_name: stat.site_name,
        paid_packages: 0,
        unpaid_packages: 0,
        cash_amount: 0,
        scan_amount: 0,
        waived_amount: 0,
        total_paid_cod_amount: 0,
        total_unpaid_cod_amount: 0,
      };
    }
    siteMap[key].paid_packages += stat.paid_packages;
    siteMap[key].cash_amount += stat.cash_amount;
    siteMap[key].scan_amount += stat.scan_amount;
    siteMap[key].waived_amount += stat.waived_amount;
    siteMap[key].total_paid_cod_amount += stat.total_paid_cod_amount;
  }

  for (const stat of unpaidStatsBySite) {
    const key = stat.site_id || 'null';
    if (!siteMap[key]) {
      siteMap[key] = {
        site_id: stat.site_id,
        site_name: stat.site_name,
        paid_packages: 0,
        unpaid_packages: 0,
        cash_amount: 0,
        scan_amount: 0,
        waived_amount: 0,
        total_paid_cod_amount: 0,
        total_unpaid_cod_amount: 0,
      };
    }
    siteMap[key].unpaid_packages += stat.unpaid_packages;
    siteMap[key].total_unpaid_cod_amount += stat.total_unpaid_cod_amount;
  }

  const results = Object.values(siteMap).map(data => ({
    settlement_date: settlementDate,
    courier_id: courierId,
    site_id: data.site_id,
    site_name: data.site_name,
    total_cod_packages: data.paid_packages + data.unpaid_packages,
    total_cod_amount: data.total_paid_cod_amount + data.total_unpaid_cod_amount,
    cash_amount: data.cash_amount,
    scan_amount: data.scan_amount,
    waived_amount: data.waived_amount,
    settled_packages: data.paid_packages,
    unsettled_packages: data.unpaid_packages,
  }));

  if (siteId && results.length === 0) {
    const siteInfo = await getAsync('SELECT name FROM site WHERE id = ?', [siteId]);
    return [{
      settlement_date: settlementDate,
      courier_id: courierId,
      site_id: siteId,
      site_name: siteInfo ? siteInfo.name : null,
      total_cod_packages: 0,
      total_cod_amount: 0,
      cash_amount: 0,
      scan_amount: 0,
      waived_amount: 0,
      settled_packages: 0,
      unsettled_packages: 0,
    }];
  }

  return results;
}

async function generateDailySettlement({ courier_id, settlement_date, site_id, operator_name }) {
  const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [courier_id]);
  if (!courier) {
    const err = new Error('快递小哥不存在');
    err.statusCode = 404;
    throw err;
  }

  if (site_id) {
    const site = await getAsync('SELECT * FROM site WHERE id = ?', [site_id]);
    if (!site) {
      const err = new Error('站点不存在');
      err.statusCode = 404;
      throw err;
    }
  }

  const settlementDate = settlement_date || new Date().toISOString().split('T')[0];

  const settlementDataList = await calculateDailySettlementDataBySite(courier_id, settlementDate, site_id);

  const results = [];

  for (const settlementData of settlementDataList) {
    const existingSettlement = await getAsync(
      'SELECT id FROM cod_daily_settlement WHERE settlement_date = date(?) AND courier_id = ? AND (site_id = ? OR (site_id IS NULL AND ? IS NULL))',
      [settlementDate, courier_id, settlementData.site_id, settlementData.site_id]
    );

    let settlementId;
    if (existingSettlement) {
      await runAsync(
        `UPDATE cod_daily_settlement SET
           total_cod_packages = ?,
           total_cod_amount = ?,
           cash_amount = ?,
           scan_amount = ?,
           waived_amount = ?,
           settled_packages = ?,
           unsettled_packages = ?,
           updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [
          settlementData.total_cod_packages,
          settlementData.total_cod_amount,
          settlementData.cash_amount,
          settlementData.scan_amount,
          settlementData.waived_amount,
          settlementData.settled_packages,
          settlementData.unsettled_packages,
          existingSettlement.id,
        ]
      );
      settlementId = existingSettlement.id;
    } else {
      const result = await runAsync(
        `INSERT INTO cod_daily_settlement (
           settlement_date, courier_id, site_id,
           total_cod_packages, total_cod_amount,
           cash_amount, scan_amount, waived_amount,
           settled_packages, unsettled_packages, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GENERATED')`,
        [
          settlementDate,
          courier_id,
          settlementData.site_id,
          settlementData.total_cod_packages,
          settlementData.total_cod_amount,
          settlementData.cash_amount,
          settlementData.scan_amount,
          settlementData.waived_amount,
          settlementData.settled_packages,
          settlementData.unsettled_packages,
        ]
      );
      settlementId = result.lastID;
    }

    const saved = await getDailySettlementById(settlementId);
    results.push(saved);
  }

  return results;
}

async function getDailySettlementById(id) {
  return getAsync(
    `SELECT ds.*, c.name as courier_name, c.phone as courier_phone, s.name as site_name
     FROM cod_daily_settlement ds
     LEFT JOIN courier c ON ds.courier_id = c.id
     LEFT JOIN site s ON ds.site_id = s.id
     WHERE ds.id = ?`,
    [id]
  );
}

async function listDailySettlements({ courier_id, site_id, start_date, end_date, status }) {
  let sql = `SELECT ds.*, c.name as courier_name, c.phone as courier_phone, s.name as site_name
             FROM cod_daily_settlement ds
             LEFT JOIN courier c ON ds.courier_id = c.id
             LEFT JOIN site s ON ds.site_id = s.id
             WHERE 1=1`;
  const params = [];

  if (courier_id) {
    sql += ' AND ds.courier_id = ?';
    params.push(courier_id);
  }
  if (site_id) {
    sql += ' AND ds.site_id = ?';
    params.push(site_id);
  }
  if (start_date) {
    sql += ' AND date(ds.settlement_date) >= date(?)';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND date(ds.settlement_date) <= date(?)';
    params.push(end_date);
  }
  if (status) {
    sql += ' AND ds.status = ?';
    params.push(status);
  }

  sql += ' ORDER BY ds.settlement_date DESC, ds.courier_id ASC, ds.site_id ASC';
  return allAsync(sql, params);
}

async function getDailySettlementDetail(id) {
  const settlement = await getDailySettlementById(id);
  if (!settlement) {
    const err = new Error('日结单不存在');
    err.statusCode = 404;
    throw err;
  }

  const siteCondition = settlement.site_id ? 'AND p.site_id = ?' : 'AND p.site_id IS NULL';
  const siteParams = settlement.site_id ? [settlement.site_id] : [];

  const paidPackages = await allAsync(
    `SELECT cp.*, p.tracking_no, p.receiver_name, p.receiver_phone, p.cod_amount
     FROM cod_payment cp
     LEFT JOIN package p ON cp.package_id = p.id
     WHERE cp.courier_id = ? AND date(cp.created_at) = date(?) ${siteCondition}
     ORDER BY cp.created_at DESC`,
    [settlement.courier_id, settlement.settlement_date, ...siteParams]
  );

  const unpaidPackages = await allAsync(
    `SELECT p.*
     FROM package p
     LEFT JOIN cod_payment cp ON p.id = cp.package_id
     WHERE p.courier_id = ?
       AND p.is_cod = 1
       AND cp.id IS NULL
       AND date(p.updated_at) = date(?)
       ${siteCondition}
     ORDER BY p.updated_at DESC`,
    [settlement.courier_id, settlement.settlement_date, ...siteParams]
  );

  return {
    ...settlement,
    paid_packages: paidPackages,
    unpaid_packages: unpaidPackages,
  };
}

module.exports = {
  PAYMENT_METHODS,
  VALID_PAYMENT_METHODS,
  SETTLEMENT_STATUSES,
  COD_PAYMENT_STATUSES,
  VALID_COD_PAYMENT_STATUSES,
  createCodPayment,
  getCodPaymentByPackageId,
  listCodPayments,
  getCourierDailyCodSummary,
  getCodSettlementReport,
  getPendingCodPackagesForCourier,
  generateDailySettlement,
  getDailySettlementById,
  listDailySettlements,
  getDailySettlementDetail,
};
