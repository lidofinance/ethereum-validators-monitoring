import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { allSettled } from 'common/functions/allSettled';
import { gweiToEthBP } from 'common/functions/gweiToEth';
import { PrometheusService, TrackTask, setOtherOperatorsMetric, setUserOperatorsMetric } from 'common/prometheus';
import { Epoch } from 'common/types/types';
import { ClickhouseService } from 'storage';
import { RegistryService, RegistrySourceOperator } from 'validators-registry';

@Injectable()
export class ProposeMetrics {
  protected processedEpoch: number;
  protected operators: RegistrySourceOperator[];
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly registryService: RegistryService,
    protected readonly storage: ClickhouseService,
  ) {}

  @TrackTask('calc-propose-metrics')
  public async calculate(epoch: Epoch, possibleHighRewardValidators: string[]) {
    this.logger.log('Calculating proposal metrics');
    this.processedEpoch = epoch;
    this.operators = await this.registryService.getOperators();
    await allSettled([
      this.goodProposes(),
      this.missProposes(),
      this.emptyProposes(),
      this.chainSlots(),
      this.highRewardMissProposes(possibleHighRewardValidators),
    ]);
  }

  private async goodProposes() {
    const data = await this.storage.getValidatorsCountWithGoodProposes(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountGoodPropose, data, this.operators);
    setUserOperatorsMetric(this.prometheus.validatorsBalanceGoodPropose, data, this.operators, {}, (item) => gweiToEthBP(item.balance));
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountGoodPropose, data);
    setOtherOperatorsMetric(this.prometheus.otherValidatorsBalanceGoodPropose, data, {}, (item) => gweiToEthBP(item.balance));
  }

  private async missProposes() {
    const data = await this.storage.getValidatorsCountWithMissedProposes(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountMissPropose, data, this.operators);
    setUserOperatorsMetric(this.prometheus.validatorsBalanceMissPropose, data, this.operators, {}, (item) => gweiToEthBP(item.balance));
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountMissPropose, data);
    setOtherOperatorsMetric(this.prometheus.otherValidatorsBalanceMissPropose, data, {}, (item) => gweiToEthBP(item.balance));
  }

  /**
   * Proposals that made it into a block, but whose execution payload never was applied.
   *
   * Since Gloas (EIP-7732) the builder reveals the payload later in the slot, and the slot stays empty when it does
   * not come in time. Such a proposal counts as a good one: the proposer did its work, and the builder owes the value
   * of its bid whether it reveals the payload or not. What goes missing is the execution block, not the payment to
   * the operator. Before the fork these are always at 0.
   */
  private async emptyProposes() {
    const data = await this.storage.getValidatorsCountWithEmptyProposes(this.processedEpoch);
    setUserOperatorsMetric(this.prometheus.validatorsCountEmptyPropose, data, this.operators);
    setUserOperatorsMetric(this.prometheus.validatorsBalanceEmptyPropose, data, this.operators, {}, (item) => gweiToEthBP(item.balance));
    setOtherOperatorsMetric(this.prometheus.otherValidatorsCountEmptyPropose, data);
    setOtherOperatorsMetric(this.prometheus.otherValidatorsBalanceEmptyPropose, data, {}, (item) => gweiToEthBP(item.balance));
  }

  /**
   * How many slots of the epoch got a block, and how many of those stayed empty. The two together give the empty slot
   * rate of the chain.
   */
  private async chainSlots() {
    const { proposed, empty } = await this.storage.getChainProposedAndEmptySlots(this.processedEpoch);
    this.prometheus.chainProposedSlotsCount.set(proposed);
    this.prometheus.chainEmptySlotsCount.set(empty);
  }

  private async highRewardMissProposes(possibleHighRewardValidators: string[]) {
    if (possibleHighRewardValidators.length > 0) {
      const data = await this.storage.getValidatorsCountWithMissedProposes(this.processedEpoch, possibleHighRewardValidators);
      setUserOperatorsMetric(this.prometheus.highRewardValidatorsCountMissPropose, data, this.operators);
      setUserOperatorsMetric(this.prometheus.highRewardValidatorsBalanceMissPropose, data, this.operators, {}, (item) =>
        gweiToEthBP(item.balance),
      );
    }
  }
}
