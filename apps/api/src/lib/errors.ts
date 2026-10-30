export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502 | 503,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what, "not_found");
export const badRequest = (msg: string, code = "bad_request") => new HttpError(400, msg, code);
