import { PrometheusService, RequestStatus, RpcLayer } from 'common/prometheus';

/** Read-only on the connection: ethers freezes it, so a header set here throws on every call. */
export function createExecutionFetchMiddleware(prometheusService: PrometheusService) {
  return async (next: () => Promise<any>, ctx: any) => {
    const url = ctx.provider.connection.url;
    const targetName = new URL(url).hostname;
    const reqName = 'batch';
    const started = Date.now();
    const stop = prometheusService.outgoingELRequestsDuration.startTimer({ name: reqName, target: targetName });
    // No method label: the middleware is handed the fetch, not the JSON-RPC payload, so
    // rpc_request_total would have nothing to name.
    const observeRpc = (responseCode?: number) =>
      prometheusService.observeRpcRequest({
        layer: RpcLayer.EL,
        url,
        batched: true,
        durationSeconds: (Date.now() - started) / 1000,
        responseCode,
      });

    return await next()
      .then((r: any) => {
        prometheusService.outgoingELRequestsCount.inc({ name: reqName, target: targetName, status: RequestStatus.COMPLETE });
        observeRpc(200);
        return r;
      })
      .catch((e: any) => {
        prometheusService.outgoingELRequestsCount.inc({ name: reqName, target: targetName, status: RequestStatus.ERROR });
        // ethers reports a server error with the status on the error; a transport failure has none,
        // and an empty response_code is what the policy asks for then.
        observeRpc(e?.status ?? e?.statusCode);
        throw e;
      })
      .finally(() => stop());
  };
}
