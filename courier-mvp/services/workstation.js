const { allAsync, getAsync } = require('../db');

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

module.exports = {
  getCourierDailyStats,
  getCourierPendingPackages,
  getCourierDashboard,
};
