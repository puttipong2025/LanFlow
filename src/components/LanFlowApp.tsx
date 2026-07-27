"use client";

import { ShieldCheck, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState } from "react";
import { useAuthContext } from "@/components/AuthProvider";

import { isSupabaseConfigured } from "@/lib/supabase-browser";

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
import { isRubberBillPayable } from "@/lib/rubber-bill-validation";

import { writeBootstrapCache, readBootstrapCache } from "@/lib/lanflow/bootstrap-cache";
import { type Tab } from "@/components/lanflow/tabs";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { RubberBillsModule } from "@/components/rubber-bills/RubberBillsModule";
import { IncomeExpenseModule } from "@/components/income-expense/IncomeExpenseModule";
import { AcidStockModule } from "@/components/acid-stock/AcidStockModule";
import { ReportsModule } from "@/components/reports/ReportsModule";
import { RubberExportsModule } from "@/components/rubber-exports/RubberExportsModule";
import { AppHeader } from "@/components/lanflow/AppHeader";
import { NavigationTabs } from "@/components/lanflow/NavigationTabs";
import { canAccessSourceLocation, canUseMoneyTransfer, canUseReports } from "@/lib/permissions";
import { getOfflineTabBlockMessage, isTabBlockedOffline } from "@/lib/offline-module-policy";
import { getOcrActionState } from "@/lib/ocr-action-state";

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
  const [online, setOnline] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadDatabaseData() {
      setIsLoaded(false);

      if (!authProfileId) {
        setIsLoaded(true);
        return;
      }

      if (!navigator.onLine) {
        const cached = readBootstrapCache(authProfileId);
        if (cached) {
          setLocations(cached.locations);
          setProfile(cached.profile);
          setSelectedLocationId(cached.selectedLocationId);
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
        
        const locId = data.profile.locationIds[0] ?? data.locations[0]?.id ?? "";
        setSelectedLocationId(locId);

        writeBootstrapCache(authProfileId, {
          locations: data.locations,
          profile: data.profile,
          selectedLocationId: locId
        });


      } catch (error) {
        console.error("LanFlow database load failed", error);
      } finally {
        if (!ignore) setIsLoaded(true);
      }
    }

    void loadDatabaseData();

    return () => {
      ignore = true;
    };
  }, [authProfileId]);

  useEffect(() => {
    const syncOnlineState = () => setOnline(navigator.onLine);
    syncOnlineState();
    window.addEventListener("online", syncOnlineState);
    window.addEventListener("offline", syncOnlineState);
    return () => {
      window.removeEventListener("online", syncOnlineState);
      window.removeEventListener("offline", syncOnlineState);
    };
  }, []);

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
    setActiveTab("dashboard");
  }, [activeTab, online]);

  // Persist selected location on change
  useEffect(() => {
    if (authProfileId && isLoaded && locations.length > 0) {
      writeBootstrapCache(authProfileId, {
        locations,
        profile,
        selectedLocationId
      });
    }
  }, [selectedLocationId, locations, profile, authProfileId, isLoaded]);

  const { bills: allBills } = useRubberBills(selectedLocationId, queueOwnerUserId);
  const { transactions: allTransactions } = useIncomeExpense(selectedLocationId, queueOwnerUserId);

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

  const scopedBills = allBills.filter((bill) => bill.recordStatus !== "deleted");
  const scopedTransactions = allTransactions.filter((tx) => tx.recordStatus !== "deleted");

  const summary = useMemo(() => {
    const rubberPay = scopedBills
      .filter(isRubberBillPayable)
      .reduce((sum, bill) => sum + bill.netTotal, 0);
    const income = scopedTransactions
      .filter((tx) => tx.type === "income")
      .reduce((sum, tx) => sum + tx.cost, 0);
    const expense = scopedTransactions
      .filter((tx) => tx.type === "expense")
      .reduce((sum, tx) => sum + tx.cost, 0);
    const rubberBillDerivedExpense = scopedTransactions
      .filter((tx) => tx.type === "expense" && tx.relationSourceType === "rubber_bill_daily")
      .reduce((sum, tx) => sum + tx.cost, 0);
    const rubberPayOutsideIncomeExpense = Math.max(0, rubberPay - rubberBillDerivedExpense);
    return {
      billCount: scopedBills.length,
      rubberWeight: scopedBills.reduce((sum, bill) => sum + bill.netWeight, 0),
      rubberPay,
      income,
      expense,
      balance: income - expense - rubberPayOutsideIncomeExpense
    };
  }, [scopedBills, scopedTransactions]);

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
        <button
          onClick={auth.logout}
          className="focus-ring mt-6 flex items-center gap-2 rounded-md bg-danger px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-danger/90"
        >
          <LogOut size={16} />
          ออกจากระบบ
        </button>
      </div>
    );
  }

  async function addLocation(name: string) {
    try {
      const response = await authFetch("/api/lanflow/admin/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const data = await response.json();
      if (!response.ok) {
        console.error("Failed to add location:", data.error);
        return;
      }
      const newLoc = data.location;
      setLocations((current) => [...current, newLoc]);
      setProfile((current) => ({ ...current, locationIds: [...current.locationIds, newLoc.id] }));
    } catch (error) {
      console.error("Add location error:", error);
    }
  }

  function canOpenSourceLocation(locationId: string) {
    return canAccessSourceLocation(profile, locationId);
  }

  function openMoneyTransferSource(transferId: string, locationId: string) {
    if (!online) {
      toast.error("โมดูลโอนเงินใช้ได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    if (!canAccessMoneyTransfer) return;
    if (!canOpenSourceLocation(locationId)) return;
    setSelectedLocationId(locationId);
    setPendingMoneyTransferSource({ transferId, locationId });
    setActiveTab("money-transfer");
  }

  function openRubberBillSource(locationId: string, billDate?: string) {
    if (!canOpenSourceLocation(locationId)) return;
    setSelectedLocationId(locationId);
    setPendingRubberBillSource({ locationId, billDate });
    setActiveTab("rubber");
  }

  function openOcrTicketSource(locationId: string, ticketDate?: string) {
    if (!online) {
      toast.error("อ่านใบชั่งใช้ได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    if (!canOpenSourceLocation(locationId)) return;
    setSelectedLocationId(locationId);
    setPendingOcrTicketSource({ locationId, ticketDate });
    setActiveTab("ocr");
  }

  function openRubberExportSource(exportId: string, locationId: string) {
    if (!online) {
      toast.error("ส่งออกยางใช้ได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    if (!canAccessReports || !canOpenSourceLocation(locationId)) return;
    setSelectedLocationId(locationId);
    setPendingRubberExportSource({ exportId, locationId });
    setActiveTab("rubber-export");
  }

  return (
    <main className="min-h-screen">
      <section className="border-b border-black/10 bg-white/85">
        <AppHeader
          profile={profile}
          locations={locations}
          selectedLocationId={selectedLocationId}
          locationBadgeTotals={locationBadgeTotals}
          onLocationChange={setSelectedLocationId}
          onLogout={auth.logout}
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

      <section className={`mx-auto w-full px-3 py-4 sm:px-4 sm:py-5 ${activeTab === "rubber" || activeTab === "rubber-export" ? "max-w-[1800px]" : "max-w-7xl"}`}>
        {activeTab === "dashboard" && (
          <Dashboard
            selectedLocation={selectedLocation}
            summary={summary}
            bills={scopedBills}
            transactions={scopedTransactions}
            supabaseReady={isSupabaseConfigured()}
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
