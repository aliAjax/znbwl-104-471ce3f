const { Router } = require('express');
const { success, fail } = require('../utils/response');
const {
  createException,
  listExceptions,
  getExceptionById,
  updateExceptionStatus,
  VALID_EXCEPTION_TYPES,
  VALID_EXCEPTION_STATUSES,
} = require('../services/exception');

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { package_id, courier_id, exception_type, description, on_site_remark } = req.body;
    if (!package_id || !courier_id || !exception_type) {
      return res.status(400).json(fail('package_id、courier_id 和 exception_type 为必填项'));
    }
    const record = await createException({ package_id, courier_id, exception_type, description, on_site_remark });
    res.status(201).json(success(record, '异常件登记成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('登记异常件失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/', async (req, res) => {
  try {
    const { status, courier_id, package_id } = req.query;
    const records = await listExceptions({ status, courier_id, package_id });
    res.json(success(records));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询异常件列表失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/:id', async (req, res) => {
  try {
    const record = await getExceptionById(req.params.id);
    res.json(success(record));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询异常件详情失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json(fail('请指定新的异常状态'));
    }
    const record = await updateExceptionStatus(req.params.id, status);
    res.json(success(record, '异常状态更新成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('更新异常状态失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

module.exports = router;
