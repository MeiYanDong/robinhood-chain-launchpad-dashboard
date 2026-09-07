export const PAIR_PRIMARY_ISSUER = {
  address: "0xa15e4ad0dbc8df1715a7b254526252cd93bb1102",
  label: "PAIR 主发行钱包",
  evidence: [
    {
      kind: "official_token_api" as const,
      url: "https://pair.fund/api/tokens/0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be",
      note: "PAIR 官方 API 将该地址列为 PAIR 代币 creator。",
    },
    {
      kind: "onchain_launch_transaction" as const,
      url: "https://rh-scan.com/tx/0x00e0b810c18ac1154a3921ffb37f7f142acb641f394ab78366bad0a5842af225",
      note: "PAIR 发行交易由该地址发送至官方 Launchpad。",
    },
  ],
} as const;

export const PAIR_OFFICIAL_PROTOCOL_TOKEN = {
  address: "0x6b1d42927b1a84ec28fa88d4fc6fa7af404966be",
  name: "PAIR",
  symbol: "PAIR",
  transactionHash: "0x00e0b810c18ac1154a3921ffb37f7f142acb641f394ab78366bad0a5842af225",
  blockNumber: 49_391_541,
  launchedAt: "2026-08-29T19:07:54.000Z",
} as const;

export function isPairPrimaryIssuer(address: string): boolean {
  return address.toLowerCase() === PAIR_PRIMARY_ISSUER.address;
}

export function isPairOfficialProtocolToken(address: string): boolean {
  return address.toLowerCase() === PAIR_OFFICIAL_PROTOCOL_TOKEN.address;
}
