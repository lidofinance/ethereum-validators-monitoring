# [4.7.0](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.6.0...4.7.0) (2024-08-12)


### Bug Fixes

* add ETH_NETWORK for tests ([5bfdc36](https://github.com/lidofinance/ethereum-validators-monitoring/commit/5bfdc3685c207ea08dd68d57ce20e996655df93f))
* add fork selector ([8cd5936](https://github.com/lidofinance/ethereum-validators-monitoring/commit/8cd593637d03949bcb5ecba87b5057e658fff113))
* add fork selector for testnets ([191b665](https://github.com/lidofinance/ethereum-validators-monitoring/commit/191b6655922b0b44a666960a6806f196a1f66240))
* add NODE_OPTIONS=--experimental-vm-modules for jest ([6058284](https://github.com/lidofinance/ethereum-validators-monitoring/commit/6058284d1db84589e1dbb78acebb8067e5b810a6))
* allowJs for jest ([ecd49cf](https://github.com/lidofinance/ethereum-validators-monitoring/commit/ecd49cfc8ff770fd33a2c3a4f953f5747bceab89))
* jest ([01d6ffe](https://github.com/lidofinance/ethereum-validators-monitoring/commit/01d6ffe96370d9b8f618cfdf8fd30334432205ef))
* jest ([e8b7442](https://github.com/lidofinance/ethereum-validators-monitoring/commit/e8b7442cfa53f34f451b90a7cd2cfbfa4b1e0487))
* jest config ([02f40c3](https://github.com/lidofinance/ethereum-validators-monitoring/commit/02f40c35d7ed1a29e9b385cd4c961b431c61b311))
* node version in workflow ([b22f982](https://github.com/lidofinance/ethereum-validators-monitoring/commit/b22f98220347c758614f3af8c13ce1ea89007f27))
* polyfills ([2829e19](https://github.com/lidofinance/ethereum-validators-monitoring/commit/2829e19b9ecac1dfebccec40240accd6560e9819))
* polyfills ([9f0f80f](https://github.com/lidofinance/ethereum-validators-monitoring/commit/9f0f80f2f1dae4f1df47c536f960b921e4890912))
* polyfills ([459527b](https://github.com/lidofinance/ethereum-validators-monitoring/commit/459527bb420e44278f6da6a5a4e673b802ce8020))
* remove condition for tests ([d8af449](https://github.com/lidofinance/ethereum-validators-monitoring/commit/d8af449c9e943a186a02e80e73ebbc35569fc058))
* remove extra `export` before NODE_OPTIONS ([db32eb7](https://github.com/lidofinance/ethereum-validators-monitoring/commit/db32eb7a7c476133dafc81bdf1747035fc2d5a99))
* return previous rule of missed proposes calculation ([9080501](https://github.com/lidofinance/ethereum-validators-monitoring/commit/90805015fd0aef7f9ee26d73450d4d9198f555eb))
* review ([d5fb98c](https://github.com/lidofinance/ethereum-validators-monitoring/commit/d5fb98cad0dbe1a18b20ba7086c45281eda998c7))
* tests ([2df4da0](https://github.com/lidofinance/ethereum-validators-monitoring/commit/2df4da0225b56f48986bf9b19737a313616203bc))
* value for Dencun ([79d9b8a](https://github.com/lidofinance/ethereum-validators-monitoring/commit/79d9b8a6ff6884f6f51bcd75b12249e9a58af030))


### Features

* add minimum bound to alerts threshold ([a5a0be7](https://github.com/lidofinance/ethereum-validators-monitoring/commit/a5a0be75bd4e6934e1001d71b580285ff7a74a59))
* honing consensus provider ([75b5f18](https://github.com/lidofinance/ethereum-validators-monitoring/commit/75b5f182f5c02e46d5c382f80a6eb2771ac7c488))
* honing state processing ([fe384cd](https://github.com/lidofinance/ethereum-validators-monitoring/commit/fe384cd90a05c689cd0c13a16d90e827f2a23af4))
* node 21.1 + undici + state from ssz ([6df86d3](https://github.com/lidofinance/ethereum-validators-monitoring/commit/6df86d31107437e21937b7aefd459136a8abe054))



# [4.6.0](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.5.1...4.6.0) (2024-03-12)


### Bug Fixes

* bug in Dencun epoch calculation ([c43a2aa](https://github.com/lidofinance/ethereum-validators-monitoring/commit/c43a2aa4e5b0b0d07f26d8250544b9ed55942caa))
* conditions ([eacccd9](https://github.com/lidofinance/ethereum-validators-monitoring/commit/eacccd9b05faa0e87f651988c93a78da29b4425a))
* incorrect links in dashboards ([aab53a1](https://github.com/lidofinance/ethereum-validators-monitoring/commit/aab53a1ff53f44c135593b2bf611f9d63b92a4c1))
* set correct Dencun Mainnet epoch ([3bd82b6](https://github.com/lidofinance/ethereum-validators-monitoring/commit/3bd82b6299097f829c542a3e59c82ab782ecf3e0))
* simplify `DENCUN_FORK_EPOCH` validation ([334eb16](https://github.com/lidofinance/ethereum-validators-monitoring/commit/334eb1663b4c2f822655e2a8ebcf0a4ac7374c6f))
* skip `DENCUN_FORK_EPOCH` validation ([689f4c4](https://github.com/lidofinance/ethereum-validators-monitoring/commit/689f4c4c6e55e8a515d5bfb35bdbca6207af89e1))
* switch to fallback if primary node is stuck ([afc1835](https://github.com/lidofinance/ethereum-validators-monitoring/commit/afc1835f6b6b03b8ea052455dc0eaadfc22e97da))


### Features

* new `DENCUN_FORK_EPOCH` env variable ([77952e2](https://github.com/lidofinance/ethereum-validators-monitoring/commit/77952e29d7f1bc0ad3362dc4002508983463e6f8))
* support for new attestation logic (Dencun) ([58558f8](https://github.com/lidofinance/ethereum-validators-monitoring/commit/58558f8f5760c4414268740a27546d98f65b0851))



## [4.5.1](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.5.0...4.5.1) (2024-01-11)


### Bug Fixes

* abs ([9b9bdad](https://github.com/lidofinance/ethereum-validators-monitoring/commit/9b9bdad5ffd3efb89ef9b24549f6f7a7c3dd2bd8))
* add all env variables to docker-compose ([8b1d097](https://github.com/lidofinance/ethereum-validators-monitoring/commit/8b1d097b437ef6281f2e6ca6576ae735c0317768))
* add default env values in docker-compose ([7228530](https://github.com/lidofinance/ethereum-validators-monitoring/commit/7228530cb765e0f183b42c4f88306b190e3329b9))
* color ([73dffeb](https://github.com/lidofinance/ethereum-validators-monitoring/commit/73dffeb4939cc879f1b41eaa334bc640697133ed))
* HTTP_PORT environment variable update to differentiate container and external app ports ([04cd7eb](https://github.com/lidofinance/ethereum-validators-monitoring/commit/04cd7ebd2af991c710f22fbd816358caa6f30b5b))
* incorrect calculation in "Earned" column ([58dd9be](https://github.com/lidofinance/ethereum-validators-monitoring/commit/58dd9be8fa5db1e4f1bb2a5a620c3b6a8d58fcc3))
* incorrect ports in `docker-compose` ([ed23a26](https://github.com/lidofinance/ethereum-validators-monitoring/commit/ed23a26ab2d58b721057650ec48f1adab49b061b)), closes [#202](https://github.com/lidofinance/ethereum-validators-monitoring/issues/202)
* metric_relabel_configs ([54129f6](https://github.com/lidofinance/ethereum-validators-monitoring/commit/54129f63c7f63c459ffaba8641176ffd93c6d35f))
* skip validation of `START_EPOCH` env variable ([a5c354e](https://github.com/lidofinance/ethereum-validators-monitoring/commit/a5c354e45092b9887ddd53b19544f20827043969))
* temporarily increase space size ([bb9e421](https://github.com/lidofinance/ethereum-validators-monitoring/commit/bb9e421fb5d4063193ea63c1e4ff5450d9e9fbac))
* validate `START_EPOCH` in all environments ([fe4b1a4](https://github.com/lidofinance/ethereum-validators-monitoring/commit/fe4b1a437c0ea90562b80f5193805daa0451cf0c))



# [4.5.0](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.4.0...4.5.0) (2023-07-25)


### Bug Fixes

* import ([f896663](https://github.com/lidofinance/ethereum-validators-monitoring/commit/f896663c23f7b18003a36f3b533eac13c27053d6))
* rename ([3996e23](https://github.com/lidofinance/ethereum-validators-monitoring/commit/3996e23b33755353a4d57b3ad9da94c762b8cb71))
* undefined operators for metrics ([3f6bd9e](https://github.com/lidofinance/ethereum-validators-monitoring/commit/3f6bd9eb680f4e2c7b616723f1a35134cf492811))
* unused module init ([#182](https://github.com/lidofinance/ethereum-validators-monitoring/issues/182)) ([7f02522](https://github.com/lidofinance/ethereum-validators-monitoring/commit/7f0252273ebd8a39e84dba25250a28f1a26e0c93))
* use batch and one stream ([9f10e7e](https://github.com/lidofinance/ethereum-validators-monitoring/commit/9f10e7e712d9db8c6784924597f88c46d1de81ea))


### Features

* `head` working mode ([71fb8a8](https://github.com/lidofinance/ethereum-validators-monitoring/commit/71fb8a8c212dfdeeee97999f59cee8bfe311e900))
* README ([51e113e](https://github.com/lidofinance/ethereum-validators-monitoring/commit/51e113ef838371c145724a61cc2a9aa192894824))
* speed up writing to db ([9441c0b](https://github.com/lidofinance/ethereum-validators-monitoring/commit/9441c0bffe91535a9018c573d848ef4f799304e2))



# [4.4.0](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.3.3...4.4.0) (2023-07-05)


### Bug Fixes

* add label to metric ([#178](https://github.com/lidofinance/ethereum-validators-monitoring/issues/178)) ([e324034](https://github.com/lidofinance/ethereum-validators-monitoring/commit/e324034394d7e81030110d988db8ecbbd9c90c9d))
* unused module init ([#182](https://github.com/lidofinance/ethereum-validators-monitoring/issues/182)) ([#184](https://github.com/lidofinance/ethereum-validators-monitoring/issues/184)) ([f243331](https://github.com/lidofinance/ethereum-validators-monitoring/commit/f2433314502cacbd66a6c06ea348bd97d260f189))


### Features

* keys-api interface ([#177](https://github.com/lidofinance/ethereum-validators-monitoring/issues/177)) ([4815355](https://github.com/lidofinance/ethereum-validators-monitoring/commit/481535586424c2c0fae5ccf1fd75f06f62a87cfe))
* stuck keys ([#170](https://github.com/lidofinance/ethereum-validators-monitoring/issues/170)) ([8a9bd2d](https://github.com/lidofinance/ethereum-validators-monitoring/commit/8a9bd2db6ce9c930d36a7367e71598717fa738ca))
* VALIDATOR_USE_STUCK_KEYS_FILE, readme ([#175](https://github.com/lidofinance/ethereum-validators-monitoring/issues/175)) ([3bd8174](https://github.com/lidofinance/ethereum-validators-monitoring/commit/3bd8174b0e82f73508f57d89ab8c35a2f725bea5))



## [4.3.3](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.3.2...4.3.3) (2023-04-14)


### Bug Fixes

* critical slashing alert ([#159](https://github.com/lidofinance/ethereum-validators-monitoring/issues/159)) ([006ec38](https://github.com/lidofinance/ethereum-validators-monitoring/commit/006ec380f56446e1c7e1f0770078a89e65bec27b))
* penalty calculation for `active_slashed` ([#160](https://github.com/lidofinance/ethereum-validators-monitoring/issues/160)) ([46be064](https://github.com/lidofinance/ethereum-validators-monitoring/commit/46be064c612debd845337e47ca2be74818497999))



## [4.3.2](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.3.1...4.3.2) (2023-04-11)


### Bug Fixes

* ignore cache while fetching data from head ([#155](https://github.com/lidofinance/ethereum-validators-monitoring/issues/155)) ([bddfdef](https://github.com/lidofinance/ethereum-validators-monitoring/commit/bddfdefcbb84171ba648f421bc03a7130289b397))



## [4.3.1](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.3.0...4.3.1) (2023-04-05)


### Bug Fixes

* too wide queries with withdrawals ([#150](https://github.com/lidofinance/ethereum-validators-monitoring/issues/150)) ([d674e03](https://github.com/lidofinance/ethereum-validators-monitoring/commit/d674e03ae201618c6ad970fb2e8c166eb624e3aa))



# [4.3.0](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.2.2...4.3.0) (2023-04-05)


### Bug Fixes

* double accounting ([#138](https://github.com/lidofinance/ethereum-validators-monitoring/issues/138)) ([e85d73e](https://github.com/lidofinance/ethereum-validators-monitoring/commit/e85d73e46ac26c0b5e488825092d9f2945004e79)), closes [#139](https://github.com/lidofinance/ethereum-validators-monitoring/issues/139)
* fix get committees streams ([#143](https://github.com/lidofinance/ethereum-validators-monitoring/issues/143)) ([b0442e9](https://github.com/lidofinance/ethereum-validators-monitoring/commit/b0442e9946d0bf266708f8e326b91adb571872f1))
* remove 'finalized' condition ([#135](https://github.com/lidofinance/ethereum-validators-monitoring/issues/135)) ([ef94603](https://github.com/lidofinance/ethereum-validators-monitoring/commit/ef94603eca5b138287490365b91994e36644011d))
* tune butches size ([#140](https://github.com/lidofinance/ethereum-validators-monitoring/issues/140)) ([06202bb](https://github.com/lidofinance/ethereum-validators-monitoring/commit/06202bb1d0635cce85c2dbc3be4f068e833b2e7c))
* tune chunks size ([#142](https://github.com/lidofinance/ethereum-validators-monitoring/issues/142)) ([e9168ab](https://github.com/lidofinance/ethereum-validators-monitoring/commit/e9168ab57918b04466c14965714e6b66534a49e8))
* tune finalized condition ([#136](https://github.com/lidofinance/ethereum-validators-monitoring/issues/136)) ([353d81d](https://github.com/lidofinance/ethereum-validators-monitoring/commit/353d81dd9c681c7c9ec13aebafc243fbf8f4a278))
* tune getAttestationCommittees ([#141](https://github.com/lidofinance/ethereum-validators-monitoring/issues/141)) ([5caf4e1](https://github.com/lidofinance/ethereum-validators-monitoring/commit/5caf4e119894cfb7aa8dfd402c0edcdf0e7ba5dc))
* withdrawal status ([#147](https://github.com/lidofinance/ethereum-validators-monitoring/issues/147)) ([f6806db](https://github.com/lidofinance/ethereum-validators-monitoring/commit/f6806dbeb514d96fe8349b1da4312bba5e1b854d))


### Features

* change dashboards for withdrawals ([#137](https://github.com/lidofinance/ethereum-validators-monitoring/issues/137)) ([0961ffd](https://github.com/lidofinance/ethereum-validators-monitoring/commit/0961ffd4e279c4afb0ce04050eb7077740fc6638))
* throw last error ([#145](https://github.com/lidofinance/ethereum-validators-monitoring/issues/145)) ([21bf527](https://github.com/lidofinance/ethereum-validators-monitoring/commit/21bf5279d933f88faf85b28f004dc8ca3aec8444))
* withdrawals ([#133](https://github.com/lidofinance/ethereum-validators-monitoring/issues/133)) ([e724d06](https://github.com/lidofinance/ethereum-validators-monitoring/commit/e724d06715646cad8f1ce7b5f46965435a463af4))



## [4.2.2](https://github.com/lidofinance/ethereum-validators-monitoring/compare/4.2.1...4.2.2) (2023-01-30)


### Bug Fixes

* get balance diff in rewards query ([#125](https://github.com/lidofinance/ethereum-validators-monitoring/issues/125)) ([222ff20](https://github.com/lidofinance/ethereum-validators-monitoring/commit/222ff2065ccaf31e39a107f4c383318f02c27261))



