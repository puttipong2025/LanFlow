type OcrActionItem = {
  status: "pending" | "processing" | "success" | "error";
};

export function getOcrActionState(items: OcrActionItem[]) {
  let actionableCount = 0;
  let processingCount = 0;
  let errorCount = 0;

  for (const item of items) {
    if (item.status === "pending" || item.status === "error") actionableCount += 1;
    if (item.status === "processing") processingCount += 1;
    if (item.status === "error") errorCount += 1;
  }

  return { actionableCount, processingCount, errorCount };
}
