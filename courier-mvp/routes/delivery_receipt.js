const { Router } = require('express');
const { success, fail } = require('../utils/response');
const {
  createDeliveryReceipt,
  listDeliveryReceipts,
  getDeliveryReceiptById,
} = require('../services/delivery_receipt');

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { package_id, courier_id, signer_name, sign_method, sign_time } = req.body;
    if (!package_id || !courier_id || !signer_name || !sign_method || !sign_time) {
      return res.status(400).json(fail('package_id、courier_id、signer_name、sign_method 和 sign_time 为必填项'));
    }
    const receipt = await createDeliveryReceipt({ package_id, courier_id, signer_name, sign_method, sign_time });
    res.status(201).json(success(receipt, '签收凭证提交成功，包裹已签收'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('提交签收凭证失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/', async (req, res) => {
  try {
    const { courier_id, package_id } = req.query;
    const receipts = await listDeliveryReceipts({ courier_id, package_id });
    res.json(success(receipts));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询签收凭证列表失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/:id', async (req, res) => {
  try {
    const receipt = await getDeliveryReceiptById(req.params.id);
    res.json(success(receipt));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询签收凭证详情失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

module.exports = router;
