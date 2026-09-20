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
