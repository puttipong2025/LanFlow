# Generate searchable report PDFs in the browser

Status: Accepted

LanFlow generates report PDFs in the browser from the existing report-detail API response. The report list fetches one report snapshot, maps it through the shared report presentation model, and renders an A4 landscape document with PDFKit. The renderer embeds local Noto Sans Thai font files and wraps visible strings with PDF `ActualText`, preserving the logical Thai text used by search, selection, copy, and assistive technology even when glyph shaping uses a different visual order.

The generated PDF exists only as an in-memory `Blob` and `File`. When the browser supports file sharing, LanFlow calls Web Share with the PDF file and a human-readable title. Otherwise it creates a temporary object URL, downloads the same file, reports the fallback to the user, and revokes the URL. The application does not upload, persist, or add a database record for the generated file.

The layout uses manual row measurement so a row is never split across pages, repeats table headers after page breaks, and adds the report number plus `หน้า X/Y` to every page. Both rubber-bill groups are always present, with records assigned from the current customer class and unknown customers placed in the farmer group. Deleted reports remain shareable as historical copies marked `ลบแล้ว (สำเนา)`.

Server-side Chromium rendering was rejected because it adds infrastructure and stored-artifact concerns without improving this workflow. Raster or canvas PDFs were rejected because their content cannot be reliably searched or copied. The legacy print route remains available for internal compatibility but is no longer the report-list action.
