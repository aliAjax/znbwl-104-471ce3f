const { Router } = require('express');
const { success, fail } = require('../utils/response');
const { parsePaginationParams, buildPaginationResult } = require('../utils/pagination');
const {
  createCodPayment,
  getCodPaymentByPackageId,
  listCodPayments,
  getCourierDailyCodSummary,
  getCodSettlementReport,
  getPendingCodPackagesForCourier,
  generateDailySettlement,
  listDailySettlements,
  getDailySettlementDetail,
  VALID_PAYMENT_METHODS,
} = require('../services/cod_payment');
const { OPERATOR_TYPES } = require('../services/package_track');

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { package_id, courier_id, payment_method, amount, waived_reason, operator_type, operator_id, operator_name, remark } = req.body;
    if (!package_id || !courier_id || !payment_method) {
      return res.status(400).json(fail('package_id、courier_id、payment_method 为必填项'));
    }
    if (!VALID_PAYMENT_METHODS.includes(payment_method)) {
      return res.status(400).json(fail(`无效的收款方式，可选值: ${VALID_PAYMENT_METHODS.join(', ')}`));
    }
    const finalOperatorType = operator_type || OPERATOR_TYPES.COURIER;
    const payment = await createCodPayment({
      package_id,
      courier_id,
      payment_method,
      amount,
      waived_reason,
      operator_type: finalOperatorType,
      operator_id: operator_id || courier_id,
      operator_name,
      remark,
    });
    res.status(201).json(success(payment, '到付收款记录成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('记录到付收款失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/', async (req, res) => {
  try {
    const { courier_id, start_date, end_date, payment_method, site_id, page, pageSize } = req.query;
    const payments = await listCodPayments({ courier_id, start_date, end_date, payment_method, site_id });
    res.json(success(payments));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询到付收款列表失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/package/:packageId', async (req, res) => {
  try {
    const { packageId } = req.params;
    const payment = await getCodPaymentByPackageId(packageId);
    if (!payment) {
      return res.status(404).json(fail('该包裹暂无到付收款记录'));
    }
    res.json(success(payment));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询包裹到付收款记录失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/courier/:courierId/daily-summary', async (req, res) => {
  try {
    const { courierId } = req.params;
    const { date } = req.query;
    const summary = await getCourierDailyCodSummary(courierId, date);
    res.json(success(summary, '小哥今日到付收款汇总查询成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询小哥到付收款汇总失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/courier/:courierId/pending', async (req, res) => {
  try {
    const { courierId } = req.params;
    const packages = await getPendingCodPackagesForCourier(courierId);
    res.json(success(packages, '待收款到付包裹查询成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询待收款到付包裹失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/settlement-report', async (req, res) => {
  try {
    const { courier_id, site_id, start_date, end_date } = req.query;
    const report = await getCodSettlementReport({ courier_id, site_id, start_date, end_date });
    res.json(success(report, '日结报表查询成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询日结报表失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.post('/daily-settlements', async (req, res) => {
  try {
    const { courier_id, settlement_date, operator_name } = req.body;
    if (!courier_id) {
      return res.status(400).json(fail('courier_id 为必填项'));
    }
    const settlement = await generateDailySettlement({
      courier_id,
      settlement_date,
      operator_name,
    });
    res.status(201).json(success(settlement, '日结单生成成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('生成日结单失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/daily-settlements', async (req, res) => {
  try {
    const { courier_id, site_id, start_date, end_date, status } = req.query;
    const settlements = await listDailySettlements({
      courier_id,
      site_id,
      start_date,
      end_date,
      status,
    });
    res.json(success(settlements, '日结单列表查询成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询日结单列表失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/daily-settlements/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const detail = await getDailySettlementDetail(id);
    res.json(success(detail, '日结单详情查询成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询日结单详情失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/meta', (req, res) => {
  res.json(success({
    payment_methods: VALID_PAYMENT_METHODS,
    operator_types: Object.values(OPERATOR_TYPES),
  }));
});

module.exports = router;
