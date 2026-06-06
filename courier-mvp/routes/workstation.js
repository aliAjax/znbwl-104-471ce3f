const { Router } = require('express');
const { success, fail } = require('../utils/response');
const {
  getCourierDailyStats,
  getCourierPendingPackages,
  getCourierDashboard,
  updateCourierStatus,
} = require('../services/workstation');

const router = Router();

router.get('/:courierId/dashboard', async (req, res) => {
  try {
    const { courierId } = req.params;
    const dashboard = await getCourierDashboard(courierId);
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
    const packages = await getCourierPendingPackages(courierId);
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
    const { status } = req.body;
    if (!status) {
      return res.status(400).json(fail('状态不能为空'));
    }
    const updatedCourier = await updateCourierStatus(courierId, status);
    res.json(success(updatedCourier, '快递小哥状态更新成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('更新快递小哥状态失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

module.exports = router;
