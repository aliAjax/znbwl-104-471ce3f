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

async function getAvailableCouriersBySiteAndZone(siteId, zoneId) {
  let couriers;

  if (zoneId) {
    couriers = await allAsync(
      `SELECT DISTINCT c.* FROM courier_zone cz
       LEFT JOIN courier c ON cz.courier_id = c.id
       LEFT JOIN delivery_zone dz ON cz.zone_id = dz.id
       WHERE dz.id = ? AND c.status = 'ON_DUTY'`,
      [zoneId]
    );
  } else if (siteId) {
    couriers = await allAsync(
      `SELECT DISTINCT c.* FROM courier_zone cz
       LEFT JOIN courier c ON cz.courier_id = c.id
       LEFT JOIN delivery_zone dz ON cz.zone_id = dz.id
       WHERE dz.site_id = ? AND c.status = 'ON_DUTY'`,
      [siteId]
    );
  } else {
    couriers = await allAsync("SELECT * FROM courier WHERE status = 'ON_DUTY'");
  }

  const courierIds = couriers.map(c => c.id);
  const uniqueCouriers = couriers.filter((c, index) => courierIds.indexOf(c.id) === index);

  const couriersWithWorkload = [];
  for (const courier of uniqueCouriers) {
    const workload = await getCourierWorkload(courier.id);
    couriersWithWorkload.push({
      ...courier,
      unfinished_count: workload.unfinished_count,
    });
  }

  return couriersWithWorkload.sort((a, b) => a.unfinished_count - b.unfinished_count);
}

async function validatePackageForDispatch(packageId) {
  const errors = [];

  if (packageId === null || packageId === undefined) {
    return { valid: false, pkg: null, errors: ['包裹ID不能为空'] };
  }

  if (!Number.isInteger(packageId) || packageId <= 0) {
    return { valid: false, pkg: null, errors: ['包裹ID格式无效'] };
  }

  const pkg = await getAsync(
    'SELECT p.*, s.name as site_name, dz.name as zone_name FROM package p ' +
    'LEFT JOIN site s ON p.site_id = s.id ' +
    'LEFT JOIN delivery_zone dz ON p.zone_id = dz.id ' +
    'WHERE p.id = ?',
    [packageId]
  );

  if (!pkg) {
    return { valid: false, pkg: null, errors: ['包裹不存在'] };
  }

  if (pkg.status !== 'CREATED') {
    return { valid: false, pkg, errors: [`包裹状态为 ${pkg.status}，仅 CREATED 状态可分派`], skipType: 'SKIPPED' };
  }

  if (pkg.courier_id) {
    return { valid: false, pkg, errors: ['包裹已分配给其他快递小哥'], skipType: 'SKIPPED' };
  }

  if (pkg.zone_id) {
    try {
      await getZoneById(pkg.zone_id);
    } catch (e) {
      errors.push('包裹关联的配送区域不存在');
    }
  }

  return { valid: true, pkg, errors };
}

async function getCourierZoneMatchDetails(courierId, pkg) {
  const result = {
    match_level: 'none',
    match_description: '不匹配',
    matched_zones: [],
  };

  const courierZones = await allAsync(
    `SELECT dz.*, s.name as site_name FROM courier_zone cz
     LEFT JOIN delivery_zone dz ON cz.zone_id = dz.id
     LEFT JOIN site s ON dz.site_id = s.id
     WHERE cz.courier_id = ?`,
    [courierId]
  );

  if (pkg.zone_id) {
    const exactMatch = courierZones.find(z => z.id === pkg.zone_id);
    if (exactMatch) {
      result.match_level = 'exact';
      result.match_description = `精确匹配区域【${exactMatch.name}】`;
      result.matched_zones = [exactMatch.name];
      return result;
    }
  }

  if (pkg.site_id) {
    const siteMatchedZones = courierZones.filter(z => z.site_id === pkg.site_id);
    if (siteMatchedZones.length > 0) {
      result.match_level = 'site';
      result.match_description = `匹配站点【${pkg.site_name || pkg.site_id}】下 ${siteMatchedZones.length} 个区域`;
      result.matched_zones = siteMatchedZones.map(z => z.name);
      return result;
    }
  }

  if (courierZones.length > 0) {
    result.match_level = 'global';
    result.match_description = `全局匹配，小哥负责 ${courierZones.length} 个区域`;
    result.matched_zones = courierZones.map(z => z.name);
  } else {
    result.match_level = 'global';
    result.match_description = '全局匹配，小哥未分配区域';
    result.matched_zones = [];
  }

  return result;
}

async function findBestCourierForPackage(pkg) {
  const reasons = [];

  if (!pkg) {
    return { courier: null, reasons: ['包裹不存在'], candidates: [] };
  }

  const availableCouriers = await getAvailableCouriersBySiteAndZone(pkg.site_id, pkg.zone_id);

  if (availableCouriers.length === 0) {
    if (pkg.zone_id) {
      reasons.push('该配送区域暂无在岗快递小哥');
    } else if (pkg.site_id) {
      reasons.push('该站点下所有配送区域暂无在岗快递小哥');
    } else {
      reasons.push('系统暂无在岗快递小哥');
    }
    return { courier: null, reasons, candidates: [] };
  }

  if (!pkg.zone_id && !pkg.site_id) {
    reasons.push('包裹无站点和配送区域信息，从全局在岗小哥中选择负载最低的');
  } else if (!pkg.zone_id && pkg.site_id) {
    reasons.push(`包裹无配送区域信息，从站点【${pkg.site_name || pkg.site_id}】下所有区域的在岗小哥中选择负载最低的`);
  }

  const candidates = [];
  for (const courier of availableCouriers) {
    const zoneMatch = await getCourierZoneMatchDetails(courier.id, pkg);
    candidates.push({
      id: courier.id,
      name: courier.name,
      phone: courier.phone,
      status: courier.status,
      is_on_duty: courier.status === 'ON_DUTY',
      unfinished_count: courier.unfinished_count,
      zone_match: zoneMatch,
    });
  }

  return {
    courier: availableCouriers[0],
    reasons,
    candidate_count: availableCouriers.length,
    candidates,
  };
}

function buildDispatchResult(packageId, type, success, reason, options = {}) {
  const result = {
    package_id: packageId,
    type,
    success,
    reason,
    recommended_courier: null,
  };

  if (options.package_info) {
    result.package_info = options.package_info;
  }
  if (options.recommended_courier) {
    result.recommended_courier = options.recommended_courier;
  }
  if (options.candidate_count !== undefined) {
    result.candidate_count = options.candidate_count;
  }
  if (options.candidates) {
    result.candidates = options.candidates;
  }

  return result;
}

async function previewDispatch(packageIds) {
  const results = [];

  if (!packageIds) {
    return {
      summary: { total: 0, success: 0, skipped: 0, failed: 0, data_error: 0 },
      details: [],
    };
  }

  let normalizedIds = packageIds;
  if (!Array.isArray(normalizedIds)) {
    normalizedIds = [normalizedIds];
  }

  const seenIds = [...new Set(normalizedIds)];

  for (const packageId of seenIds) {
    try {
      const validation = await validatePackageForDispatch(packageId);

      if (!validation.valid) {
        if (validation.skipType === 'SKIPPED') {
          results.push(buildDispatchResult(
            packageId,
            DISPATCH_RESULT_TYPES.SKIPPED,
            false,
            validation.errors.join('; '),
            validation.pkg ? {
              package_info: {
                tracking_no: validation.pkg.tracking_no,
                status: validation.pkg.status,
                courier_id: validation.pkg.courier_id,
                site_name: validation.pkg.site_name,
                zone_name: validation.pkg.zone_name,
                has_site_id: !!validation.pkg.site_id,
                has_zone_id: !!validation.pkg.zone_id,
              },
            } : {}
          ));
        } else {
          results.push(buildDispatchResult(
            packageId,
            DISPATCH_RESULT_TYPES.DATA_ERROR,
            false,
            validation.errors.join('; ')
          ));
        }
        continue;
      }

      const pkg = validation.pkg;
      const { courier, reasons, candidate_count, candidates } = await findBestCourierForPackage(pkg);

      if (!courier) {
        results.push(buildDispatchResult(
          packageId,
          DISPATCH_RESULT_TYPES.FAILED,
          false,
          reasons.join('; '),
          {
            package_info: {
              tracking_no: pkg.tracking_no,
              status: pkg.status,
              site_name: pkg.site_name,
              zone_name: pkg.zone_name,
              has_site_id: !!pkg.site_id,
              has_zone_id: !!pkg.zone_id,
            },
            candidates,
          }
        ));
        continue;
      }

      results.push(buildDispatchResult(
        packageId,
        DISPATCH_RESULT_TYPES.SUCCESS,
        true,
        reasons.length > 0 ? reasons.join('; ') : '匹配成功',
        {
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
          candidate_count,
          candidates,
        }
      ));
    } catch (err) {
      results.push(buildDispatchResult(
        packageId,
        DISPATCH_RESULT_TYPES.DATA_ERROR,
        false,
        `数据处理异常: ${err.message}`
      ));
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
  if (!packageIds) {
    return {
      summary: { total: 0, success: 0, skipped: 0, failed: 0, data_error: 0 },
      details: [],
    };
  }

  let normalizedIds = packageIds;
  if (!Array.isArray(normalizedIds)) {
    normalizedIds = [normalizedIds];
  }

  const previewResult = await previewDispatch(normalizedIds);
  const successItems = previewResult.details.filter(r => r.type === DISPATCH_RESULT_TYPES.SUCCESS);

  const confirmResults = [];

  for (const item of successItems) {
    try {
      const reValidation = await validatePackageForDispatch(item.package_id);
      if (!reValidation.valid) {
        if (reValidation.skipType === 'SKIPPED') {
          confirmResults.push(buildDispatchResult(
            item.package_id,
            DISPATCH_RESULT_TYPES.SKIPPED,
            false,
            `确认时状态已变更: ${reValidation.errors.join('; ')}`,
            reValidation.pkg ? {
              package_info: {
                tracking_no: reValidation.pkg.tracking_no,
                status: reValidation.pkg.status,
                courier_id: reValidation.pkg.courier_id,
                site_name: reValidation.pkg.site_name,
                zone_name: reValidation.pkg.zone_name,
              },
            } : {}
          ));
        } else {
          confirmResults.push(buildDispatchResult(
            item.package_id,
            DISPATCH_RESULT_TYPES.DATA_ERROR,
            false,
            `确认时数据异常: ${reValidation.errors.join('; ')}`
          ));
        }
        continue;
      }

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
      confirmResults.push(buildDispatchResult(
        item.package_id,
        DISPATCH_RESULT_TYPES.DATA_ERROR,
        false,
        `确认分派失败: ${err.message}`,
        { recommended_courier: item.recommended_courier }
      ));
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
  getAvailableCouriersBySiteAndZone,
  validatePackageForDispatch,
};
