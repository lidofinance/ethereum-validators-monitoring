export interface ShortBeaconBlockInfo {
  message: {
    slot: string;
    proposer_index: string;
    body: {
      attestations: BeaconBlockAttestation[];
      sync_aggregate: {
        sync_committee_bits: string;
      };
    };
  };
}

export interface BeaconBlockAttestation {
  aggregation_bits: string;
  data: {
    slot: string;
    index: string;
  };
}
