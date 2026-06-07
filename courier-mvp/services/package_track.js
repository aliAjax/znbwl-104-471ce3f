const { runAsync, allAsync, getAsync, runInTransaction } = require('../db');

const OPERATOR_TYPES = {
  SYSTEM: 'SYSTEM',
  COURIER: 'COURIER',
  ADMIN: 'ADMIN',
  SITE: 'SITE',
};

async function addPackageTrack({
  packageId,
  oldStatus,
  newStatus,
  operatorType,
  operatorId = null,
  operatorName = null,
  remark = null,
}) {
  if (!packageId) {
    throw new Error('包裹ID不能为空');
  }
  if (!newStatus) {
    throw new Error('新状态不能为空');
  }
  if (!operatorType || !Object.values(OPERATOR_TYPES).includes(operatorType)) {
    throw new Error(`操作者类型无效，可选值: ${Object.values(OPERATOR_TYPES).join(', ')}`);
  }

  const result = await runAsync(
    `INSERT INTO package_track (package_id, old_status, new_status, operator_type, operator_id, operator_name, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [packageId, oldStatus, newStatus, operatorType, operatorId, operatorName, remark]
  );

  return result.lastID;
}

async function getPackageTracks(packageId) {
  if (!packageId) {
    throw new Error('包裹ID不能为空');
  }

  const tracks = await allAsync(
    `SELECT pt.*, c.name as courier_name
     FROM package_track pt
     LEFT JOIN courier c ON pt.operator_id = c.id AND pt.operator_type = 'COURIER'
     WHERE pt.package_id = ?
     ORDER BY pt.created_at ASC, pt.id ASC`,
    [packageId]
  );

  return tracks;
}

async function _updatePackageStatusWithTrackInternal(
  packageId,
  newStatus,
  trackData = {},
  extraUpdates = {}
) {
  const pkg = await getAsync('SELECT * FROM package WHERE id = ?', [packageId]);
  if (!pkg) {
    const err = new Error('包裹不存在');
    err.statusCode = 404;
    throw err;
  }

  const oldStatus = pkg.status;

  if (oldStatus === newStatus) {
    return { package: pkg, trackId: null, statusUnchanged: true };
  }

  const updateFields = ['status = ?', 'updated_at = datetime(\'now\',\'localtime\')'];
  const updateParams = [newStatus];

  for (const [key, value] of Object.entries(extraUpdates)) {
    updateFields.push(`${key} = ?`);
    updateParams.push(value);
  }

  updateParams.push(packageId);

  await runAsync(
    `UPDATE package SET ${updateFields.join(', ')} WHERE id = ?`,
    updateParams
  );

  const trackId = await addPackageTrack({
    packageId,
    oldStatus,
    newStatus,
    ...trackData,
  });

  const updatedPackage = await getAsync(
    'SELECT p.*, c.name as courier_name, c.phone as courier_phone, s.name as site_name, dz.name as zone_name ' +
    'FROM package p ' +
    'LEFT JOIN courier c ON p.courier_id = c.id ' +
    'LEFT JOIN site s ON p.site_id = s.id ' +
    'LEFT JOIN delivery_zone dz ON p.zone_id = dz.id ' +
    'WHERE p.id = ?',
    [packageId]
  );

  return { package: updatedPackage, trackId, statusUnchanged: false };
}

async function updatePackageStatusWithTrack(
  packageId,
  newStatus,
  trackData = {},
  extraUpdates = {}
) {
  return runInTransaction(async () => {
    return _updatePackageStatusWithTrackInternal(packageId, newStatus, trackData, extraUpdates);
  });
}

module.exports = {
  OPERATOR_TYPES,
  addPackageTrack,
  getPackageTracks,
  updatePackageStatusWithTrack,
  _updatePackageStatusWithTrackInternal,
};
