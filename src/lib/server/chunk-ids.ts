export function chunkUniqueIds(ids: string[], chunkSize = 100): string[][] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error("chunkSize must be a positive integer");
  }

  const uniqueIds = [...new Set(ids)];
  return Array.from(
    { length: Math.ceil(uniqueIds.length / chunkSize) },
    (_, index) => uniqueIds.slice(index * chunkSize, index * chunkSize + chunkSize),
  );
}
