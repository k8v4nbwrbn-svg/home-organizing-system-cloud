const app = getApp();
const { request } = require("../../utils/request");
const { calculateLocalQuote } = require("../../utils/quote");

Page({
  data: {
    pricing: null,
    layouts: ["大平层", "复式", "别墅"],
    layoutIndex: 0,
    area: "90",
    rooms: "3",
    serviceOptions: [],
    serviceGroups: [],
    selectedServices: [],
    urgencyOptions: [{ key: "normal", label: "普通预约", multiplier: 1 }],
    urgencyIndex: 0,
    preferredDate: "",
    needs: "",
    quote: null,
    coupons: [],
    selectedCouponId: "",
    loading: true,
    submitting: false,
    error: "",
    serviceLabels: "",
    selectedServiceCount: 0
  },

  onLoad() {
    const member = wx.getStorageSync("member");
    const memberToken = wx.getStorageSync("memberToken");
    if (!member?.phone || !memberToken) {
      wx.redirectTo({ url: "/pages/index/index" });
      return;
    }
    this.loadPricing();
  },

  async loadPricing() {
    try {
      const pricing = await request("/api/public/pricing");
      const serviceOptions = (pricing.serviceOptions || []).map((item) => ({
        ...item,
        group: item.group || "其他服务",
        checked: false
      }));
      const urgencyOptions = pricing.urgencyOptions || [];
      this.setData({
        pricing,
        serviceOptions,
        serviceGroups: this.groupServiceOptions(serviceOptions, []),
        urgencyOptions,
        loading: false
      });
      await this.loadCoupons();
      this.refreshQuote();
    } catch (error) {
      this.setData({ loading: false, error: error.message });
    }
  },

  handleArea(event) {
    this.setData({ area: event.detail.value, error: "" });
    this.queueQuote();
  },

  handleRooms(event) {
    this.setData({ rooms: event.detail.value, error: "" });
    this.queueQuote();
  },

  handleLayout(event) {
    this.setData({ layoutIndex: Number(event.detail.value), error: "" });
  },

  handleUrgency(event) {
    this.setData({ urgencyIndex: Number(event.detail.value), error: "" });
    this.queueQuote();
  },

  handleDate(event) {
    this.setData({ preferredDate: event.detail.value, error: "" });
  },

  handleNeeds(event) {
    this.setData({ needs: event.detail.value, error: "" });
  },

  async loadCoupons() {
    try {
      const result = await request("/api/public/coupons", {
        headers: { Authorization: `Bearer ${wx.getStorageSync("memberToken")}` }
      });
      const coupons = (result.coupons || [])
        .filter((item) => item.status === "available")
        .map((item) => ({
          ...item,
          ruleText: item.discountType === "percent"
            ? `减免 ${item.discountValue}% · 满 ¥${item.minimumSpend} 可用`
            : `立减 ¥${item.discountValue} · 满 ¥${item.minimumSpend} 可用`
        }));
      const selectedCouponId = coupons.some((item) => item.id === this.data.selectedCouponId)
        ? this.data.selectedCouponId
        : "";
      this.setData({ coupons, selectedCouponId });
    } catch (error) {
      this.setData({ coupons: [] });
    }
  },

  toggleCoupon(event) {
    const couponId = event.currentTarget.dataset.id;
    this.setData({
      selectedCouponId: this.data.selectedCouponId === couponId ? "" : couponId,
      error: ""
    }, () => this.refreshQuote());
  },

  toggleService(event) {
    const key = event.currentTarget.dataset.key;
    const current = this.data.selectedServices || [];
    const selected = current.indexOf(key) >= 0
      ? current.filter((item) => item !== key)
      : current.concat(key);
    const serviceOptions = this.data.serviceOptions.map((item) => ({
      ...item,
      checked: selected.indexOf(item.key) >= 0
    }));
    this.setData({
      selectedServices: selected,
      serviceOptions,
      serviceGroups: this.groupServiceOptions(serviceOptions, selected),
      serviceLabels: serviceOptions.filter((item) => selected.indexOf(item.key) >= 0).map((item) => item.label).join("、"),
      selectedServiceCount: selected.length,
      error: ""
    });
    this.queueQuote();
  },

  groupServiceOptions(options, selected) {
    const groups = [];
    const index = {};
    options.forEach((item) => {
      const name = item.group || "其他服务";
      if (!index[name]) {
        index[name] = { name, options: [] };
        groups.push(index[name]);
      }
      index[name].options.push({
        ...item,
        checked: selected.indexOf(item.key) >= 0
      });
    });
    return groups;
  },

  queueQuote() {
    clearTimeout(this.quoteTimer);
    this.quoteTimer = setTimeout(() => this.refreshQuote(), 16);
  },

  refreshQuote() {
    if (!this.data.pricing) return;
    try {
      const coupon = this.data.coupons.find((item) => item.id === this.data.selectedCouponId) || null;
      const quote = calculateLocalQuote(this.data.pricing, {
        area: Number(this.data.area),
        rooms: Number(this.data.rooms),
        serviceKeys: this.data.selectedServices,
        urgency: this.data.urgencyOptions[this.data.urgencyIndex]?.key || "normal"
      }, coupon);
      this.setData({ quote });
    } catch {
      this.setData({ quote: null });
    }
  },

  async submit() {
    if (this.data.submitting) return;
    if (!this.data.quote) {
      return this.setData({ error: "请先检查房屋面积并完成报价" });
    }
    if (this.data.quote.couponWarning) {
      return this.setData({ error: this.data.quote.couponWarning });
    }
    this.setData({ submitting: true, error: "" });
    try {
      const member = wx.getStorageSync("member");
      const result = await request("/api/public/leads", {
        method: "POST",
        data: {
          member,
          memberToken: wx.getStorageSync("memberToken"),
          couponId: this.data.selectedCouponId,
          profile: {
            area: Number(this.data.area),
            layout: this.data.layouts[this.data.layoutIndex],
            rooms: Number(this.data.rooms),
            serviceKeys: this.data.selectedServices,
            needs: this.data.needs,
            preferredDate: this.data.preferredDate,
            urgency: this.data.urgencyOptions[this.data.urgencyIndex]?.key || "normal"
          },
          sourceScene: app.globalData.sourceScene || wx.getStorageSync("sourceScene") || ""
        }
      });
      wx.setStorageSync("lastQuoteResult", {
        ...result,
        member,
        layout: this.data.layouts[this.data.layoutIndex],
        preferredDate: this.data.preferredDate,
        needs: this.data.needs
      });
      wx.navigateTo({ url: "/pages/success/success" });
    } catch (error) {
      this.setData({ error: error.message });
      if (error.message.includes("微信登录")) {
        wx.removeStorageSync("memberToken");
        setTimeout(() => wx.redirectTo({ url: "/pages/index/index" }), 900);
      }
    } finally {
      this.setData({ submitting: false });
    }
  }
});
