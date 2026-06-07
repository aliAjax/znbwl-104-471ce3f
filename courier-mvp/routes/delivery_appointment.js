const { Router } = require('express');
const { success, fail } = require('../utils/response');
const {
  createAppointment,
  updateAppointment,
  cancelAppointment,
  getAppointmentByPackageId,
  getAppointmentChangeLogs,
  OPERATOR_TYPES,
  DELIVERY_PREFERENCES,
  APPOINTMENT_STATUSES,
} = require('../services/delivery_appointment');

const router = Router();

router.post('/', async (req, res) => {
  try {
    const {
      package_id,
      appointment_start,
      appointment_end,
      delivery_preference,
      remark,
      operator_type,
      operator_id,
      operator_name,
      change_reason,
    } = req.body;

    if (!package_id) {
      return res.status(400).json(fail('包裹ID不能为空'));
    }
    if (!appointment_start) {
      return res.status(400).json(fail('预约开始时间不能为空'));
    }
    if (!appointment_end) {
      return res.status(400).json(fail('预约结束时间不能为空'));
    }
    if (!operator_type) {
      return res.status(400).json(fail('操作者类型不能为空'));
    }
    if (!Object.values(OPERATOR_TYPES).includes(operator_type)) {
      return res.status(400).json(fail(`操作者类型无效，可选值: ${Object.values(OPERATOR_TYPES).join(', ')}`));
    }

    const appointment = await createAppointment({
      packageId: package_id,
      appointmentStart: appointment_start,
      appointmentEnd: appointment_end,
      deliveryPreference: delivery_preference,
      remark,
      operatorType: operator_type,
      operatorId: operator_id,
      operatorName: operator_name,
      changeReason: change_reason,
    });

    res.status(201).json(success(appointment, '预约创建成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('创建预约失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.put('/:packageId', async (req, res) => {
  try {
    const { packageId } = req.params;
    const {
      appointment_start,
      appointment_end,
      delivery_preference,
      remark,
      operator_type,
      operator_id,
      operator_name,
      change_reason,
    } = req.body;

    if (!operator_type) {
      return res.status(400).json(fail('操作者类型不能为空'));
    }
    if (!Object.values(OPERATOR_TYPES).includes(operator_type)) {
      return res.status(400).json(fail(`操作者类型无效，可选值: ${Object.values(OPERATOR_TYPES).join(', ')}`));
    }

    const appointment = await updateAppointment({
      packageId: Number(packageId),
      appointmentStart: appointment_start,
      appointmentEnd: appointment_end,
      deliveryPreference: delivery_preference,
      remark,
      operatorType: operator_type,
      operatorId: operator_id,
      operatorName: operator_name,
      changeReason: change_reason,
    });

    res.json(success(appointment, '预约更新成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('更新预约失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.put('/:packageId/cancel', async (req, res) => {
  try {
    const { packageId } = req.params;
    const {
      operator_type,
      operator_id,
      operator_name,
      change_reason,
    } = req.body;

    if (!operator_type) {
      return res.status(400).json(fail('操作者类型不能为空'));
    }
    if (!Object.values(OPERATOR_TYPES).includes(operator_type)) {
      return res.status(400).json(fail(`操作者类型无效，可选值: ${Object.values(OPERATOR_TYPES).join(', ')}`));
    }

    const appointment = await cancelAppointment({
      packageId: Number(packageId),
      operatorType: operator_type,
      operatorId: operator_id,
      operatorName: operator_name,
      changeReason: change_reason,
    });

    res.json(success(appointment, '预约取消成功'));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('取消预约失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/package/:packageId', async (req, res) => {
  try {
    const { packageId } = req.params;
    const appointment = await getAppointmentByPackageId(Number(packageId));
    if (!appointment) {
      return res.status(404).json(fail('该包裹暂无预约'));
    }
    res.json(success(appointment));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询预约失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/package/:packageId/change-logs', async (req, res) => {
  try {
    const { packageId } = req.params;
    const logs = await getAppointmentChangeLogs(Number(packageId));
    res.json(success(logs));
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json(fail(err.message));
    }
    console.error('查询预约变更记录失败:', err);
    res.status(500).json(fail('服务器内部错误'));
  }
});

router.get('/meta', (req, res) => {
  res.json(success({
    operator_types: OPERATOR_TYPES,
    delivery_preferences: DELIVERY_PREFERENCES,
    appointment_statuses: APPOINTMENT_STATUSES,
  }));
});

module.exports = router;
