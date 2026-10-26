function calculateLocalQuote(pricing, input, coupon) {
  const area = Number(input.area);
  const rooms = Number(input.rooms);
  if (!Number.isFinite(area) || area < 10 || area > 500) {
    throw new Error("房屋面积应在 10-500 范围内");
  }
  if (!Number.isFinite(rooms) || rooms < 1 || rooms > 12) {
    throw new Error("房间数量应在 1-12 范围内");
  }

  const serviceKeys = Array.isArray(input.serviceKeys) ? input.serviceKeys : [];
  const selectedServices = (pricing.serviceOptions || []).filter((item) => serviceKeys.includes(item.key));
  const urgency = (pricing.urgencyOptions || []).find((item) => item.key === input.urgency)
    || (pricing.urgencyOptions || [])[0] || { key: "normal", label: "普通预约", multiplier: 1 };
  const areaFee = Math.round(area * pricing.basePricePerSqm);
  const minimumPrice = Number(pricing.minimumPrice || 0);
  const baseFee = Math.max(areaFee, minimumPrice);
  const servicesFee = selectedServices.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const beforeUrgency = baseFee + servicesFee;
  const originalExact = Math.max(0, Math.round(beforeUrgency * Number(urgency.multiplier || 1)));
  const breakdown = [
    { label: `基础服务费（${area}㎡）`, amount: areaFee },
    ...(areaFee < minimumPrice ? [{ label: "最低服务价补足", amount: minimumPrice - areaFee }] : []),
    ...selectedServices.map((item) => ({ label: item.label, amount: item.price })),
    ...(Number(urgency.multiplier) !== 1 ? [{
      label: `${urgency.label}加价（${Math.round((Number(urgency.multiplier) - 1) * 100)}%）`,
      amount: originalExact - beforeUrgency
    }] : [])
  ];

  let exact = originalExact;
  let discount = 0;
  let couponWarning = "";
  let appliedCoupon = null;
  if (coupon) {
    if (originalExact < Number(coupon.minimumSpend || 0)) {
      couponWarning = `该优惠券需满 ¥${coupon.minimumSpend} 才能使用`;
    } else {
      discount = Math.min(
        originalExact,
        coupon.discountType === "percent"
          ? Math.round(originalExact * Number(coupon.discountValue) / 100)
          : Number(coupon.discountValue)
      );
      exact = Math.max(0, originalExact - discount);
      appliedCoupon = coupon;
      breakdown.push({ label: `优惠券：${coupon.name}`, amount: -discount });
    }
  }

  const margin = Number(pricing.rangeMargin || 0);
  return {
    exact,
    beforeCoupon: originalExact,
    low: Math.floor(exact * (1 - margin) / 10) * 10,
    high: Math.ceil(exact * (1 + margin) / 10) * 10,
    area,
    rooms,
    urgency,
    services: selectedServices,
    discount,
    coupon: appliedCoupon ? {
      id: appliedCoupon.id,
      name: appliedCoupon.name,
      discountType: appliedCoupon.discountType,
      discountValue: appliedCoupon.discountValue
    } : null,
    couponWarning,
    breakdown,
    disclaimer: "最终报价以现场评估和客服确认为准"
  };
}

module.exports = { calculateLocalQuote };
