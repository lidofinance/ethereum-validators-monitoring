import { Slot }           from './Slot';
import { ValidatorIndex } from './ValidatorIndex';
import { Root }           from './Root';

export interface BeaconBlockHeader {
  slot: Slot;
  proposer_index: ValidatorIndex;
  parent_root: Root;
  state_root: Root;
  body_root: Root;
}
