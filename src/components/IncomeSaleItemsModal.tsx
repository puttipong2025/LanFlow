import { useState } from "react";
import { useIncomeSaleItems } from "@/hooks/useIncomeSaleItems";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export function IncomeSaleItemsModal({ onClose }: { onClose: () => void }) {
  const { items, isLoading, addItem, disableItem, deleteItem } = useIncomeSaleItems({ includeInactive: true });
  const [newItemName, setNewItemName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newItemName.trim()) return;
    
    // Check duplicate
    if (items.some(item => item.name === newItemName.trim())) {
      toast.error("มีรายการนี้อยู่แล้ว");
      return;
    }

    try {
      setIsAdding(true);
      await addItem(newItemName.trim());
      setNewItemName("");
      toast.success("เพิ่มรายการสำเร็จ");
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDisable(id: string, name: string) {
    if (!window.confirm(`ต้องการปิดใช้งาน "${name}" ใช่หรือไม่?`)) return;
    try {
      await disableItem(id);
      toast.success("ปิดใช้งานสำเร็จ");
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด");
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`ต้องการลบ "${name}" ออกจากระบบถาวร ใช่หรือไม่?\n\n(ลบได้เฉพาะรายการที่ยังไม่มีในรายรับเท่านั้น)`)) return;
    try {
      await deleteItem({ id });
      toast.success("ลบรายการสำเร็จ");
    } catch (err: any) {
      toast.error(err.message || "เกิดข้อผิดพลาด");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-black/10 px-6 py-4">
          <h2 className="text-xl font-bold text-ink">จัดการรายการบิลขาย</h2>
          <button onClick={onClose} className="text-2xl leading-none text-ink/50 hover:text-ink">&times;</button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <form onSubmit={handleAdd} className="mb-6 flex gap-2">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="ชื่อรายการบิลขายใหม่..."
              className="focus-ring h-11 flex-1 rounded-md border border-black/10 px-3"
              disabled={isAdding}
            />
            <button
              type="submit"
              disabled={!newItemName.trim() || isAdding}
              className="focus-ring flex h-11 items-center gap-2 rounded-md bg-blue-600 px-4 font-bold text-white disabled:opacity-50"
            >
              <Plus size={18} />
              เพิ่ม
            </button>
          </form>

          {isLoading ? (
            <p className="text-center text-ink/50">กำลังโหลด...</p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-ink/60">
                  <th className="py-2">ชื่อรายการ</th>
                  <th>สถานะ</th>
                  <th>ผู้สร้าง</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-ink/50">ไม่มีรายการ</td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className={`border-b border-black/5 ${!item.isActive ? "opacity-50" : ""}`}>
                      <td className="py-2 font-semibold text-ink">{item.name}</td>
                      <td>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${item.isActive ? "bg-leaf/10 text-leaf" : "bg-ink/10 text-ink"}`}>
                          {item.isActive ? "ใช้งาน" : "ปิดใช้งาน"}
                        </span>
                      </td>
                      <td className="text-ink/60">{item.createdByName || "System"}</td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {item.isActive && (
                            <button
                              type="button"
                              onClick={() => handleDisable(item.id, item.name)}
                              className="rounded-md bg-rose-100 px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-200"
                            >
                              ปิดใช้งาน
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id, item.name)}
                            className="rounded-md bg-red-600 px-2 py-1 text-xs font-bold text-white hover:bg-red-700"
                          >
                            ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="border-t border-black/10 p-4 text-right">
          <button onClick={onClose} className="focus-ring h-11 rounded-md bg-field px-6 font-bold text-ink">
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}
