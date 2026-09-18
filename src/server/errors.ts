export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HttpError";
  }
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
