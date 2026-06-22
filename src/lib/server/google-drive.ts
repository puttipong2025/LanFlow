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
