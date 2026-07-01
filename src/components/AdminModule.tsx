"use client";

import { toast } from "sonner";
import appSwal from "@/lib/swal";
import { useState, useEffect } from "react";
import { ShieldCheck, Users, Smartphone, Database, X, Building2, UserPlus, Loader2 } from "lucide-react";
import type { Location, Profile } from "@/types";
import { authFetch } from "@/lib/auth-fetch";

export function AdminModule({
  locations,
  profile,
  onAddLocation
}: {
  locations: Location[];
  profile: Profile;
  onAddLocation: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    phone: "",
    password: "",
    role: "user" as "user" | "admin",
    locationId: ""
  });

  async function loadUsers() {
    try {
      setLoading(true);
      const res = await authFetch("/api/lanflow/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error("Failed to load users:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function handleToggleRole(userId: string, currentRole: string) {
    if (profile.role !== "super_admin") {
      toast.error("Only super_admin can change roles.");
      return;
    }
    
    const newRole = currentRole === "admin" ? "user" : "admin";
    const result = await appSwal.fire({ title: 'Change Role?', text: `Are you sure you want to change this user's role to ${newRole}?`, icon: 'warning', showCancelButton: true, confirmButtonText: 'Yes, change it' });
    if (!result.isConfirmed) return;

    try {
      const res = await authFetch(`/api/lanflow/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role: newRole })
      });
      if (res.ok) {
        loadUsers();
      } else {
        const data = await res.json();
        toast.error(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function handleToggleStatus(userId: string, currentStatus: boolean) {
    if (!["super_admin", "admin"].includes(profile.role)) return;

    const actionText = currentStatus ? "ระงับการใช้งาน" : "กู้คืนการใช้งาน";
    const result = await appSwal.fire({
      title: `${actionText}?`,
      text: `คุณแน่ใจหรือไม่ที่จะ${actionText}บัญชีผู้ใช้นี้?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'ยืนยัน',
      confirmButtonColor: currentStatus ? '#ef4444' : '#2f6b4f'
    });
    if (!result.isConfirmed) return;

    try {
      const res = await authFetch(`/api/lanflow/admin/users/${userId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !currentStatus })
      });
      if (res.ok) {
        toast.success(`${actionText}สำเร็จ`);
        loadUsers();
      } else {
        const data = await res.json();
        toast.error(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error(error);
      toast.error("เกิดข้อผิดพลาด");
    }
  }

  async function handleCreateUser(event: React.FormEvent) {
    event.preventDefault();
    if (!["super_admin", "admin"].includes(profile.role)) return;

    setCreatingUser(true);
    try {
      const res = await authFetch("/api/lanflow/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: newUser.phone,
          name: newUser.name,
          password: newUser.password,
          role: newUser.role,
          locationIds: newUser.locationId ? [newUser.locationId] : []
        })
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "สร้างบัญชีไม่สำเร็จ");
        return;
      }

      toast.success("สร้างบัญชีผู้ใช้แล้ว");
      setNewUser({
        name: "",
        phone: "",
        password: "",
        role: "user",
        locationId: ""
      });
      await loadUsers();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้างบัญชีไม่สำเร็จ");
    } finally {
      setCreatingUser(false);
    }
  }

  async function handleAddLocationToUser(userId: string, locationId: string) {
    try {
      const res = await authFetch("/api/lanflow/admin/user-locations", {
        method: "POST",
        body: JSON.stringify({ userId, locationId })
      });
      if (res.ok) {
        loadUsers();
      } else {
        const data = await res.json();
        toast.error(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error(error);
    }
  }

  async function handleRemoveLocationFromUser(userId: string, locationId: string) {
    const result = await appSwal.fire({ title: 'Remove Branch?', text: "Are you sure you want to remove this branch from the user?", icon: 'warning', showCancelButton: true, confirmButtonText: 'Yes, remove it', confirmButtonColor: '#ef4444' });
    if (!result.isConfirmed) return;
    try {
      const res = await authFetch(`/api/lanflow/admin/user-locations?userId=${userId}&locationId=${locationId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        loadUsers();
      } else {
        const data = await res.json();
        toast.error(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error(error);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel h-fit">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck size={18} className="text-leaf" />
          <h2 className="text-lg font-bold text-ink">สิทธิ์ผู้ดูแล</h2>
        </div>
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2"><Users size={17} /> {profile.name} · {profile.role === 'super_admin' ? 'Super Admin' : profile.role === 'admin' ? 'Admin' : profile.role}</p>
          <p className="flex items-center gap-2"><Smartphone size={17} /> Login phone unique: {profile.phone}</p>
          <p className="flex items-center gap-2"><Database size={17} /> สาขาที่ดูแล {profile.locationIds.length} แห่ง</p>
        </div>

        <h2 className="mt-8 mb-4 text-lg font-bold text-ink">สาขาทั้งหมด</h2>
        {profile.role === 'super_admin' && (
          <form
            className="mb-4 flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) onAddLocation(name.trim());
              setName("");
            }}
          >
            <input
              className="focus-ring h-11 flex-1 rounded-md border border-black/10 px-3"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ชื่อสาขาใหม่"
            />
            <button className="focus-ring h-11 rounded-md bg-leaf px-4 font-semibold text-white">
              เพิ่มสาขา
            </button>
          </form>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-center justify-between rounded border border-black/5 bg-black/5 px-3 py-2 text-sm">
              <span className="font-medium text-ink">{loc.name}</span>
              <span className="rounded bg-black/10 px-1.5 py-0.5 text-xs font-mono">{loc.code}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus size={18} className="text-river" />
          <h2 className="text-lg font-bold text-ink">รายชื่อพนักงานในระบบ</h2>
        </div>

        {["super_admin", "admin"].includes(profile.role) && (
          <form
            onSubmit={handleCreateUser}
            className="mb-5 grid gap-3 rounded-md border border-leaf/20 bg-leaf/5 p-3 sm:grid-cols-2"
          >
            <input
              required
              className="focus-ring h-10 rounded-md border border-black/10 bg-white px-3"
              placeholder="ชื่อพนักงาน"
              value={newUser.name}
              onChange={(event) => setNewUser((current) => ({ ...current, name: event.target.value }))}
            />
            <input
              required
              className="focus-ring h-10 rounded-md border border-black/10 bg-white px-3"
              placeholder="เบอร์โทร 08xxxxxxxx"
              inputMode="tel"
              value={newUser.phone}
              onChange={(event) => setNewUser((current) => ({ ...current, phone: event.target.value }))}
            />
            <input
              required
              minLength={8}
              type="password"
              className="focus-ring h-10 rounded-md border border-black/10 bg-white px-3"
              placeholder="รหัสผ่านอย่างน้อย 8 ตัว"
              value={newUser.password}
              onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))}
            />
            {profile.role === 'super_admin' && (
              <select
                className="focus-ring h-10 rounded-md border border-black/10 bg-white px-3"
                value={newUser.role}
                onChange={(event) =>
                  setNewUser((current) => ({
                    ...current,
                    role: event.target.value as "user" | "admin"
                  }))
                }
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            )}
            <select
              required
              className="focus-ring h-10 rounded-md border border-black/10 bg-white px-3 sm:col-span-2"
              value={newUser.locationId}
              onChange={(event) =>
                setNewUser((current) => ({ ...current, locationId: event.target.value }))
              }
            >
              <option value="">เลือกสาขาเริ่มต้น</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
            <button
              disabled={creatingUser}
              className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-leaf px-4 font-semibold text-white disabled:opacity-60 sm:col-span-2"
            >
              {creatingUser ? <Loader2 className="animate-spin" size={16} /> : <UserPlus size={16} />}
              สร้างบัญชีผู้ใช้
            </button>
          </form>
        )}
        
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="animate-spin text-ink/40" />
          </div>
        ) : (
          <div className="space-y-4">
            {users
              .filter(user => profile.role === "super_admin" || user.role !== "super_admin")
              .map((user) => (
              <div key={user.id} className="rounded-md border border-black/10 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-ink flex items-center gap-2">
                      {user.name} 
                      {user.role === 'super_admin' && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded border border-purple-200">Super Admin</span>}
                      {user.role === 'admin' && <span className="text-xs bg-leaf/10 text-leaf px-1.5 py-0.5 rounded border border-leaf/20">Admin</span>}
                      {user.isActive === false && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200">ถูกระงับการใช้งาน</span>}
                    </h3>
                    <p className="text-sm text-ink/70">{user.phone}</p>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2">
                    {user.role !== 'super_admin' && profile.role === 'super_admin' && (
                      <button 
                        onClick={() => handleToggleRole(user.id, user.role)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          user.role === 'admin' 
                            ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' 
                            : 'border-leaf/30 bg-leaf/10 text-leaf hover:bg-leaf/20'
                        }`}
                      >
                        {user.role === 'admin' ? 'ลดสิทธิ์เป็น User' : 'เลื่อนเป็น Admin'}
                      </button>
                    )}
                    {user.role !== 'super_admin' && user.id !== profile.id && profile.role === 'super_admin' && (
                      <button 
                        onClick={() => handleToggleStatus(user.id, user.isActive !== false)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          user.isActive !== false
                            ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' 
                            : 'border-leaf/30 bg-leaf/10 text-leaf hover:bg-leaf/20'
                        }`}
                      >
                        {user.isActive !== false ? 'ระงับการใช้งาน' : 'กู้คืนการใช้งาน'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-xs font-semibold text-ink/60 mb-2 uppercase tracking-wider">สาขาที่ดูแล</p>
                  <div className="flex flex-wrap gap-2">
                    {user.locationIds.map(locId => {
                      const loc = locations.find(l => l.id === locId);
                      if (!loc) return null;
                      return (
                        <span key={locId} className="inline-flex items-center gap-1 bg-river/10 text-river border border-river/20 rounded px-2 py-1 text-sm">
                          <Building2 size={14} />
                          {loc.name}
                          {user.role !== 'super_admin' && (profile.role === 'super_admin' || user.role !== 'admin') && (
                            <button 
                              onClick={() => handleRemoveLocationFromUser(user.id, loc.id)}
                              className="ml-1 text-river/60 hover:text-red-500 transition-colors"
                              title="ลบสิทธิ์สาขา"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </span>
                      );
                    })}
                    
                    {/* Add Location Dropdown */}
                    {user.role !== 'super_admin' && (profile.role === 'super_admin' || user.role !== 'admin') && (
                      <select 
                        className="bg-black/5 border border-black/10 rounded px-2 py-1 text-sm text-ink/70 outline-none focus:border-river focus:ring-1 focus:ring-river"
                        onChange={(e) => {
                          if (e.target.value) {
                            handleAddLocationToUser(user.id, e.target.value);
                            e.target.value = ""; // reset
                          }
                        }}
                      >
                        <option value="">+ เพิ่มสาขา</option>
                        {locations
                          .filter(l => !user.locationIds.includes(l.id))
                          .map(l => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))
                        }
                      </select>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
