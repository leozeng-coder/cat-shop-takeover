export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
let access = "";
export function setAccess(value: string) {
  access = value;
}
export async function api<T>(action: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/admin/" + action, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Bearer " + access,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(result.error ?? "操作失败，请重试", response.status);
  return result as T;
}
export async function uploadAudio<T>(
  parameters: Record<string, string>,
  file: File,
): Promise<T> {
  const response = await fetch(
    "/api/admin/audio-upload?" + new URLSearchParams(parameters),
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + access,
        "Content-Type": "application/octet-stream",
      },
      body: file,
      signal: AbortSignal.timeout(60000),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(result.error ?? "上传失败", response.status);
  return result as T;
}
export async function audioPreview(file: string): Promise<Blob> {
  const response = await fetch(
    "/api/admin/audio-preview?" + new URLSearchParams({ file }),
    {
      headers: { Authorization: "Bearer " + access },
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!response.ok) throw new ApiError("音频读取失败", response.status);
  return response.blob();
}
