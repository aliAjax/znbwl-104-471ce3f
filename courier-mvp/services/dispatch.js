const { allAsync, getAsync, runInTransaction } = require('../db');
const { isCourierOnDuty, getCourierUnfinishedPackageCount } = require('./workstation');
const { isCourierInZone, getZoneById } = require('./zone');
const { OPERATOR_TYPES, _updatePackageStatusWithTrackInternal } = require('./package_track');

const DISPATCH_RESULT_TYPES = {
  SUCCESS: 'SUCCESS',
  SKIPPED: 'SKIPPED',
  FAILED: 'FAILED',
  DATA_ERROR: 'DATA_ERROR',
};

async function getCourierWorkload(courierId) {
  const unfinished = await getCourierUnfinishedPackageCount(courierId);
  return {
    courier_id: courierId,
    unfinished_count: unfinished,
  };
}

async function getAvailableCouriersByZone(zoneId) {
  let couriers;
  if (zoneId) {
    couriers = await allAsync(
      `SELECT c.* FROM courier_zone cz
       LEFT JOIN courier c ON cz.courier_id = c.id
       WHERE cz.zone_id = ? AND c.status = 'ON_DUTY'`,
      [zoneId]
    );
  } else {
    couriers = await allAsync("SELECT * FROM courier WHERE status = 'ON_DUTY'");
  }

  const couriersWithWorkload = [];
  for (const courier of couriers) {
    const workload = await getCourierWorkload(courier.id);
    couriersWithWorkload.push({
      ...courier,
      unfinished_count: workload.unfinished_count,
    });
  }

  return couriersWithWorkload.sort((a, b) => a.unfinished_count - b.unfinished_count);
}

async function findBestCourierForPackage(pkg) {
  const reasons = [];

  if (!pkg) {
    return { courier: null, reasons: ['包裹不存在'] };
  }

  if (pkg.status !== 'CREATED') {
    return { courier: null, reasons: [`包裹状态为 ${pkg.status}，仅 CREATED 状态可分派`] };
  }

  if (pkg.courier_id) {
    return { courier: null, reasons: ['包裹已分配给其他快递小哥'] };
  }

  let zoneInfo = null;
  if (pkg.zone_id) {
    try {
      zoneInfo = await getZoneById(pkg.zone_id);
    } catch (e) {
      reasons.push('包裹关联的配送区域不存在');
    }
  }

  const availableCouriers = await getAvailableCouriersByZone(pkg.zone_id || null);

  if (availableCouriers.length === 0) {
    if (pkg.zone_id) {
      reasons.push('该配送区域暂无在岗快递小哥');
    } else {
      reasons.push('系统暂无在岗快递小哥');
    }
    return { courier: null, reasons };
  }

  if (!pkg.zone_id && !pkg.site_id) {
    reasons.push('包裹无站点和配送区域信息，按全局在岗小哥中选择负载最低的');
  } else if (!pkg.zone_id && pkg.site_id) {
    reasons.push('包裹无配送区域信息，按站点匹配后选择负载最低的在岗小哥');
  }

  return {
    courier: availableCouriers[0],
    reasons,
  };
}

async function previewDispatch(packageIds) {
  const results = [];
  const seenIds = [...new Set(packageIds)];

  for (const packageId of seenIds) {
    try {
      if (!Number.isInteger(packageId) || packageId <= 0) {
        results.push({
          package_id: packageId,
          type: DISPATCH_RESULT_TYPES.DATA_ERROR,
          success: false,
          reason: '包裹ID格式无效',
          recommended_courier: null,
        });
        continue;
      }

      const pkg = await getAsync(
        'SELECT p.*, s.name as site_name, dz.name as zone_name FROM package p ' +
        'LEFT JOIN site s ON p.site_id = s.id ' +
        'LEFT JOIN delivery_zone dz ON p.zone_id = dz.id ' +
        'WHERE p.id = ?',
        [packageId]
      );

      if (!pkg) {
        results.push({
          package_id: packageId,
          type: DISPATCH_RESULT_TYPES.DATA_ERROR,
          success: false,
          reason: '包裹不存在',
          recommended_courier: null,
        });
        continue;
      }

      if (pkg.status !== 'CREATED') {
        results.push({
          package_id: packageId,
          type: DISPATCH_RESULT_TYPES.SKIPPED,
          success: false,
          reason: `包裹状态为 ${pkg.status}，仅 CREATED 状态可分派`,
          package_info: {
            tracking_no: pkg.tracking_no,
            status: pkg.status,
            site_name: pkg.site_name,
            zone_name: pkg.zone_name,
          },
          recommended_courier: null,
        });
        continue;
      }

      if (pkg.courier_id) {
        results.push({
          package_id: packageId,
          type: DISPATCH_RESULT_TYPES.SKIPPED,
          success: false,
          reason: '包裹已分配给其他快递小哥',
          package_info: {
            tracking_no: pkg.tracking_no,
            status: pkg.status,
            courier_id: pkg.courier_id,
            site_name: pkg.site_name,
            zone_name: pkg.zone_name,
          },
          recommended_courier: null,
        });
        continue;
      }

      const { courier, reasons } = await findBestCourierForPackage(pkg);

      if (!courier) {
        results.push({
          package_id: packageId,
          type: DISPATCH_RESULT_TYPES.FAILED,
          success: false,
          reason: reasons.join('; '),
          package_info: {
            tracking_no: pkg.tracking_no,
            status: pkg.status,
            site_name: pkg.site_name,
            zone_name: pkg.zone_name,
            has_site_id: !!pkg.site_id,
            has_zone_id: !!pkg.zone_id,
          },
          recommended_courier: null,
        });
        continue;
      }

      results.push({
        package_id: packageId,
        type: DISPATCH_RESULT_TYPES.SUCCESS,
        success: true,
        reason: reasons.length > 0 ? reasons.join('; ') : '匹配成功',
        package_info: {
          tracking_no: pkg.tracking_no,
          status: pkg.status,
          site_name: pkg.site_name,
          zone_name: pkg.zone_name,
          has_site_id: !!pkg.site_id,
          has_zone_id: !!pkg.zone_id,
        },
        recommended_courier: {
          id: courier.id,
          name: courier.name,
          phone: courier.phone,
          status: courier.status,
          unfinished_count: courier.unfinished_count,
        },
      });
    } catch (err) {
      results.push({
        package_id: packageId,
        type: DISPATCH_RESULT_TYPES.DATA_ERROR,
        success: false,
        reason: `数据处理异常: ${err.message}`,
        recommended_courier: null,
      });
    }
  }

  const summary = {
    total: results.length,
    success: results.filter(r => r.type === DISPATCH_RESULT_TYPES.SUCCESS).length,
    skipped: results.filter(r => r.type === DISPATCH_RESULT_TYPES.SKIPPED).length,
    failed: results.filter(r => r.type === DISPATCH_RESULT_TYPES.FAILED).length,
    data_error: results.filter(r => r.type === DISPATCH_RESULT_TYPES.DATA_ERROR).length,
  };

  return {
    summary,
    details: results,
  };
}

async function confirmDispatch(packageIds, operatorName = '系统运营') {
  const previewResult = await previewDispatch(packageIds);
  const successItems = previewResult.details.filter(r => r.type === DISPATCH_RESULT_TYPES.SUCCESS);

  const confirmResults = [];

  for (const item of successItems) {
    try {
      await runInTransaction(async () => {
        const result = await _updatePackageStatusWithTrackInternal(
          item.package_id,
          'ASSIGNED',
          {
            operatorType: OPERATOR_TYPES.ADMIN,
            operatorId: null,
            operatorName,
            remark: `智能分派给快递小哥: ${item.recommended_courier.name}`,
          },
          { courier_id: item.recommended_courier.id }
        );
        confirmResults.push({
          ...item,
          confirmed: true,
          updated_package: result.package,
        });
      });
    } catch (err) {
      confirmResults.push({
        ...item,
        type: DISPATCH_RESULT_TYPES.DATA_ERROR,
        success: false,
        confirmed: false,
        reason: `确认分派失败: ${err.message}`,
      });
    }
  }

  const otherItems = previewResult.details.filter(r => r.type !== DISPATCH_RESULT_TYPES.SUCCESS);
  const allResults = [...confirmResults, ...otherItems];

  const summary = {
    total: allResults.length,
    success: allResults.filter(r => r.type === DISPATCH_RESULT_TYPES.SUCCESS && r.confirmed).length,
    skipped: allResults.filter(r => r.type === DISPATCH_RESULT_TYPES.SKIPPED).length,
    failed: allResults.filter(r => r.type === DISPATCH_RESULT_TYPES.FAILED).length,
    data_error: allResults.filter(r => r.type === DISPATCH_RESULT_TYPES.DATA_ERROR).length,
  };

  return {
    summary,
    details: allResults,
  };
}

module.exports = {
  DISPATCH_RESULT_TYPES,
  previewDispatch,
  confirmDispatch,
  findBestCourierForPackage,
  getAvailableCouriersByZone,
};
