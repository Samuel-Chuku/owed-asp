// x402 gate tests against the A2MCP guide's compliance rules:
// paid call without payment → 402 + PAYMENT-REQUIRED header (base64 v2
// challenge); probes gate too; lifecycle and free tools pass; a payment
// header is never trusted before verification is wired.

import { describe, expect, it } from 'vitest';
import { buildChallenge, gateMcpHttp, PRICES_USD, type PaymentConfig } from '../src/server/payment.js';

const cfg: PaymentConfig = {
  mode: 'x402',
  payTo: '0x1111111111111111111111111111111111111111',
  usdtAddress: '0x779ded0c9e1022225f8e0630b35a9b54be713736',
};
const URL = 'https://useowed.xyz/mcp';

describe('x402 HTTP gate', () => {
  it('passes everything in off mode', () => {
    expect(gateMcpHttp({ method: 'tools/call', params: { name: 'royalty_leak_scan' } }, undefined, { mode: 'off' }, URL)).toBeNull();
  });

  it('lets MCP lifecycle and free tools through', () => {
    expect(gateMcpHttp({ method: 'initialize' }, undefined, cfg, URL)).toBeNull();
    expect(gateMcpHttp({ method: 'tools/list' }, undefined, cfg, URL)).toBeNull();
    expect(gateMcpHttp({ method: 'tools/call', params: { name: 'scan_status' } }, undefined, cfg, URL)).toBeNull();
  });

  it('402s a paid tools/call without payment, with a valid v2 challenge header', () => {
    const gate = gateMcpHttp({ method: 'tools/call', params: { name: 'royalty_leak_scan' } }, undefined, cfg, URL)!;
    expect(gate.status).toBe(402);
    const challenge = JSON.parse(Buffer.from(gate.headers['PAYMENT-REQUIRED'], 'base64').toString());
    expect(challenge.x402Version).toBe(2);
    expect(challenge.resource.url).toBe(URL);
    expect(challenge.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'eip155:196',
      asset: cfg.usdtAddress,
      amount: '500000', // $0.50 in 6-decimal units
      payTo: cfg.payTo,
      maxTimeoutSeconds: 300,
    });
  });

  it('402s a bare probe POST (marketplace self-check)', () => {
    const gate = gateMcpHttp({}, undefined, cfg, URL)!;
    expect(gate.status).toBe(402);
    expect(gate.headers['PAYMENT-REQUIRED']).toBeTruthy();
  });

  it('never trusts a payment header before verification is wired', () => {
    const gate = gateMcpHttp(
      { method: 'tools/call', params: { name: 'claim_kit_generate' } },
      'fake-signature',
      cfg,
      URL,
    )!;
    expect(gate.status).toBe(503);
  });

  it('refuses paid calls entirely when payTo is missing', () => {
    const gate = gateMcpHttp({ method: 'tools/call', params: { name: 'royalty_quick_check' } }, undefined, { mode: 'x402' }, URL)!;
    expect(gate.status).toBe(503);
  });

  it('challenge amounts match PRICES_USD exactly', () => {
    for (const [tool, usd] of Object.entries(PRICES_USD)) {
      const { challenge } = buildChallenge(tool as keyof typeof PRICES_USD, cfg, URL);
      expect((challenge as any).accepts[0].amount).toBe(String(Math.round(usd * 1e6)));
    }
  });
});
