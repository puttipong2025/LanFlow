# Scrutinize — แคชธุรกิจและรอบตรวจค่ากลาง 2026-10-30

## ขอบเขตและทางเลือกที่เล็กกว่า

ตรวจงานที่เพิ่งเพิ่ม: UI ตั้งค่า/สถานะ → useBusinessCacheStatus → timer/refresh → API metadata/batch/settings → guarded RPC → IndexedDB transaction และเส้นทางร่วมกับ useIncomeExpenseOperationalList/useRubberBillList รวม route wrappers ของรับ–จ่ายที่เปลี่ยนในงานเดียวกัน ไม่อ้างว่า audit ทุกโมดูลของ repository

คง coordinator, query keys, form guard และ persistence เดิม เพิ่มเงื่อนไขที่จุด commit และแก้ error classification พอ ไม่ต้องสร้าง lock service, cache framework หรือ route layer ใหม่

## การทำซ้ำก่อนแก้

มี artifact รันได้ใน tests/business-cache.spec.ts, tests/business-cache-refresh.spec.ts และ tests/business-cache-settings.spec.ts ใช้ fake-indexeddb จริงและ QueryClient จริงสำหรับกรณีคำขอร่วม VM harness ใช้จำลองเฉพาะขอบเขต storage/network/React lifecycle ไม่มี interactive debugger ที่เชื่อมกับ VM harness ในรอบนี้ จึงไล่ source ของ production รวม node_modules/@tanstack/query-core/src/query.ts ที่คืน promise เดิมก่อนนำ queryFn ใหม่มาใช้

สมมติฐานเรียงตามผลกระทบที่ทดสอบ:

1. คำขอรับ–จ่ายที่กำลังโหลดร่วมกันข้าม queryFn ของ maintenance จึงข้าม form guard ภายในนั้น
2. metadata อ่านนอก transaction แล้วไม่มี guard ตอนเขียน ทำให้แท็บที่ช้ากว่าเขียนรุ่นย้อนหลัง
3. งานอ่านคิวเสร็จก่อน metadata หลังเปลี่ยนสาขา แต่ยังผูก state กับ scope เก่า ทำให้ readLocal รีเซ็ตจำนวน
4. JSON parse error ตกลง outer catch ของ Route ทำให้ข้อมูลผิดจาก client ถูกตอบว่า server unavailable
5. expectedRevision ของ settings ใช้ safe integer ของ JavaScript ซึ่งกว้างกว่า integer ของ PostgreSQL จึงปล่อยค่าที่ฐานข้อมูลรับไม่ได้ไปถึง RPC

ตัวแปรทดลอง: in-flight/ไม่มี in-flight, formเปิดก่อน/ระหว่างคำขอ, metadataรุ่นสูงกว่า/เท่ากัน, ลำดับ queue/metadata resolution, JSONถูก/ผิดรูปแบบ แต่ละ regression เปลี่ยนแกนเดียวจากกรณีควบคุม

## Experiment ledger

| Run | สิ่งที่เปลี่ยน/ผล | สิ่งที่หักล้างหรือยืนยัน |
| --- | --- | --- |
| S0 | strict noUnusedLocals/noUnusedParameters ผ่าน; ตรวจ references ของทุก exported runtime symbol ใน feature พบผู้ใช้ production ทุกตัว | ไม่พบ dead function/import/variable ในขอบเขต ห้ามลบเพียงเพราะมีผู้ใช้หนึ่งจุด หรือเป็น Next route export |
| R1 | ก่อนแก้ ทดสอบ22กรณี:19ผ่าน/3ล้มเหลว: incomeแชร์คำขอเป็นcurrentแทนwaiting, metadataเก่าเขียนทับได้, JSONผิดตอบ503 | กรณีควบคุมรอฟอร์มปกติและ rollback ของ concurrent receipt ผ่าน จึงไม่ใช่ form guard หรือ transaction ทั้งชุดเสีย; ขาด guard ตรงเส้นทางเฉพาะ |
| R2 | สลับให้ queueอ่านเสร็จก่อน metadata เมื่อเปลี่ยนสาขา: pending2ถูกรีเซ็ตnull | ยืนยัน race ของscope ไม่ใช่จำนวนงานเป็นศูนย์หรือข้อมูลคิวหาย |
| G1 | หลังแก้4จุด feature26/26ผ่าน | regressionทุกกรณีแดงก่อนแก้และเขียวหลังแก้ โดยกรณีควบคุมเดิมยังผ่าน |
| R3 | ส่งexpectedRevision=2,147,483,648ในroute harnessก่อนเพิ่มขอบเขต: ผ่านไปถึงRPCและได้200จากstub แทนถูกปฏิเสธ400 | ล้มเหลวที่input validationก่อนDB ไม่ได้อ้างว่าDBจริงบันทึกค่านี้ได้ SQLประกาศargumentเป็นintegerจึงรับได้สูงสุด2,147,483,647 |
| I1 | ทดลองใช้buildของnpmverifyเพื่อเริ่มPWAโดยไม่buildใหม่: APIบัญชีlocalตอบ401 ก่อนถึงbusinesslogic | buildอ่าน.env.production.localต่างจากlocalfixtures และตรวจพบJWTfixtureหมดอายุแล้ว จึงยังไม่ชี้ว่าเกิดจากเหตุเดียว ไม่นับผลนี้เป็นfeature regression; จบรอบเดิมก่อนใช้PWAconfigที่buildด้วยnode --env-file=.env.local และsign-inบัญชีทดสอบใหม่ตามวิธีเก็บcookieเดิมโดยไม่เปลี่ยนpassword/profile/envหรือresetDB |

## สิ่งที่แก้

- `src/lib/business-cache/refresh.ts`: ตรวจฟอร์มอีกครั้งหลัง await fetchInfiniteQuery ก่อน commit income metadata เพื่อครอบคลุมคำขอร่วมซึ่งไม่ได้เรียก queryFn ของ maintenance ไม่มีการปิดฟอร์มหรือโหลดหน้าใหม่ การโหลดของ query ปกติยังเป็นเจ้าของข้อมูลหน้าจอตามเดิม
- `src/lib/business-cache/storage.ts`: อ่าน metadata ล่าสุดใน readwrite transaction เดียวกับ receipt/tombstone ถ้ารุ่นสูงกว่า incoming ให้ abort ทั้งชุด ป้องกัน downgrade จากอีกแท็บ พร้อม regression ตรวจว่าสำเนาไม่ถูกลบไปด้วย
- `src/hooks/useBusinessCacheStatus.ts`: ผูกผล readWork กับ owner/branch ปัจจุบันทันที รักษาจำนวนที่อ่านได้ไม่ว่า metadata จะเสร็จก่อนหรือหลัง; หากอ่านคิวล้มเหลวล้าง breakdownเก่าที่แสดงค้าง
- `src/app/api/lanflow/business-cache/route.ts`: parse JSON ผิดเป็น400/no-store ไม่ส่ง503และไม่ query database ส่วน unexpected auth/storage failuresยังเป็น503ตามเดิม
- `src/app/api/lanflow/business-cache/settings/route.ts`: ตรวจ expectedRevision ให้ตรง PostgreSQL integer โดยใช้ helper เดิม ปฏิเสธค่าที่ใหญ่เกินก่อนเรียก RPC แทนปล่อยให้เกิด upstream error

## หลักฐานตรวจรับ

- `npm run verify` exit0 หลังแก้ครบ5จุด: lint/typecheck/source-size/import-direction/auth-outage ผ่าน, isolated937ผ่าน/2existing skips, productionbuild/SW/bundleผ่าน (first load291.8kB/320kB)
- ชุดfeature26กรณีผ่านในfullverify รวมเงื่อนไขexpectedRevisionเกินPostgreSQLintegerที่เพิ่มในtestเดิม
- strict `noUnusedLocals/noUnusedParameters` ผ่าน; ทุกruntimeexportในfeatureมีproductioncaller; ไม่มีdeadcodeที่ต้องลบในขอบเขต
- PWAตามconfigโปรเจกต์3/3ผ่านบนlocalหลังแก้ ใช้บัญชีทดสอบsessionใหม่: สิทธิ์/invalidrevision400/formรอปิด/offlineF5/reconnect/หน้าจอแคบ ไม่มีการresetDBหรือแก้env
- Logs: output-cache-scan-red.log, output-cache-scan-counts-red.log, output-cache-scan-revision-red.log, output-cache-scan-green.log, output-cache-scan-verify-final.log, output-cache-scan-pwa-final.log
- `git diff --check` ผ่าน ไม่มีการเปลี่ยน schema/สิทธิ์ธุรกิจ ไม่มี commit/push/deploy

Verdict: พร้อมตรวจรับ local หลังแก้5จุด โดยเฉพาะการfence metadataในtransactionและguardหลังsharedquery ไม่อ้างว่าทุกโมดูลในrepositoryปราศจากบั๊ก

## ตรวจซ้ำ — error path หลังแก้รอบแรก

ขอบเขตเดิม เน้นการยกเลิก/การคืนค่าข้อผิดพลาดและสถานะ ไม่ทำ refactor หรือเพิ่ม layer ใหม่ ทางเลือกที่เล็กที่สุดคือรักษา typed error จาก RPC และเก็บ timestamp ที่รู้แล้วในเจ้าของสถานะเดิม

สมมติฐานที่ตรวจเรียงตามผลกระทบ:

1. สิทธิ์ที่เปลี่ยนระหว่าง requireAuth กับ guarded RPC ถูกแปลงจาก 42501 เป็น503เหมือน network error
2. การ publish failed ของ hook แทน CacheState ทั้งก้อนทำให้ last-success timestamp หาย
3. เวลาไม่แสดงอาจเกิดจาก metadata ถูกลบหรือ Intl formatter ซึ่งต้องหักล้างก่อนแก้ UI

| Run | การทดลองและผล | ข้อสรุป |
| --- | --- | --- |
| R4 | ก่อนแก้ ใช้08006เป็นcontrolได้503ถูกต้อง แต่42501ได้503แทน403ในmetadata/batch/settings GET; ไม่ส่งprivate diagnosticsออกclient | Routeสูญเสียความหมายของpermission denialหลังrequireAuth ต่างจากnetwork outageจริง ไม่ใช่การข้ามสิทธิ์อ่านข้อมูล |
| R5 | ส่งtimestampที่รู้แล้วจากlocal readและpublish checking แล้วให้metadata transportล้มเหลว: state.updatedAtเป็นundefined | หักล้างว่าข้อมูลถาวรถูกลบหรือformatterพัง เพราะทดสอบstateโดยไม่renderและคืนmetadataที่มีtimestampแน่นอน |
| G2 | หลังแก้feature28/28ผ่าน พร้อมstrictunusedผ่าน | เพิ่ม42501→403ในGETmetadata/GETsettings/POSTbatchและคงtimestampเดิมเฉพาะowner/branchเดียวกัน; unexpected failureยัง503; ไม่เปลี่ยนAuth/RLS |

Source trace: requireAuthอ่านprofile/scope/session → RPCตรวจlive business/SMS/locationอีกครั้ง (`20261030030000_business_cache_receipts.sql`, `20261030040000_business_cache_settings.sql`) → Routeเคยรวมerrorทุกcodeเป็น503 ขณะเดียวกัน hook→publish(failed)เคยแทนCacheStateซึ่งรวมupdatedAt การแก้ใช้conditionalbranch/fieldเดิมโดยไม่เพิ่มabstraction ไม่มีinteractive debuggerที่ผูกกับVMharness จึงตรวจstateและไล่sourceตรง ไม่ใส่debuglogในproduction

ผลตรวจรวมรอบตรวจซ้ำ: npm run verify exit0: lint/typecheck/source-size/import-direction/auth-outageผ่าน, isolated939ผ่าน/2existing skips, build/SW/bundleผ่าน (first load291.8kB/320kB); strictunusedผ่าน; diffcheckผ่าน Logs output-cache-rescan-red.log/green.log/unused.log/verify.log ไม่มีschemachange/deploy ไม่รันSQL/PWAซ้ำเพราะไม่ได้เปลี่ยนฐานข้อมูลหรือnormalbrowserflow การทดสอบerror pathใหม่นี้ใช้productionroute/hookผ่านขอบเขตRPC/Reactที่ควบคุมได้ ไม่อ้างผลPWAรอบก่อนเป็นหลักฐานerror pathใหม่

Verdict รอบตรวจซ้ำ: พร้อมตรวจรับ local หลังแก้2จุดเพิ่ม โดยรักษาpermission-error semanticsและlast-success timestamp ไม่พบdeadcodeเพิ่มเติมในขอบเขต

## ตรวจลำดับผลตอบกลับ — รอบบันทึกค่ากลาง

ขอบเขตเดิม เน้นปลายทางของresponseที่มาช้าและการยกเลิกงานรอฟอร์ม ทางเลือกที่เล็กกว่าคือใช้guardเทียบrevisionเดิมในPUT completionเหมือนGET/metadata ไม่เพิ่มhelperหรือระบบประสานแท็บ

สมมติฐานเรียงตามเส้นทางที่ตรวจ: (1) PUT completionเขียนquery cacheโดยไม่เทียบrevision (2) backendเขียนค่ากลางย้อนหลัง (3) timerแก้ค่ากลางเอง (4) การcancelรอฟอร์มทิ้งobserverค้าง ควบคุมเวลาตอบกลับและใช้QueryClientจริงเพื่อแยกแต่ละสาเหตุ ไม่มีinteractive debuggerเชื่อมVMจึงตรวจproductioncomponent handlerโดยแทนเฉพาะReact state/network/visual primitives

| Run | การทดลองและผล | ข้อสรุป |
| --- | --- | --- |
| R6 | ก่อนแก้ productionCacheSettingsModal handler: controlบันทึก1→2ผ่าน แต่ถ้าmetadata3เข้าQueryClientก่อนPUT2ตอบ ค่าจบที่2/10นาทีแทน3/120นาที | ทำซ้ำได้โดยไม่ใช้DBหรือtimer จึงหักล้างว่าต้องแก้backend/timer ต้นเหตุคือclient.setQueryDataหลังPUTที่ไม่เทียบrevision ต่างจากGET/metadata |
| G3 | หลังเพิ่มguardในPUT completion กรณีnormalและlate responseผ่านทั้งคู่ | คงค่ารุ่นใหม่ในเครื่อง ไม่ใช่การเปลี่ยนDBหรือปฏิเสธทุกผลบันทึก |
| T1 | real waitForBusinessForms: cancellationและcloseต้องdisconnectobserver; รอบแรกใช้rejects matcherข้ามVMrealmแล้วmatcherคืนPromiseผิดรูปแบบ | เป็นข้อจำกัดtest harnessไม่ใช่productionbug เปลี่ยนassertionเป็นอ่านผลrejectแล้วตรวจmessage ไม่มีการแก้forms.ts |
| T2 | หลังแก้assertion feature30/30ผ่าน รวมการยกเลิกรอฟอร์ม/close/ไม่มีform และstrictunusedผ่าน | ไม่พบobserverค้างจากเส้นทางที่ทดสอบ ไม่เพิ่มการแก้codeนอกbugที่ยืนยัน |

Source: `src/components/lanflow/BusinessCacheSettings.tsx` ในsave(form)หลังawait response.json/validation ก่อนonClose; ใช้revisionguardสองบรรทัดแบบเดียวกับจุดรับmetadataเดิม BackendexpectedRevision/rowlockยังคงเดิม การเปลี่ยนนี้ไม่ขยายสิทธิ์หรือแก้ค่ากลางบนserver

ผลตรวจรวมรอบผลตอบกลับ: npm run verify exit0: isolated941ผ่าน/2existing skips พร้อมlint/typecheck/source-size/import-direction/auth-outage/build/SW/bundle (first load291.8kB/320kB); feature30กรณีรวมอยู่แล้ว; strictunusedและdiffcheckผ่าน Logs output-cache-delayed-save-red.log/green-final.log/unused.log/verify.log ไม่มีAPI/schema/deploy ไม่รันPWA/SQLซ้ำเพราะไม่เปลี่ยนvisual/database/route contract โดยregressionของPUTcompletionทดสอบhandlerจริงกับQueryClientจริง

Verdict รอบผลตอบกลับ: พร้อมตรวจรับ local หลังกันผลบันทึกเก่าทับค่ารุ่นใหม่ในเครื่อง ไม่พบdeadcodeหรือปัญหาRouteเพิ่มเติมในขอบเขตที่ตรวจ

## ตรวจการซิงก์หลังออกจากโมดูล — จำนวนงานในเครื่อง

ขอบเขตเดิม เพิ่มtraceจากbackground syncไปยังสถานะจำนวนงาน ทดลองlistenerของinvalidationก่อน แต่เมื่อพิสูจน์ว่าแจ้งซ้ำไม่ได้จึงใช้QueryObserverกับlocalquerykeysเดิมให้กรอบสถานะติดตามคิวต่อแม้ปิดโมดูล ไม่เพิ่มpolling,networkrequest,eventbusหรือแก้ตัวซิงก์

สมมติฐานเรียงตามtrace: (1) hookฟังเฉพาะquery successจึงไม่ทราบเมื่อbackground invalidates inactive query (2) งานถูกลบจากคิวไม่สำเร็จ (3) scopeของeventไม่ตรงกัน ควบคุมคิวที่อ่านได้ให้เปลี่ยน1→0 ใช้QueryClientจริงที่มี0observersและforeignbranchเป็นcontrol

| Run | การทดลองและผล | ข้อสรุป |
| --- | --- | --- |
| B2 | ก่อนแก้invalidateคิวของbranchอื่นไม่เรียกreadWorkถูกต้อง แต่invalidatecurrent inactive queryหลังคิวเหลือ0ยังแสดงpending1 | ยืนยันว่าfilterเฉพาะsuccessทำให้ไม่มีreadWorkเมื่อqueryไม่มีobserver ไม่ใช่scopeผิดหรือคิวไม่เปลี่ยน |
| G4 | เพิ่มupdated/invalidateในlistenerเดิมสำหรับrubberBillLocalState/incomeExpensePending กรณีงานเดียวผ่าน feature31/31 แต่ยังไม่ตรวจหลายงานต่อกัน | เป็นผลระหว่างทาง ยังไม่ใช่การแก้ที่ครบเพราะB3หักล้าง |
| U4 | strictnoUnusedLocals/noUnusedParametersผ่าน | ไม่พบdeadcodeเพิ่มเติม ไม่มีการลบsymbolที่ยังมีproductioncaller |
| B3 | เพิ่มลำดับ2→1→0โดยไม่เปิดโมดูลกลับ: listenerชั่วคราวลดได้ครั้งแรก แต่ครั้งสองค้าง1 | Query.invalidate()ในquery-coreไม่dispatchเมื่อisInvalidated=trueอยู่แล้ว จึงหักล้างG4ว่าเพียงฟังeventจะครอบคลุมหลายงาน |
| G5 | ใช้QueryObserverของrubberBillLocalState/incomeExpensePendingเดิมให้activeที่กรอบสถานะ queryFnอ่านIndexedDBเท่านั้น แล้วลำดับ2→1→0ผ่านทั้ง2entities | refetchสำเร็จทำให้รับinvalidationครั้งต่อไปได้ อ่านเฉพาะคิวที่เปลี่ยนครั้งละ1ชุด ไม่มีHTTP/interval/focus/reconnect polling; unsubscribeเมื่อเปลี่ยนscope/ออกจากหน้า |

Source: `src/lib/rubber-bills/central-sync.ts` หลังreconcileเรียก `invalidateMoneyFlowLocation` → `src/lib/money-flow/invalidation.ts` invalidate rubberBillLocalState/incomeExpensePending; `src/lib/income-expense/background-sync.ts` invalidate incomeExpensePending หลังcomplete ทั้งคู่ไม่refetchinactivequeryโดยdefault → `src/hooks/useBusinessCacheStatus.ts` จึงคงobserverบนสองlocalqueryเดิมที่owner/branchปัจจุบัน แล้วderiveจำนวนจากresultที่มีแล้วแทนอ่านคิวทั้งสองซ้ำด้วยมือ ใช้shapeเดิม{events}/events[]และnetworkModealways ไม่มีrefetchInterval refetchOnFocus/Reconnectตั้งfalse เส้นทางreadWork→setStateไม่invalidatequeryกลับ จึงไม่เกิดloop

ผลตรวจรวมรอบจำนวนงานหลังแก้G5: npm run verify exit0: isolated942ผ่าน/2existing skips พร้อมlint/typecheck/source-size/import-direction/auth-outage/build/SW/bundle (first load291.9kB/320kB); feature31กรณีรวมอยู่แล้วและตรวจreadsเพิ่มครั้งละ1คิว+observerหลังcleanupเป็น0; strictunusedผ่าน; PWA3/3ผ่านหลังbuildlocalด้วยconfigโปรเจกต์และsign-inเฉพาะtestaccountsใหม่ ไม่เปลี่ยนpassword/profile/envหรือresetDB; diffcheckผ่าน Logs output-cache-background-count-repeat-red.log/repeat-green.log/repeat-unused.log/verify-final.log/pwa.log ไม่มีRoute/API/schema/deploy

Verdict รอบจำนวนงาน: พร้อมตรวจรับ local หลังคงobserverของlocalqueriesเดิมให้จำนวนอัปเดตครบเมื่อซิงก์หลายงานต่อกัน แม้ออกจากโมดูลแล้ว ไม่พบdeadcodeหรือปัญหาRouteเพิ่มเติมในขอบเขต
