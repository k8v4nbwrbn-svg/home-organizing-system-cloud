const { request } = require("../../utils/request");

const statusLabels = {
  new: "新线索",
  contacted: "沟通中",
  quoted: "已报价",
  visiting: "待上门",
  won: "已成交",
  lost: "已结束"
};

Page({
  data: {
    loading: true,
    orders: [],
    error: ""
  },

  onShow() {
    this.loadOrders();
  },

  onPullDownRefresh() {
    this.loadOrders().finally(() => wx.stopPullDownRefresh());
  },

  async loadOrders() {
    const token = wx.getStorageSync("memberToken");
    if (!token) {
      wx.redirectTo({ url: "/pages/index/index" });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const result = await request("/api/public/me/leads", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const orders = (result.leads || []).map((item) => ({
        ...item,
        statusLabel: statusLabels[item.status] || item.status,
        createdText: formatTime(item.createdAt),
        serviceText: item.serviceLabels || "基础服务"
      }));
      this.setData({ orders, loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error.message });
      if (error.message.includes("登录")) {
        wx.removeStorageSync("memberToken");
        setTimeout(() => wx.redirectTo({ url: "/pages/index/index" }), 900);
      }
    }
  },

  backToService() {
    wx.reLaunch({ url: "/pages/index/index" });
  }
});

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
