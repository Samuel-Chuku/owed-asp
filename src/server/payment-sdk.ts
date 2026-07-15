// OKX Payment SDK integration (seller side) — the facilitator-backed path
// for x402: the SDK builds the 402 challenge, verifies the buyer's payment
// header, and settles on-chain (syncSettle) BEFORE we do any work.
// Falls back to null when the Dev Portal keys are absent; the hand-rolled
// challenge in payment.ts then keeps the endpoint review-compliant.

import { OKXFacilitatorClient } from '@okxweb3/x402-core';
import { x402ResourceServer } from '@okxweb3/x402-core/server';
import {
  x402HTTPResourceServer,
  type HTTPAdapter,
  type HTTPRequestContext,
  type HTTPResponseInstructions,
} from '@okxweb3/x402-core/http';
import { ExactEvmScheme } from '@okxweb3/x402-evm/exact/server';
import type { FastifyRequest } from 'fastify';
import { PRICES_USD, type PaidTool, type PaymentConfig } from './payment.js';

const NETWORK = 'eip155:196'; // X Layer

export type SdkGateResult =
  | { kind: 'respond'; response: HTTPResponseInstructions }
  | { kind: 'paid'; settlementHeaders: Record<string, string> };

export type SdkGate = {
  handle(request: FastifyRequest, paymentHeader: string | undefined): Promise<SdkGateResult>;
};

/** Tool price for a request body; probes and unknown bodies price as the cheapest tool. */
function priceForBody(body: unknown): string {
  const rpc = body as { method?: string; params?: { name?: string } } | undefined;
  const name = rpc?.params?.name;
  if (name && name in PRICES_USD) return `$${PRICES_USD[name as PaidTool]}`;
  return `$${PRICES_USD.royalty_quick_check}`;
}

function makeContext(request: FastifyRequest, paymentHeader: string | undefined): HTTPRequestContext {
  const adapter: HTTPAdapter = {
    getHeader: (name) => request.headers[name.toLowerCase()] as string | undefined,
    getMethod: () => 'POST',
    getPath: () => '/mcp',
    getUrl: () => `${request.protocol}://${request.hostname}/mcp`,
    getAcceptHeader: () => (request.headers.accept as string | undefined) ?? '*/*',
    getUserAgent: () => (request.headers['user-agent'] as string | undefined) ?? '',
    getBody: () => request.body,
  };
  return { adapter, path: '/mcp', method: 'POST', paymentHeader, routePattern: 'POST /mcp' };
}

export async function initX402Sdk(cfg: PaymentConfig): Promise<SdkGate | null> {
  const apiKey = process.env.OKX_API_KEY;
  const secretKey = process.env.OKX_SECRET_KEY;
  const passphrase = process.env.OKX_PASSPHRASE;
  if (cfg.mode !== 'x402' || !cfg.payTo || !apiKey || !secretKey || !passphrase) return null;

  const facilitator = new OKXFacilitatorClient({
    apiKey,
    secretKey,
    passphrase,
    // wait for on-chain confirmation before serving — never do work on an
    // unsettled payment (non-negotiable 5)
    syncSettle: true,
  });
  const resourceServer = new x402ResourceServer(facilitator);
  resourceServer.register(NETWORK, new ExactEvmScheme());

  const httpServer = new x402HTTPResourceServer(resourceServer, {
    'POST /mcp': {
      accepts: [
        {
          scheme: 'exact',
          network: NETWORK,
          payTo: cfg.payTo,
          // per-tool pricing off the parsed JSON-RPC body
          price: async (ctx: HTTPRequestContext) => priceForBody(ctx.adapter.getBody?.()),
          maxTimeoutSeconds: 300,
        },
      ],
      description: 'Owed — royalty leak scanner tools (MCP)',
      mimeType: 'application/json',
    },
  });
  await httpServer.initialize();

  return {
    async handle(request, paymentHeader) {
      const ctx = makeContext(request, paymentHeader);
      const processed = await httpServer.processHTTPRequest(ctx);
      if (processed.type === 'payment-error') {
        return { kind: 'respond', response: processed.response };
      }
      if (processed.type === 'no-payment-required') {
        // route is always priced; treat defensively as paid-with-nothing-owed
        return { kind: 'paid', settlementHeaders: {} };
      }
      const settled = await httpServer.processSettlement(
        processed.paymentPayload,
        processed.paymentRequirements,
        processed.declaredExtensions,
      );
      if (!settled.success) {
        return { kind: 'respond', response: settled.response };
      }
      return { kind: 'paid', settlementHeaders: settled.headers };
    },
  };
}
