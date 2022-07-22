import { JsonRpcBatchProvider } from '@ethersproject/providers';
import { StethAbi, StethAbi__factory } from './generated';
import { stEthAddresses } from './execution.constants';
import { BigNumber } from 'ethers';
import { Inject, Injectable, LoggerService, OnModuleInit } from '@nestjs/common';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { ConfigService } from '../../common/config';
import { PrometheusService } from '../../common/prometheus';
import { rejectDelay } from '../../common/functions/rejectDelay';

@Injectable()
export class StethContractService implements OnModuleInit {
  protected rpcUrls: string[];
  protected contractRPCs!: StethAbi[];
  protected activeContractRPC = 0;

  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
  ) {
    this.rpcUrls = [this.config.get('ETH1_RPC_URL'), this.config.get('ETH1_RPC_URL_BACKUP') || ''].filter(
      (val) => val && val.toString().length > 0,
    );
  }

  public async onModuleInit(): Promise<void> {
    const ethNetwork = this.config.get('ETH_NETWORK');
    this.logger.log(`Initializing StethAbi for network [${ethNetwork}]`);

    this.contractRPCs = this.rpcUrls.map((url) =>
      StethAbi__factory.connect(stEthAddresses[ethNetwork], new JsonRpcBatchProvider(url, ethNetwork)),
    );
  }

  public async getBufferedEther(): Promise<BigNumber> {
    return this.trackableBufferedEther()
      .catch(rejectDelay(this.config.get('ETH1_RPC_RETRY_DELAY_MS')))
      .catch(() => this.trackableBufferedEther())
      .catch((e) => {
        this.logger.error('Error while doing ETH1 RPC request. Will try to switch to another RPC');
        this.logger.error(e);
        this.switchToNextContractRPC();
        throw e;
      })
      .catch(() => this.trackableBufferedEther());
  }

  protected get contractRPC(): StethAbi {
    // sanity check
    if (this.activeContractRPC > this.contractRPCs.length - 1) {
      this.activeContractRPC = 0;
    }

    return this.contractRPCs[this.activeContractRPC];
  }

  protected switchToNextContractRPC() {
    if (this.contractRPCs.length === 1) {
      this.logger.log('Will not switch to next RPC url for ETH1. No backup RPC provided.');
      return;
    }
    this.activeContractRPC++;
    this.logger.log('Switched to next RPC url for ETH1');
  }

  protected trackableBufferedEther() {
    return this.prometheus.trackELRequest(this.rpcUrls[this.activeContractRPC], 'getBufferedEther', () =>
      this.contractRPC.getBufferedEther(),
    );
  }
}
