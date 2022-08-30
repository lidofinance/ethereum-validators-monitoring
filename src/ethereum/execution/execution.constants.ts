export enum Network {
  Mainnet = 1,
  Rinkeby = 4,
  Ropsten = 3,
  Görli = 5,
  Kintsugi = 1337702,
}

export const NodeOpsAddresses = {
  [Network.Mainnet]: '0x55032650b14df07b85bF18A3a3eC8E0Af2e028d5',
  [Network.Görli]: '0x9D4AF1Ee19Dad8857db3a45B0374c81c8A1C6320',
  [Network.Ropsten]: '0x32c6f34F3920E8c0074241619c02be2fB722a68d',
  [Network.Rinkeby]: '',
  [Network.Kintsugi]: '0xeb7D01f713F59EFfB350D05b7AF66720373D4F41',
};

export const stEthAddresses = {
  [Network.Mainnet]: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
  [Network.Görli]: '0x1643E812aE58766192Cf7D2Cf9567dF2C37e9B7F',
  [Network.Ropsten]: '0xd40EefCFaB888C9159a61221def03bF77773FC19',
  [Network.Rinkeby]: '',
  [Network.Kintsugi]: '0x3a6a994AC0CC96b6DDbaA99F10769384Fa14227B',
};
