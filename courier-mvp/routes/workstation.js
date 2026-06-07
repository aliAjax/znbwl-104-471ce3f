const { Router } = require('express');
const { success, fail } = require('../utils/response');
const {
  getCourierDailyStats,
  getCourierPendingPackages,
  getCourierDashboard,
  updateCourierStatus,
} = require('../services/workstation');
const {
  listCodPayments,
  getCourierDailyCodSummary,
  getPendingCodPackagesForCourier,
} = require('../services/cod_payment');
const {
  previewHandover,
  executeHandover,
} = require('../services/handover');

const router = Router();

router.get('/:courierId/dashboard', async (req, res) => {
  try {
    const { courierId } = req.params;
    const { appointment_filter } = req.query;
    const dashboard = await getCourierDashboard(courierId, appointment_filter);
    res.json(success(dashboard, '工作台数据查询成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询工作台数据失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/:courierId/stats', async (req, res) => {
  try {
    const { courierId } = req.params;
    const stats = await getCourierDailyStats(courierId);
    res.json(success(stats, '今日统计查询成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询今日统计失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/:courierId/pending-packages', async (req, res) => {
  try {
    const { courierId } = req.params;
    const { appointment_filter } = req.query;
    const packages = await getCourierPendingPackages(courierId, appointment_filter);
    res.json(success(packages, '待处理包裹列表查询成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询待处理包裹失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.put('/:courierId/status', async (req, res) => {
  try {
    const { courierId } = req.params;
    const { status, allow_handover } = req.body;
    if (!status) {
      return res.status(400).json(fail('状态不能为空'));
    }
    const options = {};
    if (allow_handover !== undefined) {
      options.allow_handover = allow_handover;
    }
    const updatedCourier = await updateCourierStatus(courierId, status, options);
    res.json(success(updatedCourier, '快递小哥状态更新成功'));
  } catch (err) {
    if (err.statusCode) {
      const response = {
        message: err.message,
      };
      if (err.need_handover !== undefined) {
        response.need_handover = err.need_handover;
      }
      if (err.unfinished_count !== undefined) {
        response.unfinished_count = err.unfinished_count;
      }
      return res.status(err.statusCode).json(fail(response));
    }
    console.error('更新快递小哥状态失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/:courierId/cod/payments', async (req, res) => {
  try {
    const { courierId } = req.params;
    const { start_date, end_date, payment_method } = req.query;
    const payments = await listCodPayments({
      courier_id: courierId,
      start_date,
      end_date,
      payment_method,
    });
    res.json(success(payments, '到付收款明细查询成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询到付收款明细失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/:courierId/cod/summary', async (req, res) => {
  try {
    const { courierId } = req.params;
    const { date } = req.query;
    const summary = await getCourierDailyCodSummary(courierId, date);
    res.json(success(summary, '到付收款汇总查询成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询到付收款汇总失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/:courierId/cod/pending', async (req, res) => {
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

router.get('/:courierId/handover/preview', async (req, res) => {
  try {
    const { courierId } = req.params;
    const { package_ids } = req.query;
    let packageIds = null;
    if (package_ids) {
      packageIds = Array.isArray(package_ids)
        ? package_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id))
        : package_ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    }
    const preview = await previewHandover(parseInt(courierId, 10), packageIds);
    res.json(success(preview, '交接预览成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('交接预览失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.post('/:courierId/handover/execute', async (req, res) => {
  try {
    const { courierId } = req.params;
    const { package_ids, target_courier_id, operator_name } = req.body;
    if (!package_ids || !Array.isArray(package_ids) || package_ids.length === 0) {
      return res.status(400).json(fail('请选择需要交接的包裹'));
    }
    const packageIds = package_ids.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    if (packageIds.length === 0) {
      return res.status(400).json(fail('包裹ID格式无效'));
    }
    const result = await executeHandover(
      parseInt(courierId, 10),
      packageIds,
      target_courier_id ? parseInt(target_courier_id, 10) : null,
      operator_name
    );
    res.json(success(result, '交接执行完成'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('执行交接失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

module.exports = router;
