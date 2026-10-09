import { z } from "zod";
import { apiErrorSchema } from "@benana/contracts";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(value);
    throw new ApiFailure(
      response.status,
      parsed.success ? parsed.data.error.message : "The request failed.",
      parsed.success ? parsed.data.error.code : "REQUEST_FAILED",
      parsed.success ? parsed.data.error.retryable : response.status >= 500,
    );
  }
  return schema.parse(value);
}
