function success(data = null, message = '操作成功') {
  return { code: 0, message, data };
}

function fail(message = '操作失败', code = -1) {
  return { code, message, data: null };
}

module.exports = { success, fail };
