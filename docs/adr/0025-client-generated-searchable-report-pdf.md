# Generate searchable business PDFs in the browser

Status: Accepted

LanFlow generates Report Batch and Rubber Export PDFs in the browser from their existing detail API responses. Each feature keeps its own presentation model and columns while sharing only the A4 landscape constants, local Noto Sans Thai font loading, PDF `ActualText`, page/table lifecycle, footer, and in-memory file creation. `ActualText` preserves the logical Thai text used by search, selection, copy, and assistive technology even when glyph shaping uses a different visual order.

The generated PDF exists only as an in-memory `Blob` and `File`. When the browser supports file sharing, LanFlow calls Web Share with the PDF file and a human-readable title. Otherwise it creates a temporary object URL, downloads the same file, reports the fallback to the user, and revokes the URL. The application does not upload, persist, or add a database record for the generated file.

The layout uses manual row measurement so a row is never split across pages, repeats table headers after page breaks, and adds the document number plus `หน้า X/Y` to every page. Report Batch always shows both rubber-bill groups, with records assigned from the current customer class and unknown customers placed in the farmer group. Deleted Report Batch and Rubber Export documents remain shareable as historical copies marked `ลบแล้ว (สำเนา)`; a deleted Rubber Export also carries its previous status, deletion audit, and a low-contrast watermark.

Server-side Chromium rendering was rejected because it adds infrastructure and stored-artifact concerns without improving this workflow. Raster or canvas PDFs were rejected because their content cannot be reliably searched or copied. Rubber Export's former `/rubber-exports/[exportId]/print` route was removed; its table and detail modal now fetch fresh detail data and share the PDF directly. The separate legacy Report Batch print route remains for internal compatibility.
