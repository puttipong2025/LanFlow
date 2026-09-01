const dailyWageFormatter = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

const payrollMoneyFormatter = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function finiteOrZero(value: number) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function formatDailyWage(value: number) {
  return dailyWageFormatter.format(finiteOrZero(value));
}

export function formatDailyWageCurrency(value: number) {
  return `฿${formatDailyWage(value)}`;
}

export function formatPayrollMoney(value: number) {
  return payrollMoneyFormatter.format(finiteOrZero(value));
}

export function formatPayrollCurrency(value: number) {
  return `฿${formatPayrollMoney(value)}`;
}
