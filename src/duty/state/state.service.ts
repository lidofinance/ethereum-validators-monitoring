import { BigNumber } from '@ethersproject/bignumber';
import { LOGGER_PROVIDER } from '@lido-nestjs/logger';
import { Inject, Injectable, LoggerService } from '@nestjs/common';

import { ConfigService } from 'common/config';
import { ConsensusProviderService } from 'common/consensus-provider';
import { bigNumberSqrt } from 'common/functions/bigNumberSqrt';
import { unblock } from 'common/functions/unblock';
import { PrometheusService, TrackTask } from 'common/prometheus';
import { Epoch, Slot, ValStatus } from 'common/types/types';
import { SummaryService } from 'duty/summary';
import { ClickhouseService } from 'storage/clickhouse';
import { RegistryService } from 'validators-registry';

const FAR_FUTURE_EPOCH = Infinity;

/**
 * A validator as the state gives it back. `FAR_FUTURE_EPOCH` comes as `Infinity`, which is what `getValidatorStatus`
 * compares against.
 */
interface ValidatorValue {
  pubkey: Uint8Array;
  effectiveBalance: number;
  slashed: boolean;
  activationEligibilityEpoch: number;
  activationEpoch: number;
  exitEpoch: number;
  withdrawableEpoch: number;
}

/**
 * The reads the app makes on the state, and no more than that.
 *
 * Up to Fulu the state keeps its lists as plain ones, and since Gloas (EIP-7916) as progressive ones. The two are
 * different classes with different trees, so the type says what is asked of them rather than which class they are. Only
 * balances keep a `get`, because a list of numbers has no `getAllReadonlyValues`.
 */
interface StateView {
  validators: { getAllReadonlyValues(): ValidatorValue[] };
  balances: { get(index: number): number };
  pendingConsolidations?: { length: number; get(index: number): { sourceIndex: number; targetIndex: number } };
}

@Injectable()
export class StateService {
  public constructor(
    @Inject(LOGGER_PROVIDER) protected readonly logger: LoggerService,
    protected readonly config: ConfigService,
    protected readonly prometheus: PrometheusService,
    protected readonly clClient: ConsensusProviderService,
    protected readonly summary: SummaryService,
    protected readonly storage: ClickhouseService,
    protected readonly registry: RegistryService,
  ) {}

  @TrackTask('check-state-duties')
  public async check(epoch: Epoch, stateSlot: Slot): Promise<void> {
    const slotTime = await this.clClient.getSlotTime(epoch * this.config.get('FETCH_INTERVAL_SLOTS'));
    await this.registry.updateKeysRegistry(Number(slotTime));
    const stuckKeys = this.registry.getStuckKeys();
    this.logger.log('Getting all validators state');
    const stateView = (await this.clClient.getState(stateSlot)) as StateView;
    this.logger.log('Processing all validators state');
    let activeValidatorsCount = 0;
    let activeValidatorsEffectiveBalance = 0n;
    const balances = stateView.balances;
    // The values are the very objects the tree holds already, so this walks the tree without copying anything out of it
    const validators = stateView.validators.getAllReadonlyValues();

    for (let index = 0; index < validators.length; index++) {
      if (index % 100 === 0) {
        await unblock();
      }
      const validator = validators[index];
      const status = this.getValidatorStatus(validator, epoch);
      const pubkey = '0x'.concat(Buffer.from(validator.pubkey).toString('hex'));
      const operator = this.registry.getOperatorKey(pubkey);
      const v = {
        epoch,
        val_id: index,
        val_pubkey: pubkey,
        val_nos_module_id: operator?.moduleIndex,
        val_nos_id: operator?.operatorIndex,
        val_nos_name: operator?.operatorName,
        val_slashed: validator.slashed,
        val_status: status,
        val_balance: BigInt(balances.get(index)),
        val_effective_balance: BigInt(validator.effectiveBalance),
        val_stuck: stuckKeys.includes(pubkey),
      };
      this.summary.epoch(epoch).set(v);
      if (([ValStatus.ActiveOngoing, ValStatus.ActiveExiting, ValStatus.ActiveSlashed] as ValStatus[]).includes(status)) {
        activeValidatorsCount++;
        activeValidatorsEffectiveBalance += BigInt(validator.effectiveBalance) / BigInt(10 ** 9);
      }
    }

    const pendingConsolidations = stateView.pendingConsolidations;
    if (pendingConsolidations != null) {
      for (let index = 0; index < pendingConsolidations.length; index++) {
        if (index % 100 === 0) {
          await unblock();
        }

        const consolidation = pendingConsolidations.get(index);
        this.summary.epoch(epoch).addPendingConsolidation({
          source_index: consolidation.sourceIndex,
          target_index: consolidation.targetIndex,
        });
      }
    }

    const baseReward = Math.trunc(
      BigNumber.from(64 * 10 ** 9)
        .div(bigNumberSqrt(BigNumber.from(activeValidatorsEffectiveBalance).mul(10 ** 9)))
        .toNumber(),
    );
    this.summary.epoch(epoch).setMeta({
      state: {
        active_validators: activeValidatorsCount,
        active_validators_total_increments: activeValidatorsEffectiveBalance,
        base_reward: baseReward,
      },
    });
  }

  //https://github.com/ChainSafe/lodestar/blob/stable/packages/beacon-node/src/api/impl/beacon/state/utils.ts
  public getValidatorStatus(validator: ValidatorValue, currentEpoch: Epoch): ValStatus {
    // pending
    if (validator.activationEpoch > currentEpoch) {
      if (validator.activationEligibilityEpoch === FAR_FUTURE_EPOCH) {
        return ValStatus.PendingInitialized;
      } else if (validator.activationEligibilityEpoch < FAR_FUTURE_EPOCH) {
        return ValStatus.PendingQueued;
      }
    }
    // active
    if (validator.activationEpoch <= currentEpoch && currentEpoch < validator.exitEpoch) {
      if (validator.exitEpoch === FAR_FUTURE_EPOCH) {
        return ValStatus.ActiveOngoing;
      } else if (validator.exitEpoch < FAR_FUTURE_EPOCH) {
        return validator.slashed ? ValStatus.ActiveSlashed : ValStatus.ActiveExiting;
      }
    }
    // exited
    if (validator.exitEpoch <= currentEpoch && currentEpoch < validator.withdrawableEpoch) {
      return validator.slashed ? ValStatus.ExitedSlashed : ValStatus.ExitedUnslashed;
    }
    // withdrawal
    if (validator.withdrawableEpoch <= currentEpoch) {
      return validator.effectiveBalance !== 0 ? ValStatus.WithdrawalPossible : ValStatus.WithdrawalDone;
    }
    throw new Error('ValidatorStatus unknown');
  }
}
