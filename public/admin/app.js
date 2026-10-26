const app = {
  pricing: null,
  leads: [],
  coupons: [],
  supportAgents: [],
  paidCustomers: [],
  overview: null,
  currentLeadId: null,
  issueCampaignId: "",
  eventSource: null
};

const statusLabels = {
  new: "新线索",
  contacted: "沟通中",
  quoted: "已报价",
  visiting: "待上门",
  won: "已成交",
  lost: "已流失"
};

const couponStatusLabels = {
  available: "可使用",
  used: "已使用",
  expired: "已过期",
  disabled: "已停用"
};

const pageTitles = {
  dashboard: "工作台",
  leads: "客户线索",
  payments: "收费客户",
  trash: "回收箱",
  coupons: "优惠券",
  support: "客服设置",
  pricing: "报价设置",
  qr: "小程序码"
};

const view = {
  login: document.querySelector("#loginView"),
  app: document.querySelector("#appView"),
  loginForm: document.querySelector("#loginForm"),
  loginPassword: document.querySelector("#loginPassword"),
  loginError: document.querySelector("#loginError"),
  leadDialog: document.querySelector("#leadDialog"),
  leadDialogContent: document.querySelector("#leadDialogContent"),
  toast: document.querySelector("#toast"),
  realtimeState: document.querySelector("#realtimeState")
};

let pendingSupportQrDataUrl = "";

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindNavigation();
  bindForms();
  await checkAuth();
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });
  document.querySelector("#logoutButton").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    view.app.hidden = true;
    view.login.hidden = false;
    view.loginPassword.value = "";
  });
  document.querySelector("#refreshButton").addEventListener("click", () => loadAll(true));
  document.querySelector("#searchLeadsButton").addEventListener("click", loadLeads);
  document.querySelector("#searchTrashButton").addEventListener("click", loadTrash);
  document.querySelector("#searchPaymentsButton").addEventListener("click", loadPayments);
  document.querySelector("#leadSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadLeads();
  });
  document.querySelector("#leadStatusFilter").addEventListener("change", loadLeads);
  document.querySelector("#paymentTypeFilter").addEventListener("change", loadPayments);
  document.querySelector("#paymentSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadPayments();
  });
  document.querySelector("#trashSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadTrash();
  });
  document.querySelector("#reloadQrButton").addEventListener("click", loadQr);
  document.querySelector("#addServiceButton").addEventListener("click", () => addRuleRow("service"));
  document.querySelector("#addUrgencyButton").addEventListener("click", () => addRuleRow("urgency"));
  document.querySelector("#previewQuoteButton").addEventListener("click", previewQuote);
  document.querySelector("#couponDiscountType").addEventListener("change", updateCouponValueLabel);
  document.querySelector("#supportQrFile").addEventListener("change", previewSupportQr);
  document.querySelector("#supportCancelEdit").addEventListener("click", resetSupportForm);
  document.querySelector("#couponMemberSearchButton").addEventListener("click", searchCouponMembers);
  document.querySelector("#couponMemberSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchCouponMembers();
    }
  });
}

function bindForms() {
  view.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    view.loginError.hidden = true;
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: view.loginPassword.value })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      view.loginError.textContent = data.error || "登录失败";
      view.loginError.hidden = false;
      return;
    }
    await enterApp();
  });

  document.querySelector("#pricingForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const pricing = readPricingForm();
    const state = document.querySelector("#pricingSaveState");
    state.textContent = "正在保存…";
    try {
      const data = await api("/api/admin/pricing", {
        method: "PUT",
        body: { pricing }
      });
      app.pricing = data.pricing;
      renderPricingForm(data.pricing);
      state.textContent = `已保存 ${formatTime(data.updatedAt)}`;
      showToast("报价规则已保存");
      previewQuote();
    } catch (error) {
      state.textContent = "";
      showToast(error.message, true);
    }
  });

  document.querySelector("#couponForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = document.querySelector("#couponSaveState");
    state.textContent = "正在发布…";
    try {
      await api("/api/admin/coupons", {
        method: "POST",
        body: {
          name: document.querySelector("#couponName").value.trim(),
          discountType: document.querySelector("#couponDiscountType").value,
          discountValue: Number(document.querySelector("#couponValue").value),
          minimumSpend: Number(document.querySelector("#couponMinimum").value),
          totalQuantity: Number(document.querySelector("#couponQuantity").value),
          perMemberLimit: Number(document.querySelector("#couponPerMember").value),
          validFrom: document.querySelector("#couponValidFrom").value,
          validUntil: document.querySelector("#couponValidUntil").value
        }
      });
      document.querySelector("#couponForm").reset();
      document.querySelector("#couponMinimum").value = "0";
      document.querySelector("#couponQuantity").value = "100";
      document.querySelector("#couponPerMember").value = "1";
      updateCouponValueLabel();
      state.textContent = "优惠券已发布";
      showToast("优惠券发布成功");
      await loadAll();
    } catch (error) {
      state.textContent = "";
      showToast(error.message, true);
    }
  });

  document.querySelector("#supportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const editingId = document.querySelector("#supportEditingId").value;
    const state = document.querySelector("#supportSaveState");
    if (!editingId && !pendingSupportQrDataUrl) {
      state.textContent = "请上传客服微信二维码";
      return;
    }
    state.textContent = "正在保存…";
    const payload = {
      name: document.querySelector("#supportName").value.trim(),
      wechatId: document.querySelector("#supportWechatId").value.trim(),
      sortOrder: Number(document.querySelector("#supportSortOrder").value || 0),
      active: true
    };
    if (pendingSupportQrDataUrl) payload.qrDataUrl = pendingSupportQrDataUrl;
    try {
      await api(editingId ? `/api/admin/support-agents/${editingId}` : "/api/admin/support-agents", {
        method: editingId ? "PATCH" : "POST",
        body: payload
      });
      showToast(editingId ? "客服信息已更新" : "客服已新增");
      resetSupportForm();
      await loadAll();
    } catch (error) {
      state.textContent = "";
      showToast(error.message, true);
    }
  });
}

async function checkAuth() {
  try {
    await api("/api/admin/me");
    await enterApp();
  } catch {
    view.login.hidden = false;
    view.app.hidden = true;
  }
}

async function enterApp() {
  view.login.hidden = true;
  view.app.hidden = false;
  const hashPage = location.hash.replace("#", "");
  showPage(pageTitles[hashPage] ? hashPage : "dashboard");
  await loadAll();
  connectEvents();
}

async function loadAll(showRefreshToast = false) {
  try {
    const [overview, pricing, couponData, supportAgents, paymentData] = await Promise.all([
      api("/api/admin/overview"),
      api("/api/admin/pricing"),
      api("/api/admin/coupons"),
      api("/api/admin/support-agents"),
      api("/api/admin/payments")
    ]);
    app.overview = overview;
    app.pricing = pricing;
    app.coupons = couponData;
    app.supportAgents = supportAgents;
    app.paidCustomers = paymentData.customers;
    renderOverview();
    renderPricingForm(pricing);
    renderCouponCampaigns(couponData);
    renderSupportAgents(supportAgents);
    renderPaidCustomers(paymentData.customers);
    await Promise.all([loadLeads(), loadTrash(), loadQr()]);
    document.querySelector("#lastUpdated").textContent = `更新于 ${formatTime(new Date().toISOString())}`;
    if (showRefreshToast) showToast("数据已刷新");
  } catch (error) {
    if (!String(error.message).includes("登录")) showToast(error.message, true);
  }
}

async function previewSupportQr(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    pendingSupportQrDataUrl = await compressSupportQr(file);
    document.querySelector("#supportQrPreview").src = pendingSupportQrDataUrl;
    document.querySelector("#supportQrPreview").hidden = false;
    document.querySelector("#supportQrPlaceholder").hidden = true;
    document.querySelector("#supportSaveState").textContent = "";
  } catch (error) {
    pendingSupportQrDataUrl = "";
    showToast(error.message, true);
  }
}

function compressSupportQr(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("请选择图片文件"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("无法解析二维码图片"));
      image.onload = () => {
        const maxSize = 1200;
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderSupportAgents(agents) {
  const tbody = document.querySelector("#supportAgentsBody");
  if (!agents.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">还没有客服二维码</td></tr>`;
    return;
  }
  tbody.innerHTML = agents.map((agent) => `
    <tr>
      <td><img class="support-thumb" src="${escapeAttribute(agent.qrPath)}" alt="${escapeAttribute(agent.name)}二维码"></td>
      <td class="table-customer"><strong>${escapeHtml(agent.name)}</strong></td>
      <td>${escapeHtml(agent.wechatId || "未填写")}</td>
      <td>${agent.sortOrder}</td>
      <td><span class="badge ${agent.active ? "won" : "lost"}">${agent.active ? "启用" : "停用"}</span></td>
      <td><div class="row-actions">
        <button class="link-button" data-edit-support="${agent.id}">编辑/换二维码</button>
        <button class="link-button ${agent.active ? "danger" : ""}" data-toggle-support="${agent.id}" data-active="${agent.active ? "1" : "0"}">${agent.active ? "停用" : "启用"}</button>
      </div></td>
    </tr>
  `).join("");
  tbody.querySelectorAll("[data-edit-support]").forEach((button) => {
    button.addEventListener("click", () => editSupportAgent(button.dataset.editSupport));
  });
  tbody.querySelectorAll("[data-toggle-support]").forEach((button) => {
    button.addEventListener("click", () => toggleSupportAgent(button.dataset.toggleSupport, button.dataset.active !== "1"));
  });
}

function editSupportAgent(id) {
  const agent = app.supportAgents.find((item) => item.id === id);
  if (!agent) return;
  document.querySelector("#supportFormTitle").textContent = "编辑客服";
  document.querySelector("#supportSubmitButton").textContent = "保存修改";
  document.querySelector("#supportEditingId").value = agent.id;
  document.querySelector("#supportName").value = agent.name;
  document.querySelector("#supportWechatId").value = agent.wechatId || "";
  document.querySelector("#supportSortOrder").value = agent.sortOrder || 0;
  document.querySelector("#supportQrPreview").src = agent.qrPath;
  document.querySelector("#supportQrPreview").hidden = false;
  document.querySelector("#supportQrPlaceholder").hidden = true;
  document.querySelector("#supportCancelEdit").hidden = false;
  pendingSupportQrDataUrl = "";
  document.querySelector("#page-support").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetSupportForm() {
  document.querySelector("#supportForm").reset();
  document.querySelector("#supportEditingId").value = "";
  document.querySelector("#supportSortOrder").value = "0";
  document.querySelector("#supportFormTitle").textContent = "新增客服";
  document.querySelector("#supportSubmitButton").textContent = "新增客服";
  document.querySelector("#supportCancelEdit").hidden = true;
  document.querySelector("#supportQrPreview").src = "";
  document.querySelector("#supportQrPreview").hidden = true;
  document.querySelector("#supportQrPlaceholder").hidden = false;
  document.querySelector("#supportSaveState").textContent = "";
  pendingSupportQrDataUrl = "";
}

async function toggleSupportAgent(id, active) {
  try {
    await api(`/api/admin/support-agents/${id}`, {
      method: "PATCH",
      body: { active }
    });
    showToast(active ? "客服已启用" : "客服已停用");
    await loadAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

function updateCouponValueLabel() {
  const type = document.querySelector("#couponDiscountType").value;
  document.querySelector("#couponValueLabel").textContent = type === "percent"
    ? "减免比例（1-100）"
    : "优惠金额（元）";
  document.querySelector("#couponValue").max = type === "percent" ? "100" : "1000000";
}

function renderCouponCampaigns(campaigns) {
  const tbody = document.querySelector("#couponCampaignsBody");
  if (!campaigns.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">还没有优惠券活动</td></tr>`;
    return;
  }
  tbody.innerHTML = campaigns.map((campaign) => `
    <tr>
      <td class="table-customer"><strong>${escapeHtml(campaign.name)}</strong><span>${campaign.active ? "启用中" : "已停用"}</span></td>
      <td>${campaign.discountType === "percent"
        ? `减免 ${campaign.discountValue}%`
        : `立减 ¥${campaign.discountValue}`}<small>满 ¥${campaign.minimumSpend} 可用</small></td>
      <td>${campaign.validFrom || "立即"}<small>至 ${campaign.validUntil || "长期"}</small></td>
      <td>${campaign.issuedCount}${campaign.totalQuantity ? ` / ${campaign.totalQuantity}` : ""} 张<small>已使用 ${campaign.usedCount} 张</small></td>
      <td><span class="badge ${campaign.active ? "won" : "lost"}">${campaign.active ? "启用" : "停用"}</span></td>
      <td><div class="row-actions">
        <button class="link-button" data-issue-coupon="${campaign.id}">指定人发放</button>
        <button class="link-button" data-issue-all-coupon="${campaign.id}">全体会员发放</button>
        <button class="link-button ${campaign.active ? "danger" : ""}" data-toggle-coupon="${campaign.id}" data-active="${campaign.active ? "1" : "0"}">${campaign.active ? "停用" : "启用"}</button>
      </div></td>
    </tr>
  `).join("");
  tbody.querySelectorAll("[data-issue-coupon]").forEach((button) => {
    button.addEventListener("click", () => issueCoupon(button.dataset.issueCoupon));
  });
  tbody.querySelectorAll("[data-issue-all-coupon]").forEach((button) => {
    button.addEventListener("click", () => issueCouponToAll(button.dataset.issueAllCoupon));
  });
  tbody.querySelectorAll("[data-toggle-coupon]").forEach((button) => {
    button.addEventListener("click", () => toggleCoupon(button.dataset.toggleCoupon, button.dataset.active !== "1"));
  });
}

async function issueCoupon(campaignId) {
  const campaign = app.coupons.find((item) => item.id === campaignId);
  if (!campaign) return;
  app.issueCampaignId = campaignId;
  document.querySelector("#couponIssueCampaignName").textContent = `优惠券：${campaign.name}`;
  document.querySelector("#couponMemberSearch").value = "";
  document.querySelector("#couponMemberResults").innerHTML = `<p class="muted">正在加载客户…</p>`;
  document.querySelector("#couponIssueDialog").showModal();
  await searchCouponMembers();
}

async function searchCouponMembers() {
  const query = document.querySelector("#couponMemberSearch").value.trim();
  const params = new URLSearchParams({ q: query, limit: "30" });
  const results = document.querySelector("#couponMemberResults");
  results.innerHTML = `<p class="muted">正在搜索…</p>`;
  try {
    const data = await api(`/api/admin/members?${params}`);
    renderCouponMemberResults(data.members);
  } catch (error) {
    results.innerHTML = `<p class="form-error">${escapeHtml(error.message)}</p>`;
  }
}

function renderCouponMemberResults(members) {
  const results = document.querySelector("#couponMemberResults");
  if (!members.length) {
    results.innerHTML = `<p class="muted">没有找到匹配的客户</p>`;
    return;
  }
  results.innerHTML = members.map((member) => `
    <button type="button" class="member-result" data-issue-member="${member.id}" ${member.wechatBound ? "" : "disabled"}>
      <span class="member-result-main">
        <strong>${escapeHtml(member.name)}</strong>
        <small>${escapeHtml(member.phone)}</small>
      </span>
      <span class="badge ${member.wechatBound ? "won" : "lost"}">${member.wechatBound ? "已绑定微信" : "未绑定微信"}</span>
    </button>
  `).join("");
  results.querySelectorAll("[data-issue-member]").forEach((button) => {
    button.addEventListener("click", () => issueCouponToMember(button.dataset.issueMember));
  });
}

async function issueCouponToMember(memberId) {
  try {
    await api(`/api/admin/coupons/${app.issueCampaignId}/issue`, {
      method: "POST",
      body: { memberId }
    });
    document.querySelector("#couponIssueDialog").close();
    showToast("优惠券已发放给选定客户");
    await loadAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function issueCouponToAll(campaignId) {
  if (!window.confirm("确定给所有已微信登录会员发放这张优惠券吗？达到每人限领数量的客户会自动跳过。")) return;
  try {
    const result = await api(`/api/admin/coupons/${campaignId}/issue-all`, {
      method: "POST",
      body: {}
    });
    showToast(`发放完成：成功 ${result.issuedCount} 人，跳过 ${result.skippedCount} 人`);
    await loadAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function toggleCoupon(campaignId, active) {
  try {
    await api(`/api/admin/coupons/${campaignId}`, {
      method: "PATCH",
      body: { active }
    });
    showToast(active ? "优惠券已启用" : "优惠券已停用");
    await loadAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadLeads() {
  const params = new URLSearchParams();
  const status = document.querySelector("#leadStatusFilter").value;
  const query = document.querySelector("#leadSearch").value.trim();
  if (status !== "all") params.set("status", status);
  if (query) params.set("q", query);
  const leads = await api(`/api/admin/leads?${params}`);
  app.leads = leads;
  renderLeads(leads);
}

async function loadPayments() {
  const params = new URLSearchParams();
  const type = document.querySelector("#paymentTypeFilter").value;
  const query = document.querySelector("#paymentSearch").value.trim();
  if (type !== "all") params.set("type", type);
  if (query) params.set("q", query);
  const data = await api(`/api/admin/payments?${params}`);
  app.paidCustomers = data.customers;
  renderPaidCustomers(data.customers);
}

function renderPaidCustomers(customers) {
  const tbody = document.querySelector("#paidCustomersBody");
  if (!customers.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">当前没有收费或定金客户</td></tr>`;
    document.querySelector("#paidCustomerCount").textContent = "共 0 位收费客户";
    return;
  }
  tbody.innerHTML = customers.map((customer) => `
    <tr>
      <td class="table-customer"><strong>${escapeHtml(customer.name)}</strong><span>${escapeHtml(customer.phone)}</span></td>
      <td>${escapeHtml(customer.layout)}<small>${customer.area}㎡</small></td>
      <td>
        <div class="payment-chip-list">
          ${customer.payments.map((payment) => `
            <div class="payment-chip">
              <span>${payment.paymentType === "deposit" ? "定金" : "全款"} ¥${payment.amount}</span>
              <small>${formatTime(payment.paidAt)}</small>
              <button class="link-button danger" data-refund-payment="${payment.id}" data-payment-amount="${payment.amount}">退费</button>
            </div>
          `).join("")}
        </div>
      </td>
      <td class="money">¥${customer.totalPaid}</td>
      <td class="money">¥${customer.quoteExact}</td>
      <td><span class="badge ${customer.leadStatus}">${statusLabels[customer.leadStatus] || customer.leadStatus}</span></td>
    </tr>
  `).join("");
  document.querySelector("#paidCustomerCount").textContent = `共 ${customers.length} 位收费客户`;
  tbody.querySelectorAll("[data-refund-payment]").forEach((button) => {
    button.addEventListener("click", () => refundPayment(button.dataset.refundPayment, Number(button.dataset.paymentAmount)));
  });
}

async function refundPayment(paymentId, amount) {
  if (!window.confirm(`确定退费 ¥${amount} 吗？退费后该笔收款会移出收费客户分组。`)) return;
  const note = window.prompt("退费备注（可留空）", "") || "";
  try {
    await api(`/api/admin/payments/${paymentId}/refund`, {
      method: "POST",
      body: { note }
    });
    showToast("退费已登记，收费客户列表已更新");
    await loadAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderOverview() {
  const data = app.overview || {};
  document.querySelector("#statToday").textContent = data.today || 0;
  document.querySelector("#statPending").textContent = data.pending || 0;
  document.querySelector("#statTotal").textContent = data.total || 0;
  document.querySelector("#statWon").textContent = data.won || 0;
}

function renderLeads(leads) {
  renderLeadRows(
    document.querySelector("#recentLeadsBody"),
    leads.slice(0, 8),
    ["customer", "house", "needs", "quote", "coupons", "status", "created", "action"]
  );
  renderLeadRows(
    document.querySelector("#allLeadsBody"),
    leads,
    ["customer", "phone", "house", "needs", "quote", "coupons", "status", "followup", "created", "action"]
  );
  document.querySelector("#leadCount").textContent = `共 ${leads.length} 条线索`;
}

function renderLeadRows(tbody, leads, columns) {
  if (!leads.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${columns.length}">暂无客户线索</td></tr>`;
    return;
  }

  tbody.innerHTML = leads.map((lead) => {
    const serviceLabels = lead.serviceLabels || getServiceLabels(lead.serviceKeys);
    const cells = {
      customer: `<td class="table-customer"><strong>${escapeHtml(lead.name)}</strong><span>${escapeHtml(lead.address || "未填写地址")}</span></td>`,
      phone: `<td>${escapeHtml(lead.phone)}</td>`,
      house: `<td>${escapeHtml(lead.layout)}<small>${lead.area}㎡ · ${lead.rooms} 间房</small></td>`,
      needs: `<td>${escapeHtml(serviceLabels || "未选择服务")}</td>`,
      quote: `<td class="money">¥${lead.quoteLow} - ¥${lead.quoteHigh}<small>参考价 ¥${lead.quoteExact}</small></td>`,
      coupons: `<td>${lead.couponCount ? `${lead.couponCount} 张可用<small>${escapeHtml(lead.couponText || "")}</small>` : "无可用券"}${lead.discount ? `<small class="coupon-used-line">本单已抵 ¥${lead.discount}</small>` : ""}</td>`,
      status: `<td><span class="badge ${lead.status}">${statusLabels[lead.status] || lead.status}</span></td>`,
      followup: `<td>${lead.followUpAt ? escapeHtml(formatDate(lead.followUpAt)) : "未安排"}</td>`,
      created: `<td>${formatTime(lead.createdAt)}</td>`,
      action: `<td><div class="row-actions"><button class="link-button" data-open-lead="${lead.id}">查看跟进</button><button class="link-button danger" data-delete-lead="${lead.id}">删除</button></div></td>`
    };
    return `<tr>${columns.map((key) => cells[key]).join("")}</tr>`;
  }).join("");

  tbody.querySelectorAll("[data-open-lead]").forEach((button) => {
    button.addEventListener("click", () => openLead(button.dataset.openLead));
  });
  tbody.querySelectorAll("[data-delete-lead]").forEach((button) => {
    button.addEventListener("click", () => deleteLead(button.dataset.deleteLead));
  });
}

async function deleteLead(id) {
  if (!window.confirm("确定删除这条客户线索吗？删除后会进入回收箱，可以恢复。")) return;
  try {
    await api(`/api/admin/leads/${id}`, { method: "DELETE" });
    showToast("客户线索已移入回收箱");
    await loadAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadTrash() {
  const query = document.querySelector("#trashSearch").value.trim();
  const params = new URLSearchParams({ deleted: "1" });
  if (query) params.set("q", query);
  const leads = await api(`/api/admin/leads?${params}`);
  renderTrashRows(leads);
  document.querySelector("#trashLeadCount").textContent = `回收箱中共 ${leads.length} 条线索`;
}

function renderTrashRows(leads) {
  const tbody = document.querySelector("#trashLeadsBody");
  if (!leads.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="7">回收箱为空</td></tr>`;
    return;
  }
  tbody.innerHTML = leads.map((lead) => `
    <tr>
      <td class="table-customer"><strong>${escapeHtml(lead.name)}</strong><span>${escapeHtml(lead.address || "未填写地址")}</span></td>
      <td>${escapeHtml(lead.phone)}</td>
      <td>${escapeHtml(lead.layout)}<small>${lead.area}㎡ · ${lead.rooms} 间房</small></td>
      <td>${escapeHtml(lead.serviceLabels || "未选择服务")}</td>
      <td class="money">¥${lead.quoteLow} - ¥${lead.quoteHigh}</td>
      <td>${formatTime(lead.deletedAt)}</td>
      <td><button class="link-button" data-restore-lead="${lead.id}">恢复</button></td>
    </tr>
  `).join("");
  tbody.querySelectorAll("[data-restore-lead]").forEach((button) => {
    button.addEventListener("click", () => restoreLead(button.dataset.restoreLead));
  });
}

async function restoreLead(id) {
  try {
    await api(`/api/admin/leads/${id}/restore`, { method: "POST" });
    showToast("客户线索已恢复");
    await loadAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function openLead(id) {
  app.currentLeadId = id;
  const detail = await api(`/api/admin/leads/${id}`);
  const lead = detail.lead;
  const quote = detail.quote;
  const followups = detail.followups || [];
  view.leadDialogContent.innerHTML = `
    <div class="lead-detail-head">
      <div>
        <h2>${escapeHtml(lead.name)}</h2>
        <p class="muted">${escapeHtml(lead.phone)} · ${escapeHtml(lead.address || "未填写地址")}</p>
      </div>
      <span class="badge ${lead.status}">${statusLabels[lead.status] || lead.status}</span>
    </div>
    <div class="detail-grid">
      <div class="detail-item"><span>房屋面积</span><strong>${lead.area}㎡</strong></div>
      <div class="detail-item"><span>户型 / 房间</span><strong>${escapeHtml(lead.layout)} · ${lead.rooms} 间</strong></div>
      <div class="detail-item"><span>预约时段</span><strong>${escapeHtml(getUrgencyLabel(lead.urgency))}</strong></div>
      <div class="detail-item"><span>期望日期</span><strong>${escapeHtml(quote.preferredDate || "未填写")}</strong></div>
      <div class="detail-item"><span>扫码来源</span><strong>${escapeHtml(lead.sourceScene || "直接进入")}</strong></div>
      <div class="detail-item"><span>提交时间</span><strong>${formatTime(lead.createdAt)}</strong></div>
      <div class="detail-item"><span>微信绑定</span><strong>${lead.wechatBound ? "已绑定" : "未绑定"}</strong></div>
      <div class="detail-item"><span>微信手机号</span><strong>${lead.phoneBound ? "已授权绑定" : "未授权绑定"}</strong></div>
    </div>
    <div class="detail-quote">
      <span class="muted">系统参考报价</span>
      <div class="total">¥${lead.quoteLow} - ¥${lead.quoteHigh}</div>
      <p class="muted">精确参考价 ¥${lead.quoteExact}，最终以现场评估为准。</p>
      <ul class="breakdown">
        ${quote.breakdown.map((item) => `<li><span>${escapeHtml(item.label)}</span><strong>¥${item.amount}</strong></li>`).join("")}
      </ul>
    </div>
    <div class="detail-item" style="margin-bottom:18px">
      <span>客户补充需求</span>
      <strong>${escapeHtml(quote.needsText || "未填写")}</strong>
    </div>
    <h3>客户优惠券</h3>
    <div class="admin-coupon-list">
      ${(detail.coupons || []).length ? detail.coupons.map((coupon) => `
        <div class="admin-coupon-item ${coupon.status}">
          <div>
            <strong>${escapeHtml(coupon.name)}</strong>
            <small>${coupon.discountType === "percent"
              ? `减免 ${coupon.discountValue}%`
              : `立减 ¥${coupon.discountValue}`} · 满 ¥${coupon.minimumSpend} 可用</small>
          </div>
          <span class="badge ${coupon.status === "available" ? "won" : coupon.status === "used" ? "contacted" : "lost"}">${couponStatusLabels[coupon.status] || coupon.status}</span>
        </div>
      `).join("") : `<p class="muted">该客户当前没有优惠券。</p>`}
    </div>
    <h3>收款记录</h3>
    <div class="payment-history-list">
      ${(detail.payments || []).length ? detail.payments.map((payment) => `
        <div class="payment-history-item ${payment.status === "refunded" ? "refunded" : ""}">
          <strong>${payment.payment_type === "deposit" ? "定金" : "全款"} ¥${payment.amount}</strong>
          <small>${formatTime(payment.paid_at)} · ${payment.status === "refunded" ? `已退费 ${formatTime(payment.refunded_at)}` : "已收款"}</small>
          ${payment.status === "refunded" && payment.refund_note ? `<small>备注：${escapeHtml(payment.refund_note)}</small>` : ""}
        </div>
      `).join("") : `<p class="muted">还没有收款记录。</p>`}
    </div>
    <form id="paymentForm" class="payment-form">
      <div class="form-grid">
        <label><span>收款类型</span>
          <select id="paymentType">
            <option value="deposit">定金</option>
            <option value="full">全款</option>
          </select>
        </label>
        <label><span>收款金额（元）</span><input id="paymentAmount" type="number" min="1" required></label>
      </div>
      <label><span>收款备注</span><input id="paymentNote" placeholder="例如：微信转账、现金"></label>
      <div class="form-actions"><button type="submit" class="btn btn-primary">登记收款</button></div>
    </form>
    <h3>跟进记录</h3>
    <div class="followup-list">
      ${followups.length ? followups.map((item) => `
        <div class="followup-item">
          ${escapeHtml(item.note)}
          <small>${formatTime(item.created_at)}${item.next_follow_up_at ? ` · 下次跟进 ${formatDate(item.next_follow_up_at)}` : ""}</small>
        </div>
      `).join("") : `<p class="muted">还没有跟进记录。</p>`}
    </div>
    <div class="unbind-actions">
      <button type="button" class="btn btn-secondary" data-unbind-member="${lead.memberId}" data-unbind-scope="wechat">解绑微信</button>
      <button type="button" class="btn btn-secondary" data-unbind-member="${lead.memberId}" data-unbind-scope="phone">解绑手机号</button>
    </div>
    <form id="leadUpdateForm" class="detail-form">
      <div class="form-grid">
        <label><span>客户状态</span>
          <select id="detailStatus">${Object.entries(statusLabels).map(([key, label]) => `<option value="${key}" ${key === lead.status ? "selected" : ""}>${label}</option>`).join("")}</select>
        </label>
        <label><span>下次跟进时间</span>
          <input id="detailFollowUpAt" type="date" value="${escapeHtml(toDateInput(lead.followUpAt))}">
        </label>
      </div>
      <label><span>内部备注</span><textarea id="detailAdminNote" placeholder="记录客户偏好、预算确认等">${escapeHtml(lead.adminNote)}</textarea></label>
      <label><span>新增一条跟进记录</span><textarea id="detailFollowupNote" placeholder="例如：已电话联系，客户希望周六上门"></textarea></label>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">保存跟进</button>
      </div>
    </form>
  `;

  document.querySelector("#leadUpdateForm").addEventListener("submit", saveLeadUpdate);
  document.querySelector("#paymentForm").addEventListener("submit", savePayment);
  view.leadDialogContent.querySelectorAll("[data-unbind-member]").forEach((button) => {
    button.addEventListener("click", () => unbindMember(button.dataset.unbindMember, button.dataset.unbindScope));
  });
  view.leadDialog.showModal();
}

async function savePayment(event) {
  event.preventDefault();
  try {
    await api(`/api/admin/leads/${app.currentLeadId}/payments`, {
      method: "POST",
      body: {
        paymentType: document.querySelector("#paymentType").value,
        amount: Number(document.querySelector("#paymentAmount").value),
        note: document.querySelector("#paymentNote").value.trim()
      }
    });
    view.leadDialog.close();
    showToast("收款已登记");
    await loadAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function unbindMember(memberId, scope) {
  const isWechat = scope === "wechat";
  const message = isWechat
    ? "确定解绑该客户的微信吗？旧微信登录会立即失效，姓名、手机号、地址和订单仍会保留。"
    : "确定解除微信手机号授权吗？手机号会继续保留为客户资料，客户下次可以重新绑定新手机号。";
  if (!window.confirm(message)) return;
  try {
    await api(`/api/admin/members/${memberId}/unbind`, {
      method: "POST",
      body: { scope }
    });
    view.leadDialog.close();
    showToast(isWechat ? "客户微信已解绑" : "客户手机号授权已解绑");
    await loadAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveLeadUpdate(event) {
  event.preventDefault();
  const payload = {
    status: document.querySelector("#detailStatus").value,
    followUpAt: document.querySelector("#detailFollowUpAt").value,
    adminNote: document.querySelector("#detailAdminNote").value,
    followupNote: document.querySelector("#detailFollowupNote").value
  };
  try {
    await api(`/api/admin/leads/${app.currentLeadId}`, { method: "PATCH", body: payload });
    view.leadDialog.close();
    showToast("跟进记录已保存");
    await loadAll();
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderPricingForm(pricing) {
  document.querySelector("#pricingBrandName").value = pricing.brandName || "";
  document.querySelector("#pricingBasePrice").value = pricing.basePricePerSqm ?? 0;
  document.querySelector("#pricingMinimum").value = pricing.minimumPrice ?? 0;
  document.querySelector("#pricingMargin").value = Math.round((pricing.rangeMargin || 0) * 100);
  document.querySelector("#serviceRows").innerHTML = "";
  pricing.serviceOptions.forEach((item) => addRuleRow("service", item));
  document.querySelector("#urgencyRows").innerHTML = "";
  pricing.urgencyOptions.forEach((item) => addRuleRow("urgency", item));
  renderPreviewOptions(pricing);
}

function addRuleRow(type, item = {}) {
  const target = document.querySelector(type === "service" ? "#serviceRows" : "#urgencyRows");
  const row = document.createElement("div");
  row.className = `rule-row ${type}`;
  row.dataset.key = item.key || `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  if (type === "service") {
    row.innerHTML = `
      <input data-field="group" placeholder="服务分类" value="${escapeAttribute(item.group || "其他服务")}">
      <input data-field="label" placeholder="服务名称" value="${escapeAttribute(item.label || "")}">
      <input data-field="price" type="number" min="0" placeholder="价格" value="${escapeAttribute(item.price ?? 0)}">
      <button type="button" class="remove-rule" aria-label="删除">×</button>
    `;
  } else {
    row.innerHTML = `
      <input data-field="label" placeholder="时段名称" value="${escapeAttribute(item.label || "")}">
      <input data-field="multiplier" type="number" min="1" max="5" step="0.05" placeholder="系数" value="${escapeAttribute(item.multiplier ?? 1)}">
      <button type="button" class="remove-rule" aria-label="删除">×</button>
    `;
  }
  row.querySelector(".remove-rule").addEventListener("click", () => {
    if (target.children.length > 1) row.remove();
  });
  target.appendChild(row);
  renderPreviewOptions(readPricingForm());
}

function readPricingForm() {
  return {
    brandName: document.querySelector("#pricingBrandName").value.trim(),
    currency: "CNY",
    basePricePerSqm: Number(document.querySelector("#pricingBasePrice").value),
    minimumPrice: Number(document.querySelector("#pricingMinimum").value),
    rangeMargin: Number(document.querySelector("#pricingMargin").value) / 100,
    serviceOptions: [...document.querySelectorAll("#serviceRows .rule-row")].map((row) => ({
      key: row.dataset.key,
      group: row.querySelector('[data-field="group"]').value.trim(),
      label: row.querySelector('[data-field="label"]').value.trim(),
      price: Number(row.querySelector('[data-field="price"]').value)
    })).filter((item) => item.label),
    urgencyOptions: [...document.querySelectorAll("#urgencyRows .rule-row")].map((row) => ({
      key: row.dataset.key,
      label: row.querySelector('[data-field="label"]').value.trim(),
      multiplier: Number(row.querySelector('[data-field="multiplier"]').value)
    })).filter((item) => item.label)
  };
}

function renderPreviewOptions(pricing) {
  const serviceSelect = document.querySelector("#previewService");
  const urgencySelect = document.querySelector("#previewUrgency");
  if (!serviceSelect || !urgencySelect || !pricing) return;
  const serviceValue = serviceSelect.value;
  const urgencyValue = urgencySelect.value;
  serviceSelect.innerHTML = (pricing.serviceOptions || []).map((item) =>
    `<option value="${escapeAttribute(item.key)}">${escapeHtml(item.group || "其他服务")} / ${escapeHtml(item.label)}（¥${item.price}）</option>`
  ).join("");
  urgencySelect.innerHTML = (pricing.urgencyOptions || []).map((item) =>
    `<option value="${escapeAttribute(item.key)}">${escapeHtml(item.label)}（${item.multiplier}×）</option>`
  ).join("");
  if ([...serviceSelect.options].some((option) => option.value === serviceValue)) serviceSelect.value = serviceValue;
  if ([...urgencySelect.options].some((option) => option.value === urgencyValue)) urgencySelect.value = urgencyValue;
}

async function previewQuote() {
  const result = document.querySelector("#previewQuoteResult");
  result.textContent = "正在计算…";
  try {
    const data = await fetch("/api/public/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        area: Number(document.querySelector("#previewArea").value),
        rooms: Number(document.querySelector("#previewRooms").value),
        serviceKeys: [document.querySelector("#previewService").value],
        urgency: document.querySelector("#previewUrgency").value
      })
    }).then((response) => response.json());
    if (data.error) throw new Error(data.error);
    result.innerHTML = `<strong>¥${data.low} - ¥${data.high}</strong>精确参考价 ¥${data.exact}<br><small>当前页面尚未保存的规则需要先保存后才会用于正式报价。</small>`;
  } catch (error) {
    result.textContent = error.message;
  }
}

async function loadQr() {
  const image = document.querySelector("#qrImage");
  const placeholder = document.querySelector("#qrPlaceholder");
  image.hidden = true;
  placeholder.hidden = false;
  try {
    const response = await fetch(`/qr/miniprogram.png?t=${Date.now()}`, { method: "HEAD" });
    if (!response.ok) return;
    image.src = `/qr/miniprogram.png?t=${Date.now()}`;
    image.hidden = false;
    placeholder.hidden = true;
  } catch {
    // Keep the setup instructions visible.
  }
}

function showPage(page) {
  if (!pageTitles[page]) page = "dashboard";
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active", section.id === `page-${page}`);
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  document.querySelector("#pageTitle").textContent = pageTitles[page];
  history.replaceState(null, "", `#${page}`);
  if (page === "qr") loadQr();
}

function connectEvents() {
  if (app.eventSource) app.eventSource.close();
  const source = new EventSource("/api/admin/events");
  app.eventSource = source;
  source.onopen = () => setRealtimeState("在线", "online");
  source.onerror = () => setRealtimeState("连接中断，自动重试", "offline");
  ["lead.created", "lead.updated", "lead.deleted", "lead.restored", "member.unbound", "payment.created", "payment.refunded", "coupon.created", "coupon.updated", "coupon.issued", "support.updated", "pricing.updated"].forEach((event) => {
    source.addEventListener(event, async () => {
      if (event === "lead.created") showToast("收到一条新客户线索");
      await loadAll();
    });
  });
}

function setRealtimeState(text, state) {
  view.realtimeState.className = `connection-state ${state}`;
  view.realtimeState.innerHTML = `<i></i> ${text}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    method: options.method || "GET",
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      view.app.hidden = true;
      view.login.hidden = false;
    }
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function getServiceLabels(keys) {
  const options = app.pricing?.serviceOptions || [];
  return keys.map((key) => options.find((item) => item.key === key)?.label || key).join("、");
}

function getUrgencyLabel(key) {
  return app.pricing?.urgencyOptions?.find((item) => item.key === key)?.label || key;
}

function showToast(message, isError = false) {
  view.toast.textContent = message;
  view.toast.style.background = isError ? "#8f3030" : "#17211e";
  view.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { view.toast.hidden = true; }, 3200);
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function toDateInput(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
