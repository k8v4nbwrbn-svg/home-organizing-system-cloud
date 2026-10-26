const { apiBase } = require("../../config");
const { request } = require("../../utils/request");

Page({
  data: {
    loading: true,
    agents: [],
    error: ""
  },

  onLoad() {
    this.loadAgents();
  },

  async loadAgents() {
    try {
      const result = await request("/api/public/support-agents");
      const agents = (result.agents || []).map((item) => ({
        ...item,
        qrUrl: item.qrPath.startsWith("data:")
          ? item.qrPath
          : `${apiBase.replace(/\/$/, "")}${item.qrPath}`
      }));
      this.setData({ agents, loading: false });
    } catch (error) {
      this.setData({ loading: false, error: error.message });
    }
  },

  previewQr(event) {
    const url = event.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url], current: url });
  },

  onShareAppMessage() {
    return {
      title: "家政收纳服务，在线获取预算",
      path: "/pages/index/index"
    };
  }
});
