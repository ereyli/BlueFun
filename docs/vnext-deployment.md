# B20Base vNext deployment status

Last updated: 15 July 2026

## Base mainnet

Base vNext was deployed at block `48678791`. All contracts below are source verified on BaseScan. The deployment catalog used by the web app and indexer is [`contracts/deployments/secure-mainnet.json`](../contracts/deployments/secure-mainnet.json).

| Component | Address | Deployment transaction |
| --- | --- | --- |
| 7-day governance timelock | `0xA7DEa156cD6a0a8D5e0c25e94e20E670b426cF26` | `0x35b77205f067771d9fe14bb122fd57339bec865562f9bb7d7b183199ecd8d6a6` |
| Fee policy | `0xe5c5585aB34F8e2ba55C30Ef5E6b0254d87a4941` | `0x15c55bdba274362c863f529bb56456395f2f0b76897324ed0f6cb844467e3d05` |
| Base revenue router V2 | `0x18EdA8de1aFd6B6329BaF742A9eb73F93ec6B741` | `0x0c0d02926d17e2832c890cc32b6424bf6b45334f9d59775e359b0115db1d06d3` |
| BLUE staking vault V2 | `0x221a86096a334BcaFd5E561564dC8E6A48F19584` | created by the revenue-router transaction |
| Unified fee hook | `0xF0b8dDe19510eE7D6D50Be289C4257EcD14C60CC` | `0x58d114a1bc97682c3df196cb848d275cae2b08b6d1a8633e95c927a317e36c2f` |
| Bond emergency guardian | `0x642592CF4DA396a2d70b930E43B45E108cC37803` | `0x7a6096698a8d5c1449ed32b29d567dc32f4e795cca448594a4a12fa42b46f8ca` |
| Bonding curve market | `0x7d42dd1435e9567C1edFb513C45c8eA82fe03a38` | `0x24a2ec308019e4e15b2d336387084ab58c56cdd0ea20dd33d426b687cdccbd25` |
| Locked Bond liquidity | `0x484345C0Fc777d1945a84ADB6284D487daFB1de8` | `0xce0ae90a0897b35fe8b4937712a6a36d5cc4cfa0b68e1185016a4e2dfa325c60` |
| Graduation manager | `0x989bd9259408F73BB17099d37Df2CCdC57B271f3` | `0x7468fa83068aa7924baa2edc0b761b1e0f3cc6c500ee2b5a2f102ff84498074e` |
| Bond launch factory | `0x820344FB4C0a518d0CaEf5d3De96fF41CBe6b345` | `0xf69e1cfd8ca520bfeff36821e8f95a5b328efd0339c46859889ff683bcc03696` |
| Locked Direct liquidity | `0x857f7D11474235D8cAfd79826d4D2E0d2B7dabd7` | `0x329a83c3238bdabce331654a1614e0e51d5e280a390fa1b50b7e0e1b235dd661` |
| Direct launch factory | `0x394c5D0244b49e1Eed533CD3505583e504589157` | `0x0001cb802b724f0b339f058ed0357f6c17a1cce52c144ec76ca1672fba8272fd` |

The first vNext Bond id is `23`; the first vNext Direct id is `2`. Legacy deployments remain indexed for historical tokens and are not the Base create-flow defaults.

### Remaining activation gate

The Base deployer currently has no ETH. A low-value live Bond and Direct launch cannot be executed until it is funded. The Base fork test covers creation, exact-input buy/sell, native revenue routing and the sell-token burn against the canonical Uniswap v4 PoolManager; production activation still requires the planned controlled live smoke transaction.

## Robinhood Chain

The Robinhood vNext script compiles and its deployment dry-run passes, but it has not been broadcast. The deployer currently has no native ETH. The web and indexer therefore keep the verified legacy-compatible Robinhood addresses active and must not advertise Robinhood vNext until deployment, verification and smoke tests finish.

## Release rule

Publish the web app and both indexer processes together only after the remaining network gates pass. Do not enable emergency exit on the legacy BLUE staking vault until the V2 interface is deployed to production and a user withdrawal test succeeds.
