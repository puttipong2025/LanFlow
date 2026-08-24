let cachedAccessToken = "";
let tokenExpirationTime = 0;

async function getAccessToken(): Promise<string> {
  // Return cached token if valid for at least another 5 minutes
  if (cachedAccessToken && Date.now() < tokenExpirationTime - 300000) {
    return cachedAccessToken;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Drive OAuth not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env.local"
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to refresh Google access token: ${errorText}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token;
  tokenExpirationTime = Date.now() + data.expires_in * 1000;

  return cachedAccessToken;
}

export async function uploadImageToDrive(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ fileId: string; webViewLink: string }> {
  const token = await getAccessToken();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!folderId) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is missing in .env.local");
  }

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = {
    name: fileName,
    parents: [folderId],
  };

  const multipartBody = Buffer.concat([
    Buffer.from(delimiter + "Content-Type: application/json\r\n\r\n" + JSON.stringify(metadata) + "\r\n"),
    Buffer.from(delimiter + `Content-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(closeDelimiter),
  ]);

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": multipartBody.length.toString(),
      },
      body: multipartBody,
    }
  );

  if (!uploadRes.ok) {
    throw new Error(`Drive upload failed: ${await uploadRes.text()}`);
  }

  const uploadData = await uploadRes.json();
  const fileId = uploadData.id;
  const webViewLink =
    uploadData.webViewLink ||
    `https://drive.google.com/file/d/${fileId}/view`;

  // Make the file viewable by anyone with the link
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });

  return { fileId, webViewLink };
}

export async function uploadPrivateImageToDrive(
  fileBuffer: Buffer,
  mimeType: "image/jpeg" | "image/png",
  fileName: string,
): Promise<{ fileId: string }> {
  const token = await getAccessToken();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("GOOGLE_DRIVE_FOLDER_ID is missing in .env.local");

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const metadata = { name: fileName, parents: [folderId] };
  const multipartBody = Buffer.concat([
    Buffer.from(`${delimiter}Content-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`${delimiter}Content-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(closeDelimiter),
  ]);
  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": multipartBody.length.toString(),
      },
      body: multipartBody,
    },
  );
  if (!uploadRes.ok) throw new Error("Drive private upload failed");
  const uploadData = await uploadRes.json() as { id?: string };
  if (!uploadData.id) throw new Error("Drive private upload returned no file id");
  return { fileId: uploadData.id };
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function ensureAnyoneCanView(token: string, fileId: string) {
  const permissionRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    },
  );
  if (!permissionRes.ok) throw new Error("Drive permission update failed");
}

export async function uploadEvidenceImageToDrive(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
  evidenceKey: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const token = await getAccessToken();
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("GOOGLE_DRIVE_FOLDER_ID is missing in .env.local");

  const query = [
    `'${escapeDriveQueryValue(folderId)}' in parents`,
    "trashed = false",
    `appProperties has { key='evidenceKey' and value='${escapeDriveQueryValue(evidenceKey)}' }`,
  ].join(" and ");
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,webViewLink)&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!searchRes.ok) throw new Error("Drive evidence lookup failed");
  const searchData = await searchRes.json() as {
    files?: Array<{ id?: string; webViewLink?: string }>;
  };
  const existing = searchData.files?.[0];
  if (existing?.id) {
    await ensureAnyoneCanView(token, existing.id);
    return {
      fileId: existing.id,
      webViewLink: existing.webViewLink ?? `https://drive.google.com/file/d/${existing.id}/view`,
    };
  }

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const metadata = {
    name: fileName,
    parents: [folderId],
    appProperties: { evidenceKey },
  };
  const multipartBody = Buffer.concat([
    Buffer.from(`${delimiter}Content-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`${delimiter}Content-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(closeDelimiter),
  ]);
  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": multipartBody.length.toString(),
      },
      body: multipartBody,
    },
  );
  if (!uploadRes.ok) throw new Error("Drive evidence upload failed");
  const uploadData = await uploadRes.json() as { id?: string; webViewLink?: string };
  if (!uploadData.id) throw new Error("Drive evidence upload returned no file id");
  await ensureAnyoneCanView(token, uploadData.id);
  return {
    fileId: uploadData.id,
    webViewLink: uploadData.webViewLink ?? `https://drive.google.com/file/d/${uploadData.id}/view`,
  };
}

export async function downloadEvidenceImageFromDrive(
  fileId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const token = await getAccessToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` }, signal },
  );
  if (!response.ok || !response.body) throw new Error("Drive evidence download failed");
  return response;
}

export async function downloadPrivateImageFromDrive(fileId: string, signal?: AbortSignal) {
  return downloadEvidenceImageFromDrive(fileId, signal);
}

export async function deleteImageFromDrive(fileId: string): Promise<void> {
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok) {
      console.error(`Failed to delete file from Drive. Status: ${res.status}`);
    }
  } catch (error) {
    console.error("Drive delete error:", error);
  }
}
