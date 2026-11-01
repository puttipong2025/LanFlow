const key = "bill-issuer-installation";
type Installation = { key: string; version: 1; installationId: string; generationId: string; locations: string[] };
const uuid = (v: unknown): v is string => typeof v === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

/** Runs inside the allocator transaction; never uses a separate localStorage identity. */
export function prepareBillInstallation(store: IDBObjectStore, locationId: string, branchValid: boolean,
  complete: (identity: Installation) => void) {
  const read = store.get(key);
  read.onsuccess = () => {
    const value = read.result as Installation | undefined;
    const valid = value?.version === 1 && uuid(value.installationId) && uuid(value.generationId)
      && Array.isArray(value.locations) && value.locations.every(uuid);
    // A missing/corrupt previously used branch must not restart that issuer's counters.
    const identity: Installation = valid ? { ...value,
      generationId: !branchValid && value.locations.includes(locationId) ? crypto.randomUUID() : value.generationId,
      locations: [...new Set([...value.locations, locationId])] }
      : { key, version: 1, installationId: crypto.randomUUID(), generationId: crypto.randomUUID(), locations: [locationId] };
    store.put(identity);
    complete(identity);
  };
}
