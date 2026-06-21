# LanFlow Tech Stack

เอกสารนี้สรุปเครื่องมือหลักที่โปรเจกต์ LanFlow ใช้อยู่ โดยอ้างอิงจาก `package.json`, config files และแพ็กเกจที่ติดตั้งจริงใน `node_modules`

## Framework และ Runtime หลัก

| ส่วน | เครื่องมือ | เวอร์ชันที่ติดตั้งจริง | เวอร์ชันที่ระบุใน `package.json` |
| --- | --- | --- | --- |
| Web framework | Next.js | `15.5.19` | `^15.1.2` |
| UI library | React | `19.2.7` | `^19.0.0` |
| React renderer | React DOM | `19.2.7` | `^19.0.0` |
| Language | TypeScript | `5.9.3` | `^5.7.2` |

โปรเจกต์ใช้ Next.js แบบ App Router และมี API routes อยู่ใต้ `src/app/api/lanflow/`

## CSS และ UI

| ส่วน | เครื่องมือ | เวอร์ชันที่ติดตั้งจริง | หมายเหตุ |
| --- | --- | --- | --- |
| CSS framework | Tailwind CSS | `3.4.19` | ตั้งค่าใน `tailwind.config.ts` |
| CSS processor | PostCSS | `8.4.49` | ตั้งค่าใน `postcss.config.js` |
| Vendor prefixes | Autoprefixer | `10.4.20` | ใช้ผ่าน PostCSS |
| Icons | lucide-react | `0.468.0` | ใช้สำหรับไอคอนใน React |

Tailwind config มี theme สีเฉพาะของโปรเจกต์ เช่น `ink`, `field`, `leaf`, `mint`, `amber`, `clay`, และ `river`

## Backend และ Database

| ส่วน | เครื่องมือ | เวอร์ชัน/สถานะ | หมายเหตุ |
| --- | --- | --- | --- |
| Backend routes | Next.js API Routes | ใช้งานอยู่ | อยู่ใน `src/app/api/lanflow/` |
| Database/Auth/Storage | Supabase | ใช้งาน local config | ตั้งค่าใน `supabase/config.toml` |
| Supabase client | `@supabase/supabase-js` | `2.108.2` | ระบุใน `package.json` เป็น `^2.47.10` |
| Supabase SSR helper | `@supabase/ssr` | `0.6.1` | ใช้สำหรับ integration ฝั่ง SSR/server |
| Local database | PostgreSQL | major version `17` | ระบุใน `supabase/config.toml` |

ตอนนี้แอปใช้ Next.js API routes เป็น bridge ไปยัง Supabase local database โดยมีไฟล์ server helper หลักที่ `src/lib/server/lanflow-db.ts`

## PWA และ Offline

- มี Web App Manifest ที่ `public/manifest.json`
- มี Service Worker ที่ `public/sw.js`
- มี component สำหรับ register PWA ที่ `src/components/PwaRegister.tsx`
- มี offline queue hook ที่ `src/hooks/use-offline-queue.ts`
- ใช้ `localStorage` เก็บ queue ฝั่ง client สำหรับ workflow แบบ offline-first

## เครื่องมือช่วยพัฒนา

| เครื่องมือ | เวอร์ชันที่ติดตั้งจริง | ใช้ทำอะไร |
| --- | --- | --- |
| ESLint | `9.39.4` | ตรวจคุณภาพโค้ด |
| eslint-config-next | `^15.1.2` | กฎ lint สำหรับ Next.js |
| TypeScript compiler | `5.9.3` | type checking |
| npm | ใช้งานผ่าน `package-lock.json` | package manager หลักของโปรเจกต์ |

มี `pnpm-workspace.yaml` อยู่ในโปรเจกต์ด้วย แต่ dependency lock หลักที่พบคือ `package-lock.json` จึงถือว่า npm เป็น package manager หลักในตอนนี้

## Scripts สำคัญ

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
```

รายละเอียดจาก `package.json`:

| Script | Command | ใช้สำหรับ |
| --- | --- | --- |
| `dev` | `next dev` | รัน dev server |
| `build` | `next build` | build production |
| `start` | `next start` | รัน production server หลัง build |
| `lint` | `next lint` | lint ตาม config ของ Next.js |
| `typecheck` | `tsc --noEmit` | ตรวจ TypeScript โดยไม่สร้างไฟล์ output |

## Config Files สำคัญ

| ไฟล์ | หน้าที่ |
| --- | --- |
| `next.config.ts` | ตั้งค่า Next.js เช่น `reactStrictMode` |
| `tailwind.config.ts` | ตั้งค่า Tailwind content path และ theme |
| `postcss.config.js` | เปิดใช้ Tailwind CSS และ Autoprefixer |
| `.eslintrc.json` | extends `next/core-web-vitals` |
| `tsconfig.json` | ตั้งค่า TypeScript strict mode และ path alias `@/*` |
| `supabase/config.toml` | ตั้งค่า Supabase local development |
| `.env.local` | environment variables สำหรับ local development |

## สรุปสั้น

LanFlow เป็นโปรเจกต์ Next.js 15 + React 19 + TypeScript strict mode ใช้ Tailwind CSS 3 สำหรับ styling, Supabase/PostgreSQL เป็น backend data layer, มี PWA/offline-first support และใช้ npm, ESLint, TypeScript compiler, PostCSS/Autoprefixer เป็นเครื่องมือช่วยพัฒนาหลัก
