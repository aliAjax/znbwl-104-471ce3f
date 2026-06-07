const { Router } = require('express');
const { runAsync, allAsync, getAsync, runInTransaction } = require('../db');
const { success, fail } = require('../utils/response');
const { parsePaginationParams, buildPaginationResult } = require('../utils/pagination');
const { getDeliveryReceiptByPackageId } = require('../services/delivery_receipt');
const { getCodPaymentByPackageId } = require('../services/cod_payment');
const { batchAssignPackages, isCourierOnDuty } = require('../services/workstation');
const { isCourierInZone } = require('../services/zone');
const { validateBatchAssign, validateDispatch } = require('../utils/validators');
const { OPERATOR_TYPES, addPackageTrack, getPackageTracks, updatePackageStatusWithTrack } = require('../services/package_track');
const { previewDispatch, confirmDispatch } = require('../services/dispatch');

const router = Router();

const VALID_PACKAGE_STATUSES = ['CREATED', 'ASSIGNED', 'PICKED_UP', 'DELIVERING', 'DELIVERED', 'FAILED'];

function generateTrackingNo() {
  const now = new Date();
  const ts = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
  return `SF${ts}${rand}`;
}

router.post('/', async (req, res) => {
  try {
    const { tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, site_id, zone_id, is_cod, cod_amount } = req.body;
    if (!receiver_name || !receiver_phone) {
      return res.status(400).json(fail('收件人姓名和手机号不能为空'));
    }
    const finalIsCod = is_cod ? 1 : 0;
    let finalCodAmount = Number(cod_amount) || 0;
    if (finalIsCod && finalCodAmount <= 0) {
      return res.status(400).json(fail('到付包裹必须填写应收金额，且金额必须大于0'));
    }
    if (!finalIsCod) {
      finalCodAmount = 0;
    }
    let finalSiteId = site_id || null;
    let finalZoneId = zone_id || null;
    if (site_id) {
      const site = await getAsync('SELECT id FROM site WHERE id = ?', [site_id]);
      if (!site) {
        return res.status(400).json(fail('所属站点不存在'));
      }
    }
    if (zone_id) {
      const zone = await getAsync('SELECT * FROM delivery_zone WHERE id = ?', [zone_id]);
      if (!zone) {
        return res.status(400).json(fail('配送区域不存在'));
      }
      if (site_id && zone.site_id !== Number(site_id)) {
        return res.status(400).json(fail('该配送区域不属于所选站点'));
      }
      if (!site_id) {
        finalSiteId = zone.site_id;
      }
    }
    const finalTrackingNo = tracking_no || generateTrackingNo();
    const existing = await getAsync('SELECT id FROM package WHERE tracking_no = ?', [finalTrackingNo]);
    if (existing) {
      return res.status(400).json(fail('运单号已存在'));
    }
    const packageId = await runInTransaction(async () => {
      const result = await runAsync(
        `INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status, site_id, zone_id, is_cod, cod_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, ?)`,
        [finalTrackingNo, sender_name || null, sender_phone || null, receiver_name, receiver_phone, receiver_address || null, weight || 0, finalSiteId, finalZoneId, finalIsCod, finalCodAmount]
      );
      await addPackageTrack({
        packageId: result.lastID,
        oldStatus: null,
        newStatus: 'CREATED',
        operatorType: OPERATOR_TYPES.SYSTEM,
        remark: '包裹创建',
      });
      return result.lastID;
    });
    const pkg = await getAsync(
      'SELECT p.*, s.name as site_name, dz.name as zone_name FROM package p LEFT JOIN site s ON p.site_id = s.id LEFT JOIN delivery_zone dz ON p.zone_id = dz.id WHERE p.id = ?',
      [packageId]
    );
    res.status(201).json(success(pkg, '包裹创建成功'));
  } catch (err) {
    console.error('创建包裹失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.put('/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { courier_id } = req.body;
    if (!courier_id) {
      return res.status(400).json(fail('请指定快递小哥ID'));
    }
    const pkg = await getAsync('SELECT * FROM package WHERE id = ?', [id]);
    if (!pkg) {
      return res.status(404).json(fail('包裹不存在'));
    }
    if (pkg.status !== 'CREATED') {
      return res.status(400).json(fail(`包裹当前状态为 ${pkg.status}，只有 CREATED 状态的包裹可以分配`));
    }
    const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [courier_id]);
    if (!courier) {
      return res.status(404).json(fail('快递小哥不存在'));
    }
    if (!isCourierOnDuty(courier)) {
      return res.status(400).json(fail('该快递小哥当前不在岗，无法分配'));
    }
    if (pkg.zone_id) {
      const inZone = await isCourierInZone(courier_id, pkg.zone_id);
      if (!inZone) {
        return res.status(400).json(fail('该快递小哥不负责此包裹的配送区域，无法分配'));
      }
    }
    const result = await updatePackageStatusWithTrack(
      id,
      'ASSIGNED',
      {
        operatorType: OPERATOR_TYPES.ADMIN,
        operatorId: null,
        operatorName: courier.name,
        remark: `分配给快递小哥: ${courier.name}`,
      },
      { courier_id: courier_id }
    );
    res.json(success(result.package, '包裹已分配给快递小哥'));
  } catch (err) {
    console.error('分配包裹失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.post('/batch-assign', async (req, res) => {
  try {
    const validation = validateBatchAssign(req.body);
    if (!validation.valid) {
      return res.status(400).json(fail(validation.message));
    }

    const { package_ids, courier_id } = validation.data;
    const result = await batchAssignPackages(package_ids, courier_id);
    res.json(success(result, `批量分配完成: ${result.succeeded} 成功, ${result.failed} 失败`));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('批量分配包裹失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, courier_id } = req.body;
    if (!status) {
      return res.status(400).json(fail('请指定新的包裹状态'));
    }
    if (!VALID_PACKAGE_STATUSES.includes(status)) {
      return res.status(400).json(fail(`无效的状态，可选值: ${VALID_PACKAGE_STATUSES.join(', ')}`));
    }
    const pkg = await getAsync('SELECT * FROM package WHERE id = ?', [id]);
    if (!pkg) {
      return res.status(404).json(fail('包裹不存在'));
    }
    if (courier_id && pkg.courier_id !== courier_id) {
      return res.status(403).json(fail('该包裹未分配给此快递小哥'));
    }
    const statusFlow = {
      'CREATED': ['ASSIGNED'],
      'ASSIGNED': ['PICKED_UP'],
      'PICKED_UP': ['DELIVERING'],
      'DELIVERING': ['DELIVERED', 'FAILED'],
      'DELIVERED': [],
      'FAILED': []
    };
    const allowedNext = statusFlow[pkg.status] || [];
    if (!allowedNext.includes(status)) {
      return res.status(400).json(fail(`包裹当前状态为 ${pkg.status}，不允许变更为 ${status}，允许的变更: ${allowedNext.length > 0 ? allowedNext.join(', ') : '无（已终态）'}`));
    }
    if (status === 'DELIVERED') {
      return res.status(400).json(fail('包裹签收请通过 POST /api/delivery-receipts 提交签收凭证，不可直接变更状态'));
    }

    let operatorName = null;
    if (courier_id) {
      const courier = await getAsync('SELECT name FROM courier WHERE id = ?', [courier_id]);
      if (courier) operatorName = courier.name;
    }

    const result = await updatePackageStatusWithTrack(
      id,
      status,
      {
        operatorType: courier_id ? OPERATOR_TYPES.COURIER : OPERATOR_TYPES.ADMIN,
        operatorId: courier_id || null,
        operatorName,
        remark: `状态更新: ${pkg.status} -> ${status}`,
      }
    );
    res.json(success(result.package, '包裹状态更新成功'));
  } catch (err) {
    console.error('更新包裹状态失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/', async (req, res) => {
  try {
    const { status, courier_id, tracking_no, receiver_phone, receiver_address, site_id, zone_id } = req.query;
    const { page, pageSize, offset } = parsePaginationParams(req.query);

    let countSql = 'SELECT COUNT(*) as total FROM package p WHERE 1=1';
    let dataSql = 'SELECT p.*, c.name as courier_name, c.phone as courier_phone, s.name as site_name, dz.name as zone_name FROM package p LEFT JOIN courier c ON p.courier_id = c.id LEFT JOIN site s ON p.site_id = s.id LEFT JOIN delivery_zone dz ON p.zone_id = dz.id WHERE 1=1';
    const params = [];

    if (status) {
      countSql += ' AND p.status = ?';
      dataSql += ' AND p.status = ?';
      params.push(status);
    }
    if (courier_id) {
      countSql += ' AND p.courier_id = ?';
      dataSql += ' AND p.courier_id = ?';
      params.push(courier_id);
    }
    if (tracking_no) {
      countSql += ' AND p.tracking_no LIKE ?';
      dataSql += ' AND p.tracking_no LIKE ?';
      params.push(`%${tracking_no}%`);
    }
    if (receiver_phone) {
      countSql += ' AND p.receiver_phone LIKE ?';
      dataSql += ' AND p.receiver_phone LIKE ?';
      params.push(`%${receiver_phone}%`);
    }
    if (receiver_address) {
      countSql += ' AND p.receiver_address LIKE ?';
      dataSql += ' AND p.receiver_address LIKE ?';
      params.push(`%${receiver_address}%`);
    }
    if (site_id) {
      countSql += ' AND p.site_id = ?';
      dataSql += ' AND p.site_id = ?';
      params.push(site_id);
    }
    if (zone_id) {
      countSql += ' AND p.zone_id = ?';
      dataSql += ' AND p.zone_id = ?';
      params.push(zone_id);
    }

    dataSql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';

    const countRow = await getAsync(countSql, params);
    const total = countRow.total;
    const packages = await allAsync(dataSql, [...params, pageSize, offset]);
    const result = buildPaginationResult(packages, total, page, pageSize);

    res.json(success(result));
  } catch (err) {
    console.error('查询包裹列表失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pkg = await getAsync(
      'SELECT p.*, c.name as courier_name, c.phone as courier_phone, s.name as site_name, dz.name as zone_name FROM package p LEFT JOIN courier c ON p.courier_id = c.id LEFT JOIN site s ON p.site_id = s.id LEFT JOIN delivery_zone dz ON p.zone_id = dz.id WHERE p.id = ?',
      [id]
    );
    if (!pkg) {
      return res.status(404).json(fail('包裹不存在'));
    }
    const [receipt, tracks, codPayment] = await Promise.all([
      getDeliveryReceiptByPackageId(id),
      getPackageTracks(id),
      pkg.is_cod ? getCodPaymentByPackageId(id) : Promise.resolve(null),
    ]);
    const result = { ...pkg };
    if (receipt) {
      result.delivery_receipt = receipt;
    }
    if (codPayment) {
      result.cod_payment = codPayment;
    }
    result.tracks = tracks;
    res.json(success(result));
  } catch (err) {
    console.error('查询包裹详情失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.post('/dispatch/preview', async (req, res) => {
  try {
    const validation = validateDispatch(req.body);
    if (!validation.valid) {
      return res.status(400).json(fail(validation.message));
    }

    const { package_ids } = validation.data;
    const result = await previewDispatch(package_ids);

    res.json(success(result, '智能分派预览完成'));
  } catch (err) {
    console.error('智能分派预览失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.post('/dispatch/confirm', async (req, res) => {
  try {
    const validation = validateDispatch(req.body);
    if (!validation.valid) {
      return res.status(400).json(fail(validation.message));
    }

    const { package_ids, operator_name } = validation.data;
    const result = await confirmDispatch(package_ids, operator_name);

    res.json(success(result, `智能分派确认完成: ${result.summary.success} 成功, ${result.summary.skipped} 跳过, ${result.summary.failed} 失败, ${result.summary.data_error} 数据异常`));
  } catch (err) {
    console.error('智能分派确认失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

module.exports = router;
