export const errRequest = (errBody: string, endpoint: string, rpcUrl: string): string =>
  `ErrorBody: ${errBody} | Endpoint: ${endpoint} | Target: ${new URL(rpcUrl).hostname}`;

export const errCommon = (errMessage: string, endpoint: string, rpcUrl: string): string =>
  `ErrorMessage: ${errMessage} | Endpoint: ${endpoint} | Target: ${new URL(rpcUrl).hostname}`;

export class BeaconChainGeneralApiError extends Error {
  protected $service: string;
  protected $httpCode: number;

  public constructor(innerError: string, httpCode = 0) {
    super(innerError);
    Error.captureStackTrace(this, BeaconChainGeneralApiError);

    this.name = this.constructor.name;
    this.$service = 'BeaconChainGeneralApiError';
    this.$httpCode = httpCode;
  }
}
