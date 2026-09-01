type IncomeSaleCalculationLine = {
  quantity: number;
  unitPrice: number;
};

function roundToSatang(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

export function calculateIncomeSaleLineTotal(line: IncomeSaleCalculationLine) {
  return roundToSatang(line.quantity * line.unitPrice) / 100;
}

export function calculateIncomeSaleTotals(lines: IncomeSaleCalculationLine[]) {
  const lineTotals = lines.map(calculateIncomeSaleLineTotal);
  return {
    lineTotals,
    total: lineTotals.reduce((sum, total) => sum + roundToSatang(total), 0) / 100,
  };
}
