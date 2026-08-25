export type WexPermissions = {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type WexLineInput = {
  vehicleRegistration: string;
  carrierId: string | null;
  carrierName: string | null;
  inboundAt: string;
  inboundWeight: number;
  outboundAt: string | null;
  outboundWeight: number;
};

export type WexLine = WexLineInput & {
  id: string;
  sequenceNo: number;
  netWeight: number;
};

export type WexRubberExportOption = {
  rubberExportId: string;
  exportNo: string;
  currentWeight: number;
  reservedByCurrentWex: boolean;
};

export type WexCarrierOption = {
  carrierId: string;
  carrierName: string;
};

export type WexOptionsResponse = {
  rubberExports: WexRubberExportOption[];
  carriers: WexCarrierOption[];
};

export type WexReservedRubberExport = {
  rubberExportId: string;
  exportNo: string;
  currentWeight: number;
};

export type WexSummary = {
  id: string;
  wexNo: string;
  locationId: string;
  locationName: string;
  revision: number;
  vehicleCount: number;
  rubberExportCount: number;
  vehicleNetWeight: number;
  reservedRubberWeight: number;
  remainingWeight: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type WexDetails = WexSummary & {
  lines: WexLine[];
  rubberExports: WexReservedRubberExport[];
};

export type WexListResponse = {
  bills: WexSummary[];
  hasMore: boolean;
  nextCursor: string | null;
  permissions: WexPermissions;
};

export type WexMutationReceipt = {
  id: string;
  wexNo: string;
  revision: number;
};

export type WexDeleteReceipt = {
  id: string;
  wexNo: string;
  status: "deleted";
};
