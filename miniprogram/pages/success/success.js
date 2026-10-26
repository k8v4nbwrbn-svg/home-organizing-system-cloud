Page({
  data: {
    result: null
  },

  onLoad() {
    this.setData({
      result: wx.getStorageSync("lastQuoteResult") || null
    });
  },

  backHome() {
    wx.reLaunch({ url: "/pages/index/index" });
  },

  viewOrders() {
    wx.navigateTo({ url: "/pages/orders/orders" });
  }
});
