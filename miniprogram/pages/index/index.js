const app = getApp();
const { request } = require("../../utils/request");

Page({
  data: {
    name: "",
    phone: "",
    address: "",
    error: "",
    focusedField: "",
    loggedIn: false,
    loginLoading: false,
    agreementAccepted: false,
    phoneBound: false
  },

  onLoad(options) {
    const stored = wx.getStorageSync("member");
    const memberToken = wx.getStorageSync("memberToken");
    if (stored) {
      this.setData({
        name: stored.name || "",
        phone: stored.phone || "",
        address: stored.address || "",
        phoneBound: Boolean(stored.phoneBound),
        loggedIn: Boolean(memberToken)
      });
    }
    const scene = decodeURIComponent(options.scene || options.source || "");
    if (scene) {
      app.globalData.sourceScene = scene;
      wx.setStorageSync("sourceScene", scene);
    }
  },

  handleInput(event) {
    this.setData({
      [event.currentTarget.dataset.field]: event.detail.value,
      error: ""
    });
  },

  handleFocus(event) {
    this.setData({ focusedField: event.currentTarget.dataset.field });
  },

  handleBlur() {
    this.setData({ focusedField: "" });
  },

  handleAgreementChange(event) {
    this.setData({
      agreementAccepted: event.detail.value.length > 0,
      error: ""
    });
  },

  async wechatLogin() {
    if (!this.data.agreementAccepted) {
      return this.setData({ error: "请先阅读并同意用户协议和隐私政策" });
    }
    if (this.data.loginLoading) return;
    this.setData({ loginLoading: true, error: "" });
    try {
      const code = await new Promise((resolve, reject) => {
        wx.login({
          success(result) {
            if (result.code) resolve(result.code);
            else reject(new Error("没有获取到微信登录凭证"));
          },
          fail() {
            reject(new Error("微信登录失败，请重试"));
          }
        });
      });
      const result = await request("/api/public/wechat-login", {
        method: "POST",
        data: { code }
      });
      const member = result.member || wx.getStorageSync("member") || {};
      wx.setStorageSync("memberToken", result.token);
      app.globalData.memberToken = result.token;
      this.setData({
        loggedIn: true,
        phoneBound: Boolean(member.phoneBound),
        name: member.name || "",
        phone: member.phone || "",
        address: member.address || ""
      });
      wx.showToast({ title: "微信登录成功", icon: "success" });
    } catch (error) {
      const message = String(error.message || "");
      this.setData({
        error: message.includes("网络") || message.includes("request:fail")
          ? "无法连接后台，请确认手机与电脑连接同一 Wi-Fi，并使用最新代码重新预览"
          : message
      });
    } finally {
      this.setData({ loginLoading: false });
    }
  },

  async bindPhoneAndContinue() {
    if (!this.data.loggedIn || !wx.getStorageSync("memberToken")) {
      return this.setData({ error: "请先完成微信登录" });
    }
    const name = this.data.name.trim();
    const phone = this.data.phone.trim();
    const address = this.data.address.trim();
    if (!name) {
      return this.setData({ error: "请填写称呼或姓名" });
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return this.setData({ error: "请填写正确的 11 位手机号" });
    }
    if (!this.data.phoneBound) {
      try {
        await request("/api/public/member/phone", {
          method: "POST",
          headers: { Authorization: `Bearer ${wx.getStorageSync("memberToken")}` },
          data: { phone }
        });
        this.setData({ phoneBound: true, error: "" });
        wx.showToast({ title: "手机号绑定成功", icon: "success" });
      } catch (error) {
        this.setData({ error: error.message });
        wx.showToast({ title: error.message, icon: "none" });
        return;
      }
    }
    const member = { name, phone, address, phoneBound: this.data.phoneBound };
    wx.setStorageSync("member", member);
    app.globalData.member = member;
    wx.navigateTo({ url: "/pages/quote/quote" });
  },

  viewOrders() {
    wx.navigateTo({ url: "/pages/orders/orders" });
  },

  viewCoupons() {
    wx.navigateTo({ url: "/pages/coupons/coupons" });
  },

  viewSupport() {
    wx.navigateTo({ url: "/pages/support/support" });
  },

  onShareAppMessage() {
    return {
      title: "家政收纳服务，在线获取预算",
      path: "/pages/index/index"
    };
  },

  logoutWechat() {
    wx.showModal({
      title: "退出微信登录",
      content: "退出后仅解除微信登录状态，已填写的姓名、手机号和地址会继续保留。",
      confirmText: "退出登录",
      confirmColor: "#b33a3a",
      success: (result) => {
        if (!result.confirm) return;
        wx.removeStorageSync("memberToken");
        app.globalData.memberToken = null;
        this.setData({
          loggedIn: false,
          agreementAccepted: false,
          phoneBound: false,
          focusedField: "",
          error: ""
        });
        wx.showToast({ title: "已退出微信登录", icon: "success" });
      }
    });
  }
});
