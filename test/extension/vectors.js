// Fixed test data. Addresses and WIFs were computed with reference.js, which
// is itself checked against published BIP32/BIP39 vectors in
// reference.test.js. Changing any of these values means existing wallets
// would get different addresses.

const BIP39_PATH = "m/44'/22'/0'/0/";
const ELECTRUM1_PATH = "m/0'/0/";

module.exports = {
  BIP39_PATH,
  ELECTRUM1_PATH,

  wallets: [
    {
      name: 'BIP39 "abandon ... about"',
      seedVersion: 'Bip39',
      basePath: BIP39_PATH,
      mnemonic:
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      accounts: [
        ['MM2pSkUSMnVvbH2D2JMCZNjGMitzB9pYga', 'T4vLWPvui4kgRdQsAJtwCCCJX9WgVyXb9LF6D3JD1EfxgVveemJJ'],
        ['MJDTbRnst6CiHKE1tXWPPB5aKi2Gw53DrV', 'T9ATiugJCdrdhP4s777hFECVAs7Xrx64pTkb3Cw9GEFfWX5WSvkx'],
        ['M8b3CU7A25WMH2ptq5PpF3CBCNoqi7M42D', 'T5qCiqVGvkvcx9Fe4csyGgizbE5zmaaeEps1t8X6Uw74XATSgDyh']
      ]
    },
    {
      // A parent key on the hardened path starts with 0x00, so bitcore's
      // derive() (non-compliant) gives a different address than BIP32.
      // BIP32 would give MWJrTMdfWkNgYNqWZpqT37GGMyu1s9jYwG for account 0.
      name: 'BIP39, non-compliant derivation case',
      seedVersion: 'Bip39',
      basePath: BIP39_PATH,
      mnemonic:
        'risk eagle shine walk glimpse analyst absent parent wall wreck buddy opera',
      accounts: [
        ['MQgsqquWDCMnrCcTbwbsMwzuQWrMYNgj42', 'TA5FdhsXrs2NjWGSbBosVYtneVEEQGwT2CV2CHGea4ff2fG9sWnv'],
        ['MCgQ7LW7LMXTmNk6oHmtYzRY1C2DwCJahY', 'TAMk76kwHR66z4FGDqRrF6HFEz1vnZqm7npxHjLpHgRMMPv8SXbt'],
        ['MJ7axzJSe28BepWYtwhmSiCvF4wVN5BzTZ', 'T7u8uEjXUTHJ7hLK4Ytr9ekiCujqRADTnjCbqfvfkFSEVTar8u27']
      ]
    },
    {
      name: 'Electrum1 "like just love ..."',
      seedVersion: 'Electrum1',
      basePath: ELECTRUM1_PATH,
      mnemonic: 'like just love know never want time out there make look eye',
      accounts: [
        ['MPVSRSRLXBVzcb8rrmdgU9nx72ZkZ6TKa3', 'TB2P9q1tLwRxug4T4NzAoxF2v2sgxtiajUygsX7yt4DBjPstvqMb'],
        ['M95pnzmornfsib9AiFWhokRQJpVitiHkWt', 'TBMBehXdgygrqpx376D9T3kdgCX2FkJGSJbSDQ6WRGcnAPgUAYk7'],
        ['MVTqxqCrnyrog8YtSm33CUhN1VeYVqgXYy', 'T4ao5BPCs2c3AiGZtrX3qWj1ftkAAGbfq4cHe7TNevxjNBSSqKyK']
      ]
    },
    {
      // Non-compliant case for Electrum1 (the master key starts with 0x00).
      // BIP32 would give MQKp5HM4mznuKzae12WWqUhUmsppUw76jt for account 0.
      name: 'Electrum1, non-compliant derivation case',
      seedVersion: 'Electrum1',
      basePath: ELECTRUM1_PATH,
      mnemonic:
        'wrinkle here begin endless beaten learn depend strength strife breath measure nail',
      accounts: [
        ['MGzMqyGbw3qZSQs4xQiFz4dkrLjBE7WT3X', 'T5VGnPqaFHPD7roQhxoq8TE1X4s88fD7xFoabHygcHuKmqQWV7Q6'],
        ['MJGvTWWqNBr6C9GuQZPvS1tNDAGAgB9roj', 'TBZ3Noc28dAuVsoCm3JTgVDroTyw2aTzC33Fux4e7dUwnQgiukCb'],
        ['MDkQ11sH4XDUGjNXbqkxxDBQeANjdFyECV', 'T9nj9d3nkrK1vaVXKMKYzYyxrs9at1SDGLVzKWJdkTVwpR1TJtqM']
      ]
    }
  ],

  // An imported (non-HD) key: sha256("mpurse test import key")
  imported: {
    hex: 'b5814007f320e083dcc80c78285b534e2e0bbd7f63b9bd19e5f423fcc2290b7f',
    address: 'MCCYirh476AkYrcM37CVB8dB3wkDsm5qWe',
    wif: 'T98oHrbnt97oUmU5uetQsiibJmDNPvoVdMgvw6vFJjkKZw2n83ZE'
  },

  // A vault as crypto-js 3 wrote it (AES passphrase mode, fixed salt
  // a1b2c3d4e5f60718). Existing users' vaults look like this.
  vault: {
    password: 'パスワード pw',
    checksum: 'xWa0NqAjuX6iTi/yVNTmbbZlwR4sZkR/ax5ed2gJnxI=',
    data:
      'U2FsdGVkX1+hssPU5fYHGD/lqx1dfpkfyJKn4iHcNyRkomVdB1+hKXVHexTYRYSHC2tgS0/iCIMfeeg2HcYzJhFGIT2fqdCtcDXMsC2sz5I8N3zbtK7HNqK1MgARm+OWQuUe+DC8U+Uqa93Iynpxd0MhXnT1iCDlrlm4r2TQtMNivhwrpZScfWMPNa6ALgUa5tD9HTQEwc4Kc++64O3BaYkssRtnJg7VIeTzNV+2efyJRAiCSncwAjaflFoECXpFfO+mm88xV6cFYhXLSMIif1ztuvN1OGqxtdipOikiNATHJAkBZHBBv+94lhFhvgDGw+borzPkbt/USWOLPIXM9fvjWxRTfTQyWUcj2GKDnVxZZmHlDdm7IAjzbXOcWC4M',
    plain: {
      hdkey: {
        seedVersion: 'Bip39',
        basePath: BIP39_PATH,
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        numberOfAccounts: 2
      },
      privatekeys: ['T98oHrbnt97oUmU5uetQsiibJmDNPvoVdMgvw6vFJjkKZw2n83ZE']
    }
  }
};
