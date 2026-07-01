# LanFlow Tech Stack Overview

เอกสารนี้สรุปเทคโนโลยีที่ใช้งานอยู่ในโปรเจค LanFlow ณ ปัจจุบัน

## 1. Core Languages
- **TypeScript** (v5.7+) 
  ภาษาหลักที่ใช้เขียนทั้งฝั่ง Frontend และ Backend รองรับ Type Checking ทำให้โค้ดมีความปลอดภัยและจัดการ Error ได้ตั้งแต่ตอนเขียนโค้ด

## 2. Frameworks
- **Next.js** (v15.1+) 
  Full-stack Framework แบบ App Router ใช้สำหรับทำระบบ Routing, การ Render หน้าเว็บเพจ และทำฝั่ง Backend API (Server Actions & Route Handlers)
- **React** (v19.0+) 
  ใช้สร้างโครงสร้างและจัดการ State ของ User Interface (UI)
- **Supabase** (`@supabase/supabase-js`, `@supabase/ssr`) 
  ระบบ Backend สำเร็จรูปครอบคลุมตั้งแต่ Database (PostgreSQL), Authentication (ระบบล็อกอิน), และ Row Level Security (RLS)

## 3. UI, Styling & Components
- **Tailwind CSS** (v3.4+) 
  Utility-first CSS Framework ที่ใช้จัดการหน้าตาและสไตล์ของเว็บผ่านคลาสทั้งหมด
- **Lucide React** 
  ชุดไอคอนหลักของระบบ 
- **SweetAlert2** (`sweetalert2`, `sweetalert2-react-content`) 
  ใช้สำหรับสร้าง Pop-up แจ้งเตือนแบบกำหนดเอง (เช่น หน้าต่างยืนยันการลบ/บันทึก)
- **Sonner** 
  ไลบรารีสำหรับสร้าง Toast Notification (การแจ้งเตือนแบบป๊อปอัปเล็กๆ ที่มุมจอ)

## 4. Data Fetching & State Management
- **TanStack Query / React Query** (v5+) 
  ใช้จัดการการดึงข้อมูลจาก API แบบมีประสิทธิภาพ ครอบคลุมระบบ Caching, การจัดการ Loading/Error states และการอัปเดตข้อมูลแบบเบื้องหลัง (Background updates)

## 5. Additional Features
- **Next-PWA** (`@ducanh2912/next-pwa`) 
  ใช้ทำ Progressive Web App (PWA) ทำให้เว็บสามารถติดตั้งลงบนหน้าจอมือถือ ไอแพด หรือคอมพิวเตอร์ และใช้งานเสมือนเป็นแอปพลิเคชันตัวหนึ่งได้
