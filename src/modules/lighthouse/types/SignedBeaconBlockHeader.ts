import { BeaconBlockHeader } from './BeaconBlockHeader';
import { BLSSignature }      from './BLSSignature';

export interface SignedBeaconBlockHeader {
  message: BeaconBlockHeader;
  signature: BLSSignature;
}
