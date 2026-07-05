import { Plus } from "lucide-react";
import { useState } from "react";

import { useRubberBills } from "@/hooks/useRubberBills";
import { useCustomers } from "@/hooks/useCustomers";

import type { Location, Profile, RubberBill } from "@/types";
import { RubberBillsTable } from "./RubberBillsTable";
import { RubberBillModal } from "./RubberBillModal";

export function RubberBillsModule({
  selectedLocation,
  profile
}: {
  selectedLocation: Location;
  profile: Profile;
}) {
  const { bills, addBill, updateBill, deleteBill } = useRubberBills(selectedLocation.id);
  const { customers, addCustomer, updateCustomer } = useCustomers();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<RubberBill | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const filteredBills = (bills || []).filter((bill: RubberBill) => {
    const haystack = [
      bill.billNo,
      bill.localBillNo,
      bill.serverBillNo,
      bill.billDate,
      bill.customerName,
      bill.customerType,
      bill.billType,
      bill.createdByName,
      bill.createdByPhone
    ].join(" ");
    return haystack.toLowerCase().includes(search.toLowerCase());
  });

  function openAdd() {
    setEditingBill(null);
    setModalOpen(true);
  }

  function openEdit(bill: RubberBill) {
    setEditingBill(bill);
    setModalOpen(true);
  }

  function confirmDelete(bill: RubberBill) {
    if (confirm("ต้องการลบบิลนี้ใช่หรือไม่?")) {
      deleteBill({ id: bill.id, clientTempId: bill.clientTempId, deletedByName: profile.name, deletedByPhone: profile.phone, revisionNo: bill.revisionNo })
        .catch((err) => alert(err.message));
    }
  }

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function handlePageSize(value: string) {
    setPageSize(Number(value));
    setPage(1);
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border border-black/10 bg-white p-4 shadow-panel sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">CRUD บิลยาง · {selectedLocation.name}</h2>
          <p className="text-sm text-ink/60">เพิ่ม แก้ไข ลบ และตรวจรายการบิลของสาขาที่เลือก</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-leaf px-4 font-semibold text-white"
        >
          <Plus size={18} />
          เพิ่มบิลยาง
        </button>
      </div>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="rounded-md bg-amber px-4 py-2 text-sm font-bold text-ink">
              จับเวลา เท็กรับน้ำ
            </button>
            <button type="button" onClick={openAdd} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white">
              เพิ่มข้อมูล
            </button>
            <select
              value={pageSize}
              onChange={(event) => handlePageSize(event.target.value)}
              className="focus-ring h-10 rounded-md border border-black/20 bg-white px-3"
            >
              {[10, 25, 50].map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            ค้นหา:
            <input
              value={search}
              onChange={(event) => handleSearch(event.target.value)}
              className="focus-ring h-10 w-full rounded-md border border-black/20 bg-white px-3 sm:w-64"
            />
          </label>
        </div>
        <RubberBillsTable
          bills={filteredBills}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onEdit={openEdit}
          onDelete={confirmDelete}
        />
      </section>

      {modalOpen && (
        <RubberBillModal
          selectedLocation={selectedLocation}
          profile={profile}
          bill={editingBill}
          customers={customers}
          onClose={() => setModalOpen(false)}
          onSave={(bill) => {
            const promise = editingBill ? updateBill(bill) : addBill(bill);
            promise
              .then(() => setModalOpen(false))
              .catch((err: any) => alert(err.message || "เกิดข้อผิดพลาดในการบันทึกบิล"));
          }}
          onAddCustomer={addCustomer.mutate}
          onUpdateCustomer={updateCustomer.mutate}
        />
      )}
    </section>
  );
}
