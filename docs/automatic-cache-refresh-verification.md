# หลักฐานการพัฒนาแคชตามเวอร์ชัน

## ขอบเขต

ผู้ใช้สั่งเริ่มทุก Phase วันที่ 2026-10-30 หลังอนุมัติแผนปรับปรุง รอบนี้แก้ในเครื่องและอัปเดตเอกสาร ไม่ถือว่าได้รับคำสั่ง deploy หรือ reset ข้อมูลจริง

## Phase 1: การทำซ้ำและเส้นทางที่ตรวจ

- Controlled reproduction: ใส่สำเนาบิลเก่าลง IndexedDB แล้วได้รับ feed ว่าง สำเนานั้นยังอ่านได้ การ invalidate จากเพิ่ม/แก้/ลบขณะออฟไลน์จึงอ่านสำเนาเดิมกลับได้ นี่เป็นกรณีจำลอง ไม่ยืนยันว่าเป็นต้นเหตุเดียวกับเครื่องผู้ใช้ซึ่งล้างข้อมูลไปแล้ว
- เส้นทาง: mutation → invalidation → `useRubberBillList` ขณะออฟไลน์ → snapshots + คิว → merge → ตาราง ส่วนออนไลน์เก็บเฉพาะ rows ที่โหลด ไม่สามารถใช้การไม่อยู่ในผลค้นหาเป็นหลักฐานลบ
- สมมติฐานที่จัดอันดับ: (1) สำเนาจากก่อนมีกลไก tombstone หรือการลบอีกเครื่องยังอยู่ (2) คำขอเก่าเขียนกลับหลังลบ (3) ไฟล์แอปเก่า การทดสอบเก่าของกรณี (2) ผ่านและมี transaction กันแล้ว จึงไม่ถือว่า cache upgrade แก้กรณีทุกชนิด ส่วน (3) ไม่มีไฟล์/สถานะเครื่องเดิมสำหรับทำซ้ำ
- การพยายามหักล้าง: เก็บ tombstone แล้วเขียนสำเนาเก่าซ้ำต้องไม่กลับมา; ชุดทดสอบเดิมตรวจแล้วผ่าน การส่ง feed ว่างไม่ลบสำเนาเป็นพฤติกรรมจำเป็นเพราะการแบ่งหน้า ไม่แก้ด้วยลบทุก ID ที่ไม่อยู่ในหน้าแรก
- รุ่นเดิมกับบิลถูกลบภายหลังยังเป็นคนละปัญหาจากการซ่อมสำเนาครั้งแรก การตรวจรุ่นไม่ทำ polling สถานะบิล และไม่อ้างรับประกันลบข้ามเครื่องล่าสุดทุกขณะ

## สัญญาที่เลือก

- `GET /api/lanflow/business-cache?locationId=UUID`: requireAuth + effective active branch scope, private/no-store, คืน versions rubber/income แยกกัน ไม่มีข้อมูลธุรกิจ
- `POST /api/lanflow/business-cache`: locationId + ids ไม่ซ้ำสูงสุด 100; authenticated request client เรียก `get_rubber_bill_cache_rows` ให้ตรวจ role, browser-session/SMS และสิทธิ์สาขาปัจจุบันอย่างชัดเจนในฟังก์ชัน SQL รวม soft deleted และ decorate approval/relation locks ใน statement snapshot เดียว คืน active snapshot / positively deleted พร้อม revision / unknown; unknown, forbidden, error ไม่ใช่การลบและห้ามรับชุดเป็นสำเร็จ
- ทดลอง SELECT โดยตรงแล้วถูกปฏิเสธ: authenticated ไม่มี table-wide SELECT และไม่มี column privilege สำหรับ price_adjustment_target จึงเพิ่ม RPC แบบจำกัด ID ใน migration `20261030030000_business_cache_receipts.sql` ไม่แก้ grants ของ table และไม่ใช้ service-role; apply เฉพาะ local แล้วพร้อม reload schema cache ไม่เปลี่ยน Cloud
- RPC SECURITY DEFINER ล็อก search_path ว่าง, revoke PUBLIC/anon และตรวจสิทธิ์ภายในเช่นเดียวกับ feed พร้อม SMS/browser-session gate ส่งออกเฉพาะข้อมูลสาขาที่มีสิทธิ์โดยตัด OCR source ID/hash ออก
- แยก protocol1 ออกจาก repair version เริ่ม rubber1/income1: เซิร์ฟเวอร์เพิ่ม repair version ภายใต้ protocol1 ได้โดยแอปที่เปิดอยู่ยังซ่อมได้เมื่อเกิด trigger ถ้า protocol ใหม่ที่แอปไม่รองรับจึงแสดงต้องโหลดแอปใหม่ ไม่รับรุ่นย้อนหลัง
- IndexedDB เปลี่ยน 7 → 8 เพิ่ม `business_cache_meta` แบบรักษา stores/ข้อมูลเดิมและ fence ตัวเขียนรุ่น 7; การปิด connection ผ่าน onversionchange ตามตัวเปิดเดิม รุ่น 7 ที่เปิดใหม่ต้อง VersionError
- Rollback ห้ามกลับไปเปิด DB version7 หรือ deleteDatabase ต้องคง opener8 และ store metadata ไว้แม้ยกเลิก feature ฝั่ง UI/server ไม่ลด versions metadata เพื่อปลอมว่าแอปเก่ารองรับได้
- สำเนาบิลยางและ metadata `rubber:branch` commit ใน transaction เดียว; คิว/ผลแจ้ง/draft ไม่ถูกล้าง สิทธิ์และ UI ยังแยกบัญชี สำเนารับ–จ่ายไม่เพิ่ม store ประวัติใหม่ ใช้ TanStack Query เดิมและ metadata `income:owner:branch`
- เจ้าของการตรวจอยู่ใน app sync coordinator หัวเว็บรับสถานะเพื่อแสดงเท่านั้น ถอด reconnect reload ที่ทำให้ฟอร์มบิลยางหาย ให้ queries และ coordinator อัปเดตในหน้า

## Experiment ledger

| Run | สิ่งที่ทดสอบ | ผลและข้อสรุป |
| --- | --- | --- |
| B1 | ชุดเดิม receipt/background/income projection | 43 ผ่านในรอบรีวิว ยืนยัน baseline กลไกเดิม ไม่ใช่ผลของ feature ใหม่ |
| R1 | business-cache controlled legacy snapshot | ผ่าน: feed ว่างไม่ลบ snapshot จึงทำให้สำเนาเก่ากลับมาได้เมื่ออ่านออฟไลน์ ไม่ถือเป็นหลักฐานลบ |
| R2 | protocol-fence regression ก่อนแก้ | ล้มเหลวตามคาด: ไม่มี business_cache_meta |
| G1 | protocol-fence หลังเพิ่ม DB8 | 2/2 ผ่าน: สำเนาเดิมอยู่ครบและตัวเปิด DB7 ถูก fence |
| S1 | ชุด persistence/queue เดิมและใหม่ | 78/78 ผ่านก่อนเพิ่ม RPC; ตรวจคิวและใบรับไม่สูญหาย |
| S2 | form wait, partial failure, repair version ต่างจาก protocol, prune race | ชุด feature17/17 ผ่าน และ resume/central รวม75/75 ผ่าน; ไม่มี polling ตรวจ metadata |
| A1 | authenticated API จริงอ่าน table โดยตรง | 503/42501 ตามคาดเมื่อสืบพบ column grants ไม่ครบ จึงไม่ขยายสิทธิ์ table แต่ใช้ bounded RPC |
| A2 | authenticated API จริงหลังเพิ่ม RPC | อ่าน active rows ผ่าน ไม่ได้ผ่านเพียง mock; branch ที่ไม่มีสิทธิ์403 |
| D1 | database tests + lint | focused12ผ่าน; full SQL69ไฟล์/1,603ข้อผ่าน; db lintระดับerrorไม่พบปัญหา |
| U1 | Chromium จริง ฟอร์ม/ออฟไลน์/หน้าจอแคบ | กรณี cache repair1/1ผ่านหลังป้องกัน details remount; ตรวจภาพกรอบที่360pxแล้ว ไม่มีoverflow |
| I1 | verify กับ dev serverพร้อมกัน | เกิด .next artifact ชนจาก auth-outage helper ที่เปิด Next อีกตัว จึงหยุดเฉพาะ runner/dev ที่เป็นของรอบนี้และรันแยก ไม่ใช้รอบที่ชนเป็นหลักฐาน |
| E1 | full isolated รอบแรก | 919ผ่าน/8ล้มเหลว/2ข้าม: 4 mocksของsync coordinatorต้องแยกboundaryhookใหม่; 4 testsรับ–จ่ายที่ค้างก่อนงานนี้พบauth/DB exceptionไม่ถูกแปลงเป็นprivate503 |
| E2 | รับ–จ่าย error boundaries | แก้เฉพาะfeed/detail/create-approval wrapper ให้คืนprivate/no-store503เมื่อเกิดexception ไม่เปลี่ยนbusinesslogic; 15/15ผ่าน |
| V1 | npm run verify รอบแยก | lint/typecheck/source-size/import-direction/auth-outage ผ่าน; isolated929ผ่าน/2existing skips; production build/SW/bundleผ่าน (first load289.9kBจากbudget320kB) |
| P1 | Production PWA ผ่าน APIจริงและ offline F5 | 2/2ผ่าน: เตรียมออฟไลน์100%, เปิดฟอร์มแล้วreconnectไม่reload, ซ่อมสำเนาที่ลบ, F5ออฟไลน์ยังเปิดแอป/แสดงสถานะได้ และไม่เพิ่มmetadata request; ภาพ output/cache-status-pwa-offline.png |

## แนวทางใช้งานและ rollback

- ใช้การเพิ่ม repair counter ของโมดูลใน `BUSINESS_CACHE_VERSIONS` เฉพาะเมื่อจำเป็น ไม่ผูกกับ build ID และไม่ลด counter เพื่อ rollback ถ้าเปลี่ยนรูปแบบจนโค้ดเก่าใช้ไม่ได้ต้องเปลี่ยน protocol/compatibility ด้วย
- Release ต้องติดตั้ง migration ใหม่ก่อนเผยแพร่ API/frontend; ถ้า RPC ยังไม่อยู่ ให้เก็บข้อมูลเดิมและแสดงล้มเหลว ห้ามแสดงว่าซ่อมสำเร็จ
- ข้อมูลซ่อมของบิลยางและ metadata commit พร้อมกันใน DB8; unknown/partial response หรือ snapshot เปลี่ยนระหว่างโหลดทำให้ abort ไม่ล้างคิว เครื่องหมายลบ หรือผลแจ้ง
- rollback ต้องรักษา opener8 และ store ใหม่ แม้ปิด feature; โค้ด7ที่เปิดค้างเขียน DB8 ไม่ได้ ต้องโหลดแอปที่รองรับใหม่ ไม่ใช้ deleteDatabase หรือรีเซ็ต Auth
- การลบข้ามเครื่องภายหลังใน repair version เดิมไม่ทำให้ counterเปลี่ยนอัตโนมัติ ไม่อ้างว่า featureนี้ทำให้ข้อมูลธุรกิจทุกบิลสดตลอดเวลาหรือแก้ต้นเหตุเครื่องเดิมได้ครบ

## Scrutinize รอบสุดท้าย

- ทางเลือกที่เลือกใช้ยังเป็นตัวตรวจร่วมกับที่เก็บเดิม ไม่สร้าง cache framework หรือประวัติรับ–จ่ายถาวร
- ไล่ UI/coordinator → metadata → batch RPC → authorized statement snapshot → conditional IndexedDB transaction → status/receipt รวม error boundaries และ rollback แล้ว
- พบและแก้จุดแยกprotocolจากrepair counter, อ่านtableโดยตรงที่column grantsปฏิเสธ, ข้อมูลapproval/lockที่ต้องdecorate, pruneจากผลอ่านเก่า และdetails remountขณะเน็ตเปลี่ยน
- ใช้RPCอ่านข้อมูลภายใต้statementเดียวแทนการคงrestrictionจากsnapshotเก่า ข้อมูลใบรับที่generateตรงกับbillที่commit ไม่ใช้การล้างคิวหรือเพิ่มสิทธิ์table
- ไม่พบข้อแก้ไขที่ค้างในขอบเขตนี้หลังผลตรวจรวมและPWAผ่าน ข้อจำกัดที่ยังคงอยู่คือไม่ยืนยันต้นเหตุเครื่องเดิมและไม่ตรวจทุกการลบข้ามเครื่องด้วยrepair counter
- Verdict: พร้อมตรวจรับ local; ต้องติดตั้ง migrationและเผยแพร่ตามขั้นตอนแยกก่อนอ้างproduction readiness รอบนี้ไม่มีcommit/push/Cloud migration/deploy

## ต่อเติมรอบตรวจค่ากลาง — 2026-10-30

ผู้ใช้กำหนดให้ superadmin ตั้งค่ากลาง 10–120 นาที สิทธิ์เดียวกับราคายางที่กำหนดสูงสุด และ focus zero แบบฟอร์มบิลยาง ตัวเลือกปิดเป็นค่าเริ่มต้นเพื่อคงพฤติกรรมเดิม ข้อตกลงนี้เพิ่มจากแผนเดิมที่ไม่มีรอบตรวจ

- Settings singleton + revision และ RPC ใน `20261030040000_business_cache_settings.sql` apply เฉพาะ local อัปเดต schema snapshot เฉพาะ object ใหม่จาก local dump
- API PUT ใช้ requireRole([super_admin]) และ RPC ตรวจ active role/session อีกชั้น; delegated manager ไม่มีสิทธิ์เขียน; stale expectedRevision คืน409 และไม่เขียนทับ ค่ากลางไม่เปลี่ยน repair version
- metadata GET เดิมรวมค่ากลางกับ versions/protocol; ไม่เพิ่ม config polling อีกชุด ไม่ยอมให้ metadata revision เก่าทับค่าที่เพิ่งบันทึก UI query ใช้ skipToken เพื่อแสดงค่าที่ coordinator ส่งให้
- ตัวตั้งเวลาอยู่กับ coordinator เดิม พักเมื่อ hidden/offline และถอดเมื่อออก scope; กลับเข้าแท็บนับรอบเต็มใหม่ ไม่ตรวจทันที ส่วน reconnect ตรวจทันทีตามเดิม การตรวจที่รอฟอร์มไม่เริ่มงานซ้อน
- เครื่องอื่นรับค่าที่เปิดหน้า/F5/reconnect/รอบเดิม เครื่องที่ปิดรอบอยู่ต้องเกิด trigger เดิมก่อนจึงทราบว่ามีผู้เปิดค่ากลาง ไม่อ้าง push ทันที ไม่เพิ่ม server cron หรือการประสานแท็บสำหรับ setting
- UI อยู่ข้างตรวจความพร้อมอีกครั้ง ใช้ ModalShell native และ NumberField เดิม ตรวจช่องว่างจริงก่อน submit เพื่อไม่บันทึกค่าก่อนหน้าเมื่อกด Enter ขณะว่าง

| Run | ผลตรวจงานต่อยอด |
| --- | --- |
| C1 | Feature isolation เดิม21/21ผ่าน; เพิ่ม assertion ป้องกัน metadata setting revision เก่าทับค่าที่ใหม่กว่า แล้วรวมใน verify |
| C2 | SQL settings16ข้อผ่าน; full70ไฟล์/1,619ข้อผ่าน; db lint results=[] |
| C3 | Chromium3/3ผ่าน: setting10นาที, zero focus/blur, blank Enter, ช่วง9นาทีผิดขอบเขต, timerด้วยเวลาจำลอง, offline/reconnect, APIอนุญาตsuperadminและปฏิเสธadmin |
| C4 | npm run verify exit0: isolated933ผ่าน/2existing skips พร้อมlint/typecheck/source-size/auth-outage/build/SW/bundle; first load291.7kB/320kB |
| C5 | Production PWA3/3ผ่านเพิ่มเติม: adminไม่เห็นปุ่ม, mobile360pxไม่overflow, ฟอร์มบิลยางคงค่าตอนreconnect, offlineF5พร้อม100%; ภาพตรวจจริง output/cache-settings-mobile.png |

ข้อที่แก้ระหว่างตรวจ: disabled display query ต้องมี skipToken แทนปล่อย queryFn ว่าง, revisionจากGETช้าต้องไม่ทับค่าหลังPUT, ช่องว่างแล้วEnterต้องไม่ส่งค่าตัวเลขเก่า การทดสอบdevต้องโหลดlazy rubber moduleออนไลน์ก่อนจำลองoffline มิฉะนั้น chunkโหลดไม่สำเร็จทำให้หน้าunmount ไม่ใช่ความผิดของmetadata timer

Scrutinize: ทางเลือกที่เล็กกว่าคืออ่านค่ากลางในmetadata requestเดิมและใช้coordinator/form guardเดิม (ไม่เพิ่มservice/cron/config poll) ไล่ปุ่ม→NumberField→PUT→requireRole→RPC lock/role/session/constraint→query settings→timer→metadata→form wait/transaction แล้ว ตรวจสิทธิ์จริงกับกรณีผิดขอบเขตและrollbackเรียบร้อย ไม่พบblockerในขอบเขตนี้ Verdict: พร้อมตรวจรับ local, productionยังต้องapply migrationและdeployแยก ปิดรอบด้วยnullได้โดยคงIndexedDB opener8 และstoreเดิม

## Scrutinize หลังส่งมอบค่ากลาง

ตรวจและแก้5กรณีที่reproduceก่อนแก้: shared income queryข้ามformguard, metadataถูกเขียนรุ่นย้อนหลังจากแท็บช้า, pendingcountหายหลังเปลี่ยนสาขา, malformedJSONตอบ503แทน400 และexpectedRevisionเกินPostgreSQLintegerผ่านไปถึงRPC ไม่พบdeadcodeในขอบเขต รายละเอียดพร้อมledgerใน[ผลรีวิว](business-cache-scrutinize-review.md)

หลังแก้ครบ npmverify937ผ่าน/2existing skips พร้อมbuild/SW/bundle; feature26กรณีรวมอยู่แล้ว; PWA3/3ผ่าน; strictunusedและdiffcheckผ่าน ไม่มีschemachangeหรือdeploy รอบbrowserที่เริ่มจากbuildต่างenvและfixtureJWTหมดอายุไม่นับเป็นผลfeature; ใช้PWAconfigเดิมและsign-inเฉพาะtestaccountsใหม่โดยไม่เปลี่ยนpassword/profile/envหรือresetDB

## ตรวจซ้ำ error path หลัง Scrutinize

Reproduceและแก้เพิ่ม2จุด: guardedRPCคืน42501แต่Routeตอบ503 เปลี่ยนเป็น403ในmetadata/batch/settings GET; publish failedทำlast-success timestampหาย เปลี่ยนให้รักษาtimestampเฉพาะscopeเดิม กรณีnetworkจริงยัง503 ไม่ลบmetadataถาวรหรือเปลี่ยนAuth/RLS Feature28ผ่าน; strictunusedและverify939/2existing skips/build/SW/bundleผ่าน ไม่มีschema/deploy ดูledgerรอบR4/R5/G2ใน docs/business-cache-scrutinize-review.md

## ตรวจลำดับผลบันทึกค่ากลาง

แก้raceเพิ่ม1จุด: ผลPUTที่ตอบช้าเคยทับค่ารอบตรวจrevisionใหม่ในQueryClientของเครื่อง เพิ่มrevisionguardแบบGET/metadataเดิมก่อนonClose ฐานข้อมูลและRouteไม่เปลี่ยน มีregressionnormal1→2และmetadata3มาก่อนresponse2ที่แดงก่อนแก้และเขียวหลังแก้ พร้อมตรวจcancel/closeของrealformwaiterว่าobserverถูกถอด ไม่พบbugเพิ่มในwaiter Feature30/strictunused/verify941/2existing skips/build/SW/bundle/diffcheckผ่าน ดูledgerR6/G3/T1/T2ใน docs/business-cache-scrutinize-review.md ไม่มีAPI/schema/deploy

## ตรวจจำนวนงานค้างหลังออกจากโมดูล

แก้1จุด: backgroundsyncเคยinvalidateinactivequeryโดยไม่fetchต่อ ทำให้จำนวนงานค้างบนสถานะไม่ลด ทดลองฟังinvalidationอย่างเดียวแล้วหลายงานต่อกันยังค้าง เพราะquery-coreไม่แจ้งinvalidateซ้ำเมื่อisInvalidated=true จึงคงQueryObserverของrubberBillLocalState/incomeExpensePendingเดิมในกรอบสถานะและนับจากresult ไม่เพิ่มpolling/HTTP ปิดfocus/reconnectrefetchและถอดobserverเมื่อออกscope ลำดับ2→1→0ผ่านทั้ง2entities โดยforeignbranchไม่เพิ่มreadsและแต่ละinvalidationอ่านเพียงคิวที่เปลี่ยน ไม่มีobserverค้างหลังcleanup Feature31/strictunused/verify942/2existing skips/build/SW/bundle/PWA3/diffcheckผ่าน ไม่มีAPI/schema/deploy ดูledgerB2/G4/U4/B3/G5ใน docs/business-cache-scrutinize-review.md

## Cloud migration release — 2026-10-30

ผู้ใช้สั่ง push main และ supabase db push หากมี migrationใหม่ ยืนยันlinkedproject `psxwhhwjmolqperxrlzj` ตรงproduction backendก่อน mutation main/origin mainเริ่มต้นตรงกัน

- dry-runระบุเฉพาะ `20261030030000_business_cache_receipts.sql` และ `20261030040000_business_cache_settings.sql`; สำรองpublicschemaก่อนติดตั้งไว้ภายนอกrepo ไม่มีข้อมูลแถว/backupเข้าGit
- focusedSQLสองไฟล์28ข้อผ่านก่อนติดตั้ง; supabase db push --linked --yes exit0 และhistoryหลังติดตั้งตรงกันทั้ง372migration
- Cloudcatalogยืนยันsingleton1row, interval=null/revision1, RLSเปิด, constraints5ข้อ, authenticatedไม่มีdirecttableDML/SELECT, RPC3ตัวSECURITYDEFINER ownerpostgres search_pathว่าง authenticatedEXECUTE/anonไม่ให้EXECUTE ทั้งหมดผ่าน
- aggregatecountsของAuth/profiles/locations/rubber/incomeก่อนและหลังเท่ากัน ไม่แก้ข้อมูลเดิม
- PostgRESTreadRPCจริงทั้งสองตัวตอบ401/code42501ต่อanonymous แสดงว่าระบบเห็นRPCและบังคับสิทธิ์แล้ว ยังไม่อ้างCloudUIของappversionใหม่ก่อนdeployment
- CLIเตือนoptionalpg-deltacatalogcacheเพราะไฟล์certificateในtempcontainerหายหลังรายงานpushสำเร็จ ไม่retrymigration/reset/ปิดSSL ตรวจauthoritativehistory/livecatalog/PostgRESTซ้ำแล้วผ่าน จึงไม่ถือwarningนี้เป็นmigrationfailure

Release logs: output-cache-release-dry-run.log, db-push.log, migrations-after.log, cloud-before.log, cloud-after.log, rpc-smoke.log (ใช้prefix output-cache-release-) ผลappdeploymentแยกจากschema release และGitpush

## CI fresh-seed follow-up

หลังpushfeaturecommit a24af6f: Vercelและweb-gateผ่าน แต่database-gateล้มที่business_cache_settings_testเพราะsingletonหาย ไม่ใช่Cloudmigrationล้ม Seedเริ่มTRUNCATEprofilesCASCADE ซึ่งล้างbusiness_cache_settingsผ่านFKupdated_byแม้ค่าจะเป็นnull จึงต้องคืนsingletonเหมือนsettingsอื่นในseed

เพิ่มINSERTid=true ONCONFLICTDONOTHINGในsupabase/seed.sqlหลังคืนrubberapprovalsettings พิสูจน์กับTRUNCATEprofilesCASCADEและblockที่ดึงจากseedจริงในlocaltransactionซึ่งROLLBACKทุกอย่าง:2assertionsผ่าน แล้วfullSQL70ไฟล์/1,619ข้อผ่าน ไม่รันseed/resetกับฐานข้อมูลผู้ใช้หรือCloud ไม่เพิ่ม/แก้migrationที่applyไปแล้ว แพตช์นี้เปลี่ยนเฉพาะbootstrapseedและเอกสาร

Ledger: CIlogมีgetsettings=NULLและSELECTINTOSTRICTno-row; Cloudcatalog/localfocusedtestมีsingletonครบช่วยหักล้างว่าRPCผิดโดยตัวมันเอง การลองส่งSQLหลายstatementผ่านCLI dbqueryถูกปฏิเสธตั้งแต่prepare จึงเปลี่ยนใช้pgTAPrunnerเพื่อทำtransactionrollbackตามปกติ ไม่มีpartialTRUNCATEจากรอบที่prepareไม่ผ่าน Logs output-cache-release-ci-db-job.log, seed-rollback.log, db-final.log (prefix output-cache-release-)
