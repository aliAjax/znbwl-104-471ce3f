const { Router } = require('express');
const { runAsync, allAsync, getAsync } = require('../db');
const { success, fail } = require('../utils/response');

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
    const { tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight } = req.body;
    if (!receiver_name || !receiver_phone) {
      return res.status(400).json(fail('收件人姓名和手机号不能为空'));
    }
    const finalTrackingNo = tracking_no || generateTrackingNo();
    const existing = await getAsync('SELECT id FROM package WHERE tracking_no = ?', [finalTrackingNo]);
    if (existing) {
      return res.status(400).json(fail('运单号已存在'));
    }
    const result = await runAsync(
      `INSERT INTO package (tracking_no, sender_name, sender_phone, receiver_name, receiver_phone, receiver_address, weight, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CREATED')`,
      [finalTrackingNo, sender_name || null, sender_phone || null, receiver_name, receiver_phone, receiver_address || null, weight || 0]
    );
    const pkg = await getAsync('SELECT * FROM package WHERE id = ?', [result.lastID]);
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
    if (courier.status !== 'ON_DUTY') {
      return res.status(400).json(fail('该快递小哥当前不在岗，无法分配'));
    }
    await runAsync(
      `UPDATE package SET courier_id = ?, status = 'ASSIGNED', updated_at = datetime('now','localtime') WHERE id = ?`,
      [courier_id, id]
    );
    const updated = await getAsync('SELECT * FROM package WHERE id = ?', [id]);
    res.json(success(updated, '包裹已分配给快递小哥'));
  } catch (err) {
    console.error('分配包裹失败:', err);
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
    await runAsync(
      `UPDATE package SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      [status, id]
    );
    const updated = await getAsync('SELECT * FROM package WHERE id = ?', [id]);
    res.json(success(updated, '包裹状态更新成功'));
  } catch (err) {
    console.error('更新包裹状态失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/', async (req, res) => {
  try {
    const { status, courier_id } = req.query;
    let sql = 'SELECT p.*, c.name as courier_name, c.phone as courier_phone FROM package p LEFT JOIN courier c ON p.courier_id = c.id WHERE 1=1';
    const params = [];
    if (status) {
      sql += ' AND p.status = ?';
      params.push(status);
    }
    if (courier_id) {
      sql += ' AND p.courier_id = ?';
      params.push(courier_id);
    }
    sql += ' ORDER BY p.created_at DESC';
    const packages = await allAsync(sql, params);
    res.json(success(packages));
  } catch (err) {
    console.error('查询包裹列表失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pkg = await getAsync(
      'SELECT p.*, c.name as courier_name, c.phone as courier_phone FROM package p LEFT JOIN courier c ON p.courier_id = c.id WHERE p.id = ?',
      [id]
    );
    if (!pkg) {
      return res.status(404).json(fail('包裹不存在'));
    }
    res.json(success(pkg));
  } catch (err) {
    console.error('查询包裹详情失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

module.exports = router;
