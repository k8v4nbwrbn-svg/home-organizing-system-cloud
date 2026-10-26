const { request } = require("../../utils/request");

const statusLabels = {
  available: "可使用",
  used: "已使用",
  expired: "已过期",
  disabled: "已停用"
};

Page({
  data: {
    loading: true,
    coupons: [],
    error: ""
  },

  onShow() {
    this.loadCoupons();
  },

  onPullDownRefresh() {
    this.loadCoupons().finally(() => wx.stopPullDownRefresh());
  },

  async loadCoupons() {
    const token = wx.getStorageSync("memberToken");
    if (!token) {
      wx.redirectTo({ url: "/pages/index/index" });
      return;
    }
    this.setData({ loading: true, error: "" });
    try {
      const result = await request("/api/public/coupons", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const coupons = (result.coupons || []).map((item) => ({
        ...item,
        statusLabel: statusLabels[item.status] || item.status,
        ruleText: item.discountType === "percent"
          ? `减免 ${item.discountValue}% · 满 ¥${item.minimumSpend} 可用`
          : `立减 ¥${item.discountValue} · 满 ¥${item.minimumSpend} 可用`,
        validText: formatValidity(item),
        usedText: item.usedAt ? formatTime(item.usedAt) : ""
      }));
      this.setData({ coupons, loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error.message });
      if (error.message.includes("登录")) {
        wx.removeStorageSync("memberToken");
        setTimeout(() => wx.redirectTo({ url: "/pages/index/index" }), 900);
      }
    }
  },

  goService() {
    wx.reLaunch({ url: "/pages/index/index" });
  }
});

function formatValidity(coupon) {
  if (!coupon.validFrom && !coupon.validUntil) return "长期有效";
  return `${coupon.validFrom || "立即"} 至 ${coupon.validUntil || "长期"}`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
