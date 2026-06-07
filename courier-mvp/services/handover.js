const { allAsync, getAsync, runAsync, runInTransaction } = require('../db');
const { isCourierOnDuty, getCourierUnfinishedPackageCount } = require('./workstation');
const { isCourierInZone, getAvailableCouriersForZone } = require('./zone');
const { OPERATOR_TYPES, addPackageTrack } = require('./package_track');
const { checkAppointmentConflict } = require('./delivery_appointment');
const { getCodPaymentByPackageId } = require('./cod_payment');

const HANDOVER_RESULT_TYPES = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
};

const UNFINISHED_STATUSES = ['ASSIGNED', 'PICKED_UP', 'DELIVERING'];
const PENDING_EXCEPTION_STATUSES = ['PENDING', 'PROCESSING'];

async function getCourierUnfinishedPackages(courierId) {
  const packages = await allAsync(
    `SELECT p.*, s.name as site_name, dz.name as zone_name,
            da.appointment_start, da.appointment_end, da.status as appointment_status,
            er.id as exception_id, er.status as exception_status, er.exception_type,
            cp.id as cod_payment_id
     FROM package p
     LEFT JOIN site s ON p.site_id = s.id
     LEFT JOIN delivery_zone dz ON p.zone_id = dz.id
     LEFT JOIN delivery_appointment da ON p.id = da.package_id AND da.status = 'ACTIVE'
     LEFT JOIN exception_record er ON p.id = er.package_id AND er.status IN ('PENDING', 'PROCESSING')
     LEFT JOIN cod_payment cp ON p.id = cp.package_id
     WHERE p.courier_id = ? AND p.status IN ('ASSIGNED', 'PICKED_UP', 'DELIVERING')
     ORDER BY
       CASE WHEN da.appointment_start IS NOT NULL THEN 0 ELSE 1 END,
       datetime(da.appointment_start) ASC,
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

async function getAvailableTargetCouriers(sourceCourierId, zoneId) {
  const couriers = await getAvailableCouriersForZone(zoneId);
  return couriers.filter(c => c.id !== sourceCourierId && isCourierOnDuty(c));
}

async function validatePackageForHandover(pkg, targetCourierId) {
  const errors = [];
  const warnings = [];

  if (!pkg) {
    return { valid: false, errors: ['包裹不存在'], warnings };
  }

  if (!UNFINISHED_STATUSES.includes(pkg.status)) {
    errors.push(`包裹状态为 ${pkg.status}，仅 ASSIGNED、PICKED_UP、DELIVERING 状态可交接`);
  }

  if (pkg.zone_id) {
    const inZone = await isCourierInZone(targetCourierId, pkg.zone_id);
    if (!inZone) {
      errors.push('目标小哥不负责该包裹的配送区域');
    }
  }

  if (pkg.appointment_start && pkg.appointment_end && pkg.appointment_status === 'ACTIVE') {
    const conflict = await checkAppointmentConflict(
      targetCourierId,
      pkg.appointment_start,
      pkg.appointment_end,
      pkg.id
    );
    if (conflict.hasConflict) {
      errors.push(`预约时间冲突: ${conflict.message}`);
    }
  }

  if (pkg.is_cod && pkg.cod_amount > 0) {
    const codPayment = await getCodPaymentByPackageId(pkg.id);
    if (!codPayment) {
      errors.push('该包裹为到付待收款状态，需完成收款后方可交接');
    }
  }

  if (pkg.exception_id && PENDING_EXCEPTION_STATUSES.includes(pkg.exception_status)) {
    errors.push(`该包裹存在未处理的异常件 [${pkg.exception_type}]，需处理完成后方可交接`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

async function findBestTargetCourier(sourceCourierId, pkg) {
  if (!pkg.zone_id) {
    return { courier: null, reason: '包裹无配送区域信息，无法自动匹配目标小哥' };
  }

  const availableCouriers = await getAvailableTargetCouriers(sourceCourierId, pkg.zone_id);

  if (availableCouriers.length === 0) {
    return { courier: null, reason: '该配送区域暂无其他在岗快递小哥' };
  }

  const courierWorkloads = [];
  for (const courier of availableCouriers) {
    const workload = await getCourierUnfinishedPackageCount(courier.id);
    courierWorkloads.push({ ...courier, unfinished_count: workload });
  }

  courierWorkloads.sort((a, b) => a.unfinished_count - b.unfinished_count);

  return {
    courier: courierWorkloads[0],
    reason: `匹配成功，目标小哥当前未完成 ${courierWorkloads[0].unfinished_count} 单`,
    candidates: courierWorkloads,
  };
}

async function previewHandover(sourceCourierId, packageIds = null) {
  const sourceCourier = await getAsync('SELECT * FROM courier WHERE id = ?', [sourceCourierId]);
  if (!sourceCourier) {
    const err = new Error('发起交接的小哥不存在');
    err.statusCode = 404;
    throw err;
  }

  const results = [];
  const packageMap = new Map();

  if (packageIds && packageIds.length > 0) {
    const uniqueIds = [...new Set(packageIds)];
    const placeholders = uniqueIds.map(() => '?').join(',');
    const packages = await allAsync(
      `SELECT p.*, s.name as site_name, dz.name as zone_name,
              da.appointment_start, da.appointment_end, da.status as appointment_status,
              er.id as exception_id, er.status as exception_status, er.exception_type,
              cp.id as cod_payment_id
       FROM package p
       LEFT JOIN site s ON p.site_id = s.id
       LEFT JOIN delivery_zone dz ON p.zone_id = dz.id
       LEFT JOIN delivery_appointment da ON p.id = da.package_id AND da.status = 'ACTIVE'
       LEFT JOIN exception_record er ON p.id = er.package_id AND er.status IN ('PENDING', 'PROCESSING')
       LEFT JOIN cod_payment cp ON p.id = cp.package_id
       WHERE p.id IN (${placeholders})
       ORDER BY p.id`,
      [...uniqueIds]
    );

    for (const pkg of packages) {
      packageMap.set(pkg.id, pkg);
    }

    for (const id of uniqueIds) {
      const pkg = packageMap.get(id);
      if (!pkg) {
        results.push({
          package_id: id,
          tracking_no: null,
          type: HANDOVER_RESULT_TYPES.FAILED,
          success: false,
          reason: '包裹不存在',
        });
      } else if (pkg.courier_id !== sourceCourierId) {
        results.push({
          package_id: id,
          tracking_no: pkg.tracking_no,
          type: HANDOVER_RESULT_TYPES.SKIPPED,
          success: false,
          reason: '该包裹不属于当前小哥',
          package_info: {
            status: pkg.status,
            zone_name: pkg.zone_name,
            has_appointment: !!(pkg.appointment_start && pkg.appointment_status === 'ACTIVE'),
            is_cod: !!pkg.is_cod,
            has_exception: !!pkg.exception_id,
          },
        });
      } else if (!UNFINISHED_STATUSES.includes(pkg.status)) {
        results.push({
          package_id: id,
          tracking_no: pkg.tracking_no,
          type: HANDOVER_RESULT_TYPES.SKIPPED,
          success: false,
          reason: `包裹状态为 ${pkg.status}，仅 ASSIGNED、PICKED_UP、DELIVERING 状态可交接`,
          package_info: {
            status: pkg.status,
            zone_name: pkg.zone_name,
            has_appointment: !!(pkg.appointment_start && pkg.appointment_status === 'ACTIVE'),
            is_cod: !!pkg.is_cod,
            has_exception: !!pkg.exception_id,
          },
        });
      } else {
        try {
          const { courier, reason, candidates } = await findBestTargetCourier(sourceCourierId, pkg);

          if (!courier) {
            results.push({
              package_id: id,
              tracking_no: pkg.tracking_no,
              type: HANDOVER_RESULT_TYPES.FAILED,
              success: false,
              reason,
              package_info: {
                status: pkg.status,
                zone_name: pkg.zone_name,
                has_appointment: !!(pkg.appointment_start && pkg.appointment_status === 'ACTIVE'),
                is_cod: !!pkg.is_cod,
                has_exception: !!pkg.exception_id,
              },
            });
            continue;
          }

          const validation = await validatePackageForHandover(pkg, courier.id);

          if (!validation.valid) {
            results.push({
              package_id: id,
              tracking_no: pkg.tracking_no,
              type: HANDOVER_RESULT_TYPES.FAILED,
              success: false,
              reason: validation.errors.join('; '),
              target_courier: {
                id: courier.id,
                name: courier.name,
                phone: courier.phone,
                unfinished_count: courier.unfinished_count,
              },
              package_info: {
                status: pkg.status,
                zone_name: pkg.zone_name,
                has_appointment: !!(pkg.appointment_start && pkg.appointment_status === 'ACTIVE'),
                is_cod: !!pkg.is_cod,
                has_exception: !!pkg.exception_id,
              },
            });
            continue;
          }

          results.push({
            package_id: id,
            tracking_no: pkg.tracking_no,
            type: HANDOVER_RESULT_TYPES.SUCCESS,
            success: true,
            reason,
            target_courier: {
              id: courier.id,
              name: courier.name,
              phone: courier.phone,
              unfinished_count: courier.unfinished_count,
            },
            candidates: candidates.map(c => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              unfinished_count: c.unfinished_count,
            })),
            package_info: {
              status: pkg.status,
              zone_name: pkg.zone_name,
              has_appointment: !!(pkg.appointment_start && pkg.appointment_status === 'ACTIVE'),
              is_cod: !!pkg.is_cod,
              has_exception: !!pkg.exception_id,
            },
          });
        } catch (err) {
          results.push({
            package_id: id,
            tracking_no: pkg.tracking_no,
            type: HANDOVER_RESULT_TYPES.FAILED,
            success: false,
            reason: `处理异常: ${err.message}`,
          });
        }
      }
    }
  } else {
    const packages = await getCourierUnfinishedPackages(sourceCourierId);
    for (const pkg of packages) {
      try {
        if (pkg.courier_id !== sourceCourierId) {
          results.push({
            package_id: pkg.id,
            tracking_no: pkg.tracking_no,
            type: HANDOVER_RESULT_TYPES.SKIPPED,
            success: false,
            reason: '该包裹不属于当前小哥',
            package_info: {
              status: pkg.status,
              zone_name: pkg.zone_name,
              has_appointment: !!(pkg.appointment_start && pkg.appointment_status === 'ACTIVE'),
              is_cod: !!pkg.is_cod,
              has_exception: !!pkg.exception_id,
            },
          });
          continue;
        }

        const { courier, reason, candidates } = await findBestTargetCourier(sourceCourierId, pkg);

        if (!courier) {
          results.push({
            package_id: pkg.id,
            tracking_no: pkg.tracking_no,
            type: HANDOVER_RESULT_TYPES.FAILED,
            success: false,
            reason,
            package_info: {
              status: pkg.status,
              zone_name: pkg.zone_name,
              has_appointment: !!(pkg.appointment_start && pkg.appointment_status === 'ACTIVE'),
              is_cod: !!pkg.is_cod,
              has_exception: !!pkg.exception_id,
            },
          });
          continue;
        }

        const validation = await validatePackageForHandover(pkg, courier.id);

        if (!validation.valid) {
          results.push({
            package_id: pkg.id,
            tracking_no: pkg.tracking_no,
            type: HANDOVER_RESULT_TYPES.FAILED,
            success: false,
            reason: validation.errors.join('; '),
            target_courier: {
              id: courier.id,
              name: courier.name,
              phone: courier.phone,
              unfinished_count: courier.unfinished_count,
            },
            package_info: {
              status: pkg.status,
              zone_name: pkg.zone_name,
              has_appointment: !!(pkg.appointment_start && pkg.appointment_status === 'ACTIVE'),
              is_cod: !!pkg.is_cod,
              has_exception: !!pkg.exception_id,
            },
          });
          continue;
        }

        results.push({
          package_id: pkg.id,
          tracking_no: pkg.tracking_no,
          type: HANDOVER_RESULT_TYPES.SUCCESS,
          success: true,
          reason,
          target_courier: {
            id: courier.id,
            name: courier.name,
            phone: courier.phone,
            unfinished_count: courier.unfinished_count,
          },
          candidates: candidates.map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            unfinished_count: c.unfinished_count,
          })),
          package_info: {
            status: pkg.status,
            zone_name: pkg.zone_name,
            has_appointment: !!(pkg.appointment_start && pkg.appointment_status === 'ACTIVE'),
            is_cod: !!pkg.is_cod,
            has_exception: !!pkg.exception_id,
          },
        });
      } catch (err) {
        results.push({
          package_id: pkg.id,
          tracking_no: pkg.tracking_no,
          type: HANDOVER_RESULT_TYPES.FAILED,
          success: false,
          reason: `处理异常: ${err.message}`,
        });
      }
    }
  }

  const summary = {
    total: results.length,
    success: results.filter(r => r.type === HANDOVER_RESULT_TYPES.SUCCESS).length,
    failed: results.filter(r => r.type === HANDOVER_RESULT_TYPES.FAILED).length,
    skipped: results.filter(r => r.type === HANDOVER_RESULT_TYPES.SKIPPED).length,
  };

  return {
    source_courier: {
      id: sourceCourier.id,
      name: sourceCourier.name,
      phone: sourceCourier.phone,
    },
    summary,
    details: results,
  };
}

async function executeHandover(sourceCourierId, packageIds, targetCourierId = null, operatorName = null) {
  const sourceCourier = await getAsync('SELECT * FROM courier WHERE id = ?', [sourceCourierId]);
  if (!sourceCourier) {
    const err = new Error('发起交接的小哥不存在');
    err.statusCode = 404;
    throw err;
  }

  if (!packageIds || packageIds.length === 0) {
    const err = new Error('请选择需要交接的包裹');
    err.statusCode = 400;
    throw err;
  }

  const results = [];
  const operator = operatorName || sourceCourier.name;
  const uniqueIds = [...new Set(packageIds)];
  const packageMap = new Map();

  const placeholders = uniqueIds.map(() => '?').join(',');
  const packages = await allAsync(
    `SELECT p.*, s.name as site_name, dz.name as zone_name,
            da.appointment_start, da.appointment_end, da.status as appointment_status,
            er.id as exception_id, er.status as exception_status, er.exception_type,
            cp.id as cod_payment_id
     FROM package p
     LEFT JOIN site s ON p.site_id = s.id
     LEFT JOIN delivery_zone dz ON p.zone_id = dz.id
     LEFT JOIN delivery_appointment da ON p.id = da.package_id AND da.status = 'ACTIVE'
     LEFT JOIN exception_record er ON p.id = er.package_id AND er.status IN ('PENDING', 'PROCESSING')
     LEFT JOIN cod_payment cp ON p.id = cp.package_id
     WHERE p.id IN (${placeholders})
     ORDER BY p.id`,
    [...uniqueIds]
  );

  for (const pkg of packages) {
    packageMap.set(pkg.id, pkg);
  }

  for (const id of uniqueIds) {
    const pkg = packageMap.get(id);
    try {
      if (!pkg) {
        results.push({
          package_id: id,
          tracking_no: null,
          type: HANDOVER_RESULT_TYPES.FAILED,
          success: false,
          reason: '包裹不存在',
        });
        continue;
      }

      const currentPkg = await getAsync('SELECT * FROM package WHERE id = ?', [id]);
      if (!currentPkg || currentPkg.courier_id !== sourceCourierId) {
        results.push({
          package_id: id,
          tracking_no: pkg ? pkg.tracking_no : null,
          type: HANDOVER_RESULT_TYPES.SKIPPED,
          success: false,
          reason: '包裹信息已变更，不属于当前小哥',
        });
        continue;
      }

      if (!UNFINISHED_STATUSES.includes(currentPkg.status)) {
        results.push({
          package_id: id,
          tracking_no: pkg ? pkg.tracking_no : null,
          type: HANDOVER_RESULT_TYPES.SKIPPED,
          success: false,
          reason: `包裹状态已变更为 ${currentPkg.status}，无法交接`,
        });
        continue;
      }

      let targetCourier;
      if (targetCourierId) {
        targetCourier = await getAsync('SELECT * FROM courier WHERE id = ?', [targetCourierId]);
        if (!targetCourier) {
          results.push({
            package_id: id,
            tracking_no: pkg ? pkg.tracking_no : null,
            type: HANDOVER_RESULT_TYPES.FAILED,
            success: false,
            reason: '目标小哥不存在',
          });
          continue;
        }
        if (!isCourierOnDuty(targetCourier)) {
          results.push({
            package_id: id,
            tracking_no: pkg ? pkg.tracking_no : null,
            type: HANDOVER_RESULT_TYPES.FAILED,
            success: false,
            reason: '目标小哥当前不在岗',
          });
          continue;
        }
      } else {
        const matchResult = await findBestTargetCourier(sourceCourierId, pkg);
        if (!matchResult.courier) {
          results.push({
            package_id: id,
            tracking_no: pkg ? pkg.tracking_no : null,
            type: HANDOVER_RESULT_TYPES.FAILED,
            success: false,
            reason: matchResult.reason,
          });
          continue;
        }
        targetCourier = matchResult.courier;
      }

      const validation = await validatePackageForHandover(pkg, targetCourier.id);
      if (!validation.valid) {
        results.push({
          package_id: id,
          tracking_no: pkg ? pkg.tracking_no : null,
          type: HANDOVER_RESULT_TYPES.FAILED,
          success: false,
          reason: validation.errors.join('; '),
          target_courier: {
            id: targetCourier.id,
            name: targetCourier.name,
            phone: targetCourier.phone,
          },
        });
        continue;
      }

      await runInTransaction(async () => {
        await runAsync(
          'UPDATE package SET courier_id = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
          [targetCourier.id, id]
        );

        await addPackageTrack({
          packageId: id,
          oldStatus: currentPkg.status,
          newStatus: currentPkg.status,
          operatorType: OPERATOR_TYPES.COURIER,
          operatorId: sourceCourierId,
          operatorName: operator,
          remark: `交接班: 从 ${sourceCourier.name} 转交给 ${targetCourier.name}`,
        });
      });

      results.push({
        package_id: id,
        tracking_no: pkg ? pkg.tracking_no : null,
        type: HANDOVER_RESULT_TYPES.SUCCESS,
        success: true,
        reason: '交接成功',
        target_courier: {
          id: targetCourier.id,
          name: targetCourier.name,
          phone: targetCourier.phone,
        },
      });
    } catch (err) {
      results.push({
        package_id: id,
        tracking_no: pkg ? pkg.tracking_no : null,
        type: HANDOVER_RESULT_TYPES.FAILED,
        success: false,
        reason: `交接失败: ${err.message}`,
      });
    }
  }

  const summary = {
    total: results.length,
    success: results.filter(r => r.type === HANDOVER_RESULT_TYPES.SUCCESS).length,
    failed: results.filter(r => r.type === HANDOVER_RESULT_TYPES.FAILED).length,
    skipped: results.filter(r => r.type === HANDOVER_RESULT_TYPES.SKIPPED).length,
  };

  return {
    source_courier: {
      id: sourceCourier.id,
      name: sourceCourier.name,
      phone: sourceCourier.phone,
    },
    summary,
    details: results,
  };
}

module.exports = {
  HANDOVER_RESULT_TYPES,
  getCourierUnfinishedPackages,
  getAvailableTargetCouriers,
  validatePackageForHandover,
  findBestTargetCourier,
  previewHandover,
  executeHandover,
};
