const { allAsync, getAsync, runAsync } = require('../db');

const STATUS_CATEGORIES = {
  pending_pickup: ['ASSIGNED', 'PICKED_UP'],
  delivering: ['DELIVERING'],
  completed: ['DELIVERED'],
  failed: ['FAILED'],
};

async function getCourierDailyStats(courierId) {
  const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [courierId]);
  if (!courier) {
    const err = new Error('快递小哥不存在');
    err.statusCode = 404;
    throw err;
  }

  const stats = {};
  for (const [key, statuses] of Object.entries(STATUS_CATEGORIES)) {
    const placeholders = statuses.map(() => '?').join(',');
    const row = await getAsync(
      `SELECT COUNT(*) as count FROM package
       WHERE courier_id = ? AND status IN (${placeholders})
       AND date(updated_at) = date('now', 'localtime')`,
      [courierId, ...statuses]
    );
    stats[key] = row.count;
  }

  return stats;
}

async function getCourierPendingPackages(courierId) {
  const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [courierId]);
  if (!courier) {
    const err = new Error('快递小哥不存在');
    err.statusCode = 404;
    throw err;
  }

  const packages = await allAsync(
    `SELECT p.*, c.name as courier_name, c.phone as courier_phone
     FROM package p
     LEFT JOIN courier c ON p.courier_id = c.id
     WHERE p.courier_id = ? AND p.status IN ('ASSIGNED', 'PICKED_UP', 'DELIVERING')
     AND date(p.updated_at) = date('now', 'localtime')
     ORDER BY
       CASE p.status
         WHEN 'DELIVERING' THEN 1
         WHEN 'PICKED_UP' THEN 2
         WHEN 'ASSIGNED' THEN 3
       END,
       p.updated_at ASC`,
    [courierId]
  );

  return packages;
}

async function getCourierDashboard(courierId) {
  const [stats, pendingPackages] = await Promise.all([
    getCourierDailyStats(courierId),
    getCourierPendingPackages(courierId),
  ]);

  return {
    courier_id: Number(courierId),
    today_stats: stats,
    pending_packages: pendingPackages,
  };
}

async function batchAssignPackages(packageIds, courierId) {
  const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [courierId]);
  if (!courier) {
    const err = new Error('快递小哥不存在');
    err.statusCode = 404;
    throw err;
  }
  if (courier.status !== 'ON_DUTY') {
    const err = new Error('该快递小哥当前不在岗，无法分配');
    err.statusCode = 400;
    throw err;
  }

  const results = [];
  for (const packageId of packageIds) {
    try {
      const pkg = await getAsync('SELECT * FROM package WHERE id = ?', [packageId]);
      if (!pkg) {
        results.push({ package_id: packageId, success: false, reason: '包裹不存在' });
        continue;
      }
      if (pkg.status !== 'CREATED') {
        results.push({ package_id: packageId, success: false, reason: `包裹当前状态为 ${pkg.status}，只有 CREATED 状态的包裹可以分配` });
        continue;
      }
      if (pkg.courier_id) {
        results.push({ package_id: packageId, success: false, reason: '包裹已被分配给其他快递小哥' });
        continue;
      }
      await runAsync(
        `UPDATE package SET courier_id = ?, status = 'ASSIGNED', updated_at = datetime('now','localtime') WHERE id = ?`,
        [courierId, packageId]
      );
      const updated = await getAsync('SELECT * FROM package WHERE id = ?', [packageId]);
      results.push({ package_id: packageId, success: true, data: updated });
    } catch (err) {
      results.push({ package_id: packageId, success: false, reason: `分配失败: ${err.message}` });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    courier_id: Number(courierId),
    total: packageIds.length,
    succeeded,
    failed,
    details: results,
  };
}

module.exports = {
  getCourierDailyStats,
  getCourierPendingPackages,
  getCourierDashboard,
  batchAssignPackages,
};
