"use client";

import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { useAuthContext } from "@/components/AuthProvider";

import type { Location, Profile } from "@/types";
import { CustomersModule } from "./CustomersModule";
import { TransportModule } from "./TransportModule";
import { OcrTicketUpload } from "./OcrTicketUpload";
import type { UploadItem } from "./OcrTicketUpload";
import { useRubberBills } from "@/hooks/useRubberBills";
import { MoneyTransferModule } from "./MoneyTransferModule";
import { AdminModule } from "./AdminModule";
import { TimeTrackingModule } from "./TimeTrackingModule";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { useIncomeExpense } from "@/hooks/useIncomeExpense";
import { useActionableBadges } from "@/hooks/useActionableBadges";

import {
  readBootstrapCache,
  readLastLocationPreference,
  resolveSelectedLocationId,
  writeBootstrapCache,
  writeLastLocationPreference,
} from "@/lib/lanflow/bootstrap-cache";
import { type Tab } from "@/components/lanflow/tabs";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { RubberBillsModule } from "@/components/rubber-bills/RubberBillsModule";
import { IncomeExpenseModule } from "@/components/income-expense/IncomeExpenseModule";
import { AcidStockModule } from "@/components/acid-stock/AcidStockModule";
import { ReportsModule } from "@/components/reports/ReportsModule";
import { RubberExportsModule } from "@/components/rubber-exports/RubberExportsModule";
import { AppHeader } from "@/components/lanflow/AppHeader";
import { NavigationTabs } from "@/components/lanflow/NavigationTabs";
import { LogoutButton } from "@/components/lanflow/LogoutButton";
import {
  canAccessSourceLocation,
  canManageSystemFeatures,
  canUseMoneyTransfer,
  canUseReports,
} from "@/lib/permissions";
import {
  getOfflineTabBlockMessage,
  isTabBlockedOffline,
  OFFLINE_FALLBACK_TAB,
} from "@/lib/offline-module-policy";
import { getOcrActionState } from "@/lib/ocr-action-state";
import { isDeviceOnline } from "@/lib/connectivity";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useServiceUnavailable } from "@/lib/service-health";

export function LanFlowApp() {
  const auth = useAuthContext();
  const authProfileId = auth.profile?.id;
  const queueOwnerUserId = authProfileId ?? "";
  
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [locations, setLocations] = useState<Location[]>([]);
  const [profile, setProfile] = useState<Profile>(auth.profile as Profile);
  const [selectedLocationId, setSelectedLocationId] = useState(
    auth.profile?.locationIds[0] ?? ""
  );
  const [pendingMoneyTransferSource, setPendingMoneyTransferSource] = useState<{
    transferId: string;
    locationId: string;
  } | null>(null);
  const [pendingRubberBillSource, setPendingRubberBillSource] = useState<{
    locationId: string;
    billDate?: string;
  } | null>(null);
  const [pendingOcrTicketSource, setPendingOcrTicketSource] = useState<{
    locationId: string;
    ticketDate?: string;
  } | null>(null);
  const [pendingRubberExportSource, setPendingRubberExportSource] = useState<{
    exportId: string;
    locationId: string;
  } | null>(null);
  const [ocrUploadItems, setOcrUploadItems] = useState<UploadItem[]>([]);
  const online = useOnlineStatus();
  const [isLoaded, setIsLoaded] = useState(false);
  const serviceUnavailable = useServiceUnavailable();

  useEffect(() => {
    let ignore = false;

    async function loadDatabaseData() {
      setIsLoaded(false);
      if (!authProfileId) {
        setIsLoaded(true);
        return;
      }

      if (!isDeviceOnline()) {
        const cached = readBootstrapCache(authProfileId);
        if (cached) {
          setLocations(cached.locations);
          setProfile(cached.profile);
          setSelectedLocationId(resolveSelectedLocationId(
            cached.locations,
            cached.profile.locationIds,
            cached.selectedLocationId,
          ));
        }
        setIsLoaded(true);
        return;
      }

      try {
        const response = await authFetch("/api/lanflow", { cache: "no-store" });
        await assertApiResponse(response);
        const data = await response.json() as { locations: Location[], profile: Profile };
        if (ignore) return;

        setLocations(data.locations);
        setProfile(data.profile);
        
        const locId = resolveSelectedLocationId(
          data.locations,
          data.profile.locationIds,
          readLastLocationPreference(authProfileId),
        );
        setSelectedLocationId((currentLocationId) =>
          currentLocationId !== locId && !isDeviceOnline()
            ? currentLocationId
            : locId
        );

        if (isDeviceOnline()) {
          writeBootstrapCache(authProfileId, {
            locations: data.locations,
            profile: data.profile,
            selectedLocationId: locId
          });
        }


      } catch (error) {
        console.error("LanFlow database load failed", error);
        const cached = readBootstrapCache(authProfileId);
        if (cached && !ignore) {
          setLocations(cached.locations);
          setProfile(cached.profile);
          const cachedLocationId = resolveSelectedLocationId(
            cached.locations,
            cached.profile.locationIds,
            readLastLocationPreference(authProfileId) ?? cached.selectedLocationId,
          );
          setSelectedLocationId((currentLocationId) =>
            currentLocationId !== cachedLocationId && !isDeviceOnline()
              ? currentLocationId
              : cachedLocationId
          );
        }
      } finally {
        if (!ignore) setIsLoaded(true);
      }
    }

    void loadDatabaseData();

    return () => {
      ignore = true;
    };
  }, [authProfileId]);

  const canAccessMoneyTransfer = canUseMoneyTransfer(profile);
  const canAccessReports = canUseReports(profile);
  const { counts: actionableBadgeCounts } = useActionableBadges(isLoaded && online);

  useEffect(() => {
    if (activeTab === "money-transfer" && !canAccessMoneyTransfer) {
      setActiveTab("dashboard");
    }
  }, [activeTab, canAccessMoneyTransfer]);

  useEffect(() => {
    if ((activeTab === "reports" || activeTab === "rubber-export") && !canAccessReports) {
      setActiveTab("dashboard");
    }
  }, [activeTab, canAccessReports]);

  useEffect(() => {
    if (!isTabBlockedOffline(activeTab, online)) return;
    const message = getOfflineTabBlockMessage(activeTab);
    if (message) toast.error(message);
    setActiveTab(OFFLINE_FALLBACK_TAB);
  }, [activeTab, online]);

  // Persist selected location on change
  useEffect(() => {
    if (online && authProfileId && isLoaded && locations.length > 0) {
      writeLastLocationPreference(authProfileId, selectedLocationId);
      writeBootstrapCache(authProfileId, {
        locations,
        profile,
        selectedLocationId
      });
    }
  }, [selectedLocationId, locations, profile, authProfileId, isLoaded, online]);

  useRubberBills(selectedLocationId, queueOwnerUserId);
  useIncomeExpense(selectedLocationId, queueOwnerUserId);

  const selectedLocation = locations.find((location) => location.id === selectedLocationId) ?? locations[0];
  const selectedOcrUploadItems = ocrUploadItems.filter(
    (item) => item.locationId === selectedLocationId,
  );
  const visibleActionableBadgeCounts = useMemo(
    () => online ? actionableBadgeCounts : {},
    [actionableBadgeCounts, online],
  );
  const selectedModuleBadgeCounts = visibleActionableBadgeCounts[selectedLocationId] ?? {};
  const locationBadgeTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const location of locations) {
      totals[location.id] = Object.values(visibleActionableBadgeCounts[location.id] ?? {})
        .reduce((sum, count) => sum + (count ?? 0), 0);
      if (online) {
        totals[location.id] += getOcrActionState(
          ocrUploadItems.filter((item) => item.locationId === location.id),
        ).actionableCount;
      }
    }
    return totals;
  }, [locations, ocrUploadItems, online, visibleActionableBadgeCounts]);

  if (!isLoaded || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sand">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-leaf border-t-transparent"></div>
          <p className="text-sm font-semibold text-ink">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  if (locations.length === 0 || !selectedLocationId) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-sand p-4 text-center">
        <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-white shadow-sm">
          <ShieldCheck size={32} className="text-leaf" />
        </div>
        <h1 className="text-xl font-bold text-ink">ไม่มีสิทธิ์เข้าถึงสาขา</h1>
        <p className="mt-2 text-sm text-ink/70">
          บัญชีของคุณยังไม่ได้รับการกำหนดสาขา<br />
          กรุณาติดต่อผู้ดูแลระบบเพื่อกำหนดสาขาให้คุณ
        </p>
        <LogoutButton
          online={online}
          onLogout={auth.logout}
          className="mt-6 px-4"
        />
      </div>
    );
  }

  async function addLocation(request: {
    name: string;
    code: string;
    requestId: string;
  }) {
    try {
      const response = await authFetch("/api/lanflow/admin/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      await assertApiResponse(response);
      const data = await response.json() as { location: Location };
      const newLoc = data.location;
      setLocations((current) =>
        current.some((location) => location.id === newLoc.id)
          ? current
          : [...current, newLoc]
      );
      setProfile((current) => ({
        ...current,
        locationIds: current.locationIds.includes(newLoc.id)
          ? current.locationIds
          : [...current.locationIds, newLoc.id],
      }));
      changeSelectedLocation(newLoc.id);
      toast.success(
        "เพิ่มสาขาแล้ว · ตั้งค่าเกณฑ์ผ่านปุ่ม Telegram เพื่อเริ่ม Dashboard alert",
      );
      return true;
    } catch (error) {
      console.error("Add location error:", error);
      toast.error(
        error instanceof Error ? error.message : "เพิ่มสาขาไม่สำเร็จ",
      );
      return false;
    }
  }

  function canOpenSourceLocation(locationId: string) {
    return canAccessSourceLocation(profile, locationId);
  }

  function changeSelectedLocation(locationId: string) {
    if (locationId !== selectedLocationId && !isDeviceOnline()) return false;
    setSelectedLocationId(locationId);
    return true;
  }

  function openMoneyTransferSource(transferId: string, locationId: string) {
    if (!online) {
      toast.error("โมดูลโอนเงินใช้ได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    if (!canAccessMoneyTransfer) return;
    if (!canOpenSourceLocation(locationId)) return;
    if (!changeSelectedLocation(locationId)) return;
    setPendingMoneyTransferSource({ transferId, locationId });
    setActiveTab("money-transfer");
  }

  function openRubberBillSource(locationId: string, billDate?: string) {
    if (!canOpenSourceLocation(locationId)) return;
    if (!changeSelectedLocation(locationId)) return;
    setPendingRubberBillSource({ locationId, billDate });
    setActiveTab("rubber");
  }

  function openOcrTicketSource(locationId: string, ticketDate?: string) {
    if (!online) {
      toast.error("อ่านใบชั่งใช้ได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    if (!canOpenSourceLocation(locationId)) return;
    if (!changeSelectedLocation(locationId)) return;
    setPendingOcrTicketSource({ locationId, ticketDate });
    setActiveTab("ocr");
  }

  function openRubberExportSource(exportId: string, locationId: string) {
    if (!online) {
      toast.error("ส่งออกยางใช้ได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    if (!canAccessReports || !canOpenSourceLocation(locationId)) return;
    if (!changeSelectedLocation(locationId)) return;
    setPendingRubberExportSource({ exportId, locationId });
    setActiveTab("rubber-export");
  }

  return (
    <main className="min-h-screen bg-sand">
      <section className="border-b border-mint bg-white shadow-sm">
        <AppHeader
          profile={profile}
          locations={locations}
          selectedLocationId={selectedLocationId}
          locationBadgeTotals={locationBadgeTotals}
          onLocationChange={changeSelectedLocation}
          onLogout={auth.logout}
          online={online}
          serviceUnavailable={serviceUnavailable}
        />
        <NavigationTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          profile={profile}
          ocrUploadItems={selectedOcrUploadItems}
          moduleBadgeCounts={selectedModuleBadgeCounts}
          online={online}
        />
      </section>

      <section className={`mx-auto w-full px-3 py-5 sm:px-4 sm:py-6 ${activeTab === "rubber" || activeTab === "rubber-export" ? "max-w-[1800px]" : "max-w-7xl"}`}>
        {activeTab === "dashboard" && (
          <Dashboard
            selectedLocation={selectedLocation}
            online={online}
            canManageDashboard={canManageSystemFeatures(profile)}
          />
        )}
        {activeTab === "rubber" && (
          <RubberBillsModule
            selectedLocation={selectedLocation}
            profile={profile}
            initialSearch={
              pendingRubberBillSource?.locationId === selectedLocationId
                ? pendingRubberBillSource.billDate ?? null
                : null
            }
            onInitialSearchHandled={() => setPendingRubberBillSource(null)}
          />
        )}
        {activeTab === "rubber-export" && canAccessReports && (
          <RubberExportsModule
            selectedLocation={selectedLocation}
            profile={profile}
            online={online}
            initialExportId={
              pendingRubberExportSource?.locationId === selectedLocationId
                ? pendingRubberExportSource.exportId
                : null
            }
            onInitialExportHandled={() => setPendingRubberExportSource(null)}
          />
        )}
        {activeTab === "customers" && (
          <CustomersModule online={online} />
        )}
        {activeTab === "transport" && (
          <TransportModule locationId={selectedLocationId} online={online} />
        )}
        {activeTab === "money-transfer" && canAccessMoneyTransfer && (
          <MoneyTransferModule
            locationId={selectedLocationId}
            locations={locations}
            online={online}
            profile={profile}
            initialEditTransferId={
              pendingMoneyTransferSource?.locationId === selectedLocationId
                ? pendingMoneyTransferSource.transferId
                : null
            }
            onInitialEditTransferHandled={() => setPendingMoneyTransferSource(null)}
          />
        )}
        {activeTab === "ocr" && (
          <OcrTicketUpload
            locationId={selectedLocationId}
            online={online}
            uploadItems={ocrUploadItems}
            setUploadItems={setOcrUploadItems}
            initialDateFilter={
              pendingOcrTicketSource?.locationId === selectedLocationId
                ? pendingOcrTicketSource.ticketDate ?? null
                : null
            }
            onInitialDateFilterHandled={() => setPendingOcrTicketSource(null)}
          />
        )}
        {activeTab === "cash" && (
          <IncomeExpenseModule
            selectedLocation={selectedLocation}
            profile={profile}
            canCreateMoneyTransfer={canAccessMoneyTransfer}
            onOpenMoneyTransferSource={canAccessMoneyTransfer ? openMoneyTransferSource : undefined}
            onOpenRubberBillSource={openRubberBillSource}
            onOpenRubberExportSource={openRubberExportSource}
            onOpenOcrTicketSource={openOcrTicketSource}
            onOpenTimeTrackingSource={() => setActiveTab("time-tracking")}
          />
        )}
        {activeTab === "acid-stock" && (
          <AcidStockModule
            selectedLocation={selectedLocation}
            profile={profile}
            locations={locations}
            online={online}
          />
        )}
        {activeTab === "time-tracking" && (
          <TimeTrackingModule profile={profile} online={online} locations={locations} />
        )}
        {activeTab === "reports" && canAccessReports && (
          <ReportsModule
            selectedLocation={selectedLocation}
            profile={profile}
            online={online}
          />
        )}
        {activeTab === "admin" && (
          <AdminModule
            locations={locations}
            profile={profile}
            onAddLocation={addLocation}
          />
        )}
      </section>
    </main>
  );
}
