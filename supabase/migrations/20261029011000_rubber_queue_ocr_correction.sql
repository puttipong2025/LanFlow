do $$ declare body text; begin
  body:=pg_get_functiondef('private.process_rubber_queue_batch(integer,uuid)'::regprocedure);
  body:=replace(body,'elsif j.action in (''update'',''delete'') and coalesce(r->>''errorMessage'',message) in (',
    'elsif j.action=''create'' and coalesce(r->>''errorMessage'',message) in (
      ''ข้อมูลอ้างอิงรูป OCR ไม่ตรงกับคำขอ'',''ข้อมูลอ้างอิงรูป OCR ไม่ถูกต้อง'',
      ''รูป OCR นี้ถูกยกเลิกแล้ว'',''รูป OCR นี้ถูกจองโดยคำขออื่น'',''บิลยางที่เพิ่มเองห้ามใช้รูป OCR'',
      ''วิธีเพิ่มบิลยางไม่ถูกต้อง'',''ไม่รับข้อมูลอ้างอิง OCR ภายในจากอุปกรณ์'') then
      next_state:=''correction_required''; code:=''CORRECTION_REQUIRED'';
    elsif j.action in (''update'',''delete'') and coalesce(r->>''errorMessage'',message) in (');
  execute body;
end $$;
