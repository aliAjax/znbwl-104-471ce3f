const BATCH_ASSIGN_MAX_COUNT = 100;
const DISPATCH_MAX_COUNT = 200;

function validateBatchAssign(body) {
  const { package_ids, courier_id } = body;

  if (!Number.isInteger(courier_id) || courier_id <= 0) {
    return { valid: false, message: '快递小哥ID必须为正整数' };
  }
  if (!Array.isArray(package_ids) || package_ids.length === 0) {
    return { valid: false, message: '请提供包裹ID列表（非空数组）' };
  }
  if (package_ids.length > BATCH_ASSIGN_MAX_COUNT) {
    return { valid: false, message: `单次批量分配不超过${BATCH_ASSIGN_MAX_COUNT}个包裹` };
  }
  const hasInvalid = package_ids.some(id => !Number.isInteger(id) || id <= 0);
  if (hasInvalid) {
    return { valid: false, message: '包裹ID必须为正整数' };
  }
  const uniqueIds = [...new Set(package_ids)];
  if (uniqueIds.length !== package_ids.length) {
    return { valid: false, message: '包裹ID列表中存在重复值' };
  }

  return { valid: true, data: { package_ids: uniqueIds, courier_id } };
}

function validateDispatch(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, message: '请求体不能为空且必须为JSON对象' };
  }

  const { package_ids, operator_name } = body;

  if (package_ids === null || package_ids === undefined) {
    return { valid: false, message: '请提供 package_ids 参数' };
  }

  if (!Array.isArray(package_ids)) {
    return { valid: false, message: 'package_ids 必须为数组类型' };
  }

  if (package_ids.length === 0) {
    return { valid: false, message: '包裹ID列表不能为空' };
  }

  if (package_ids.length > DISPATCH_MAX_COUNT) {
    return { valid: false, message: `单次智能分派不超过${DISPATCH_MAX_COUNT}个包裹` };
  }

  const validIds = package_ids.filter(id => id !== null && id !== undefined);
  const uniqueIds = [...new Set(validIds)];

  if (operator_name !== undefined && typeof operator_name !== 'string') {
    return { valid: false, message: 'operator_name 必须为字符串类型' };
  }

  if (operator_name && operator_name.length > 100) {
    return { valid: false, message: 'operator_name 长度不能超过100个字符' };
  }

  return {
    valid: true,
    data: {
      package_ids: uniqueIds,
      operator_name: operator_name || '系统运营',
    },
  };
}

module.exports = {
  validateBatchAssign,
  validateDispatch,
  BATCH_ASSIGN_MAX_COUNT,
  DISPATCH_MAX_COUNT,
};
