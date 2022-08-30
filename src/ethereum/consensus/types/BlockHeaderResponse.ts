import { Root } from './Root';
import { SignedBeaconBlockHeader } from './SignedBeaconBlockHeader';

export interface BlockHeaderResponse {
  root: Root;
  canonical: boolean;
  header: SignedBeaconBlockHeader;
}
