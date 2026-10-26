App({
  globalData: {
    member: null,
    lastQuoteResult: null,
    sourceScene: ""
  },

  onLaunch() {
    this.globalData.member = wx.getStorageSync("member") || null;
    this.globalData.sourceScene = wx.getStorageSync("sourceScene") || "";
  }
});
