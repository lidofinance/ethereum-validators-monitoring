export type Key = {
  id: number;
  key: string;
  depositSignature: string;
  used: boolean;
};

export type KeyWithOperatorInfo = Key & {
  nos_id: number;
  nos_name: string;
};
