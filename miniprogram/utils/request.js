const { apiBase } = require("../config");

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${apiBase}${path}`,
      method: options.method || "GET",
      data: options.data || undefined,
      header: {
        "content-type": "application/json",
        ...(options.headers || {})
      },
      timeout: 15000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        reject(new Error(response.data?.error || "服务暂时不可用"));
      },
      fail(error) {
        reject(new Error(error.errMsg || "网络连接失败"));
      }
    });
  });
}

module.exports = { request };
