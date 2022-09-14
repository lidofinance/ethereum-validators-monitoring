export const errRequest = (errBody: string, endpoint: string, apiUrl: string): string =>
  `ErrorBody: ${errBody} | Endpoint: ${endpoint} | Target: ${new URL(apiUrl).hostname}`;

export const errCommon = (errMessage: string, endpoint: string, apiUrl: string): string =>
  `ErrorMessage: ${errMessage} | Endpoint: ${endpoint} | Target: ${new URL(apiUrl).hostname}`;

export class ResponseError extends Error {
  protected $service: string;
  protected $httpCode: number;

  public constructor(innerError: string, httpCode = 0) {
    super(innerError);
    Error.captureStackTrace(this, ResponseError);

    this.name = this.constructor.name;
    this.$service = 'ResponseError';
    this.$httpCode = httpCode;
  }
}
