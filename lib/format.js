export const formatNumber = (value = 0, options = {}) => {
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) {
    return "0";
  }

  return new Intl.NumberFormat("en-NG", options).format(numberValue);
};

export const formatCurrency = (value = 0, options = {}) => {
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) {
    return "₦0.00";
  }

  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }).format(numberValue);
};

