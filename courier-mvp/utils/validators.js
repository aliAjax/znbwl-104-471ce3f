const BATCH_ASSIGN_MAX_COUNT = 100;

function validateBatchAssign(body) {
  const { package_ids, courier_id } = body;

  if (!courier_id) {
    return { valid: false, message: '请指定快递小哥ID' };
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

module.exports = {
  validateBatchAssign,
  BATCH_ASSIGN_MAX_COUNT,
};
