const { Router } = require('express');
const { runAsync, allAsync, getAsync } = require('../db');
const { success, fail } = require('../utils/response');

const router = Router();

const VALID_COURIER_STATUSES = ['ON_DUTY', 'OFF_DUTY'];

router.post('/', async (req, res) => {
  try {
    const { name, phone, status } = req.body;
    if (!name || !phone) {
      return res.status(400).json(fail('姓名和手机号不能为空'));
    }
    const courierStatus = status || 'ON_DUTY';
    if (!VALID_COURIER_STATUSES.includes(courierStatus)) {
      return res.status(400).json(fail(`无效的状态，可选值: ${VALID_COURIER_STATUSES.join(', ')}`));
    }
    const existing = await getAsync('SELECT id FROM courier WHERE phone = ?', [phone]);
    if (existing) {
      return res.status(400).json(fail('该手机号已存在'));
    }
    const result = await runAsync(
      'INSERT INTO courier (name, phone, status) VALUES (?, ?, ?)',
      [name, phone, courierStatus]
    );
    const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [result.lastID]);
    res.status(201).json(success(courier, '快递小哥创建成功'));
  } catch (err) {
    console.error('创建快递小哥失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/', async (req, res) => {
  try {
    const couriers = await allAsync('SELECT * FROM courier ORDER BY created_at DESC');
    res.json(success(couriers));
  } catch (err) {
    console.error('查询快递小哥列表失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/:id/packages', async (req, res) => {
  try {
    const { id } = req.params;
    const courier = await getAsync('SELECT * FROM courier WHERE id = ?', [id]);
    if (!courier) {
      return res.status(404).json(fail('快递小哥不存在'));
    }
    const packages = await allAsync(
      `SELECT * FROM package WHERE courier_id = ? AND status NOT IN ('DELIVERED', 'FAILED') ORDER BY created_at DESC`,
      [id]
    );
    res.json(success(packages, `快递小哥 ${courier.name} 的待派送包裹`));
  } catch (err) {
    console.error('查询待派送包裹失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

module.exports = router;
