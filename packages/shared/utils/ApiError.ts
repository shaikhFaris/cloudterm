export class ApiError extends Error {
  status: number;
  debugMsg: string;
  constructor(status: number, message: string, debugMsg?: string) {
    super(message);

    this.status = status;
    this.debugMsg = debugMsg ?? "No debug msg";
    this.name = "ApiError";

    Error.captureStackTrace(this, this.constructor);
  }
}
