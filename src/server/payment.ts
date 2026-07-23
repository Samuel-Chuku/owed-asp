// x402 pay-per-call gate (non-negotiable 5: payment success is determined
// server-side, never by the client claiming it paid).
//
// Modes via PAYMENT_MODE env:
//   off  — no gating (local dev, MCP Inspector, pre-registration testing)
//   x402 — paid tools return an HTTP 402 challenge (x402 v2, PAYMENT-REQUIRED
//          header, X Layer chainId 196) and callers retry with a signed
//          X-PAYMENT / PAYMENT-SIGNATURE header which we verify with the
//          facilitator before doing any work.
//
// The facilitator verification endpoint + our payTo address come from the OKX
// ASP registration (agentic wallet) — wired in after the user registers.
// Until then 'x402' mode refuses paid calls rather than pretending.

export type PaidTool = 'royalty_quick_check' | 'royalty_leak_scan' | 'claim_kit_generate';

export const PRICES_USD: Record<PaidTool, number> = {
  royalty_quick_check: 0.05,
  royalty_leak_scan: 0.5,
  claim_kit_generate: 5,
};

const X_LAYER_CHAIN_ID = 196;
// USD₮0 — the official settlement stablecoin on X Layer (decimals 6), from
// the A2MCP guide (dev-docs/okxai/howtomcp).
const USDT0_X_LAYER = '0x779ded0c9e1022225f8e0630b35a9b54be713736';

export type PaymentConfig = {
  mode: 'off' | 'x402';
  payTo?: string; // agentic wallet address (X Layer)
  usdtAddress?: string; // settlement asset; defaults to USD₮0 on X Layer
  facilitatorUrl?: string; // OKX facilitator (verification via Payment SDK)
};

export function paymentConfigFromEnv(env = process.env): PaymentConfig {
  return {
    mode: env.PAYMENT_MODE === 'x402' ? 'x402' : 'off',
    payTo: env.PAYMENT_PAY_TO,
    usdtAddress: env.PAYMENT_USDT_ADDRESS ?? USDT0_X_LAYER,
    facilitatorUrl: env.PAYMENT_FACILITATOR_URL,
  };
}

/**
 * Standard x402 v2 challenge per the A2MCP guide. Base64-encode the JSON and
 * send it in the PAYMENT-REQUIRED response header of an HTTP 402 — the header
 * is what the marketplace validates, not the body.
 */
export function buildChallenge(
  tool: PaidTool,
  cfg: PaymentConfig,
  resourceUrl: string,
): { headerValue: string; challenge: object } {
  const challenge = {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: `Owed royalty tool: ${tool} ($${PRICES_USD[tool]})`,
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: `eip155:${X_LAYER_CHAIN_ID}`,
        asset: cfg.usdtAddress ?? USDT0_X_LAYER,
        amount: BigInt(Math.round(PRICES_USD[tool] * 1e6)).toString(), // decimals 6
        payTo: cfg.payTo,
        maxTimeoutSeconds: 300,
        extra: { name: 'USD₮0', version: '1' },
      },
    ],
  };
  return { headerValue: Buffer.from(JSON.stringify(challenge)).toString('base64'), challenge };
}

/** Tools callable without payment. Everything else on tools/call is gated. */
const FREE_TOOLS = new Set(['scan_status']);

/**
 * Classify a request body: which paid tool is being invoked?
 * - a paid tools/call → that tool
 * - lifecycle traffic (initialize/tools/list/notifications) or free tools → null
 * - tools/call with an UNKNOWN name → the cheapest tool (validators may probe
 *   with the listing serviceName or a placeholder — they must see the 402,
 *   not a 200 "tool not found")
 * - unparseable / non-RPC body (marketplace probe) → the cheapest tool
 */
export function paidToolForBody(body: unknown): PaidTool | null {
  const rpc = body as { method?: string; params?: { name?: string } } | undefined;
  if (rpc && typeof rpc.method === 'string') {
    if (rpc.method !== 'tools/call') return null;
    const name = rpc.params?.name;
    if (name && FREE_TOOLS.has(name)) return null;
    return name && name in PRICES_USD ? (name as PaidTool) : 'royalty_quick_check';
  }
  return 'royalty_quick_check';
}

/**
 * HTTP-layer gate for POST /mcp in x402 mode. Returns null to let the request
 * through, or a 402/503 response description. MCP lifecycle calls
 * (initialize, tools/list, notifications) and free tools pass; paid
 * tools/call without a payment header get the 402 challenge; anything
 * unparseable is treated as a marketplace probe and also receives the 402
 * (the review self-check is `curl -i -X POST <endpoint>` expecting 402).
 */
export function gateMcpHttp(
  body: unknown,
  paymentHeader: string | undefined,
  cfg: PaymentConfig,
  resourceUrl: string,
): { status: number; headers: Record<string, string>; body: unknown } | null {
  if (cfg.mode === 'off') return null;
  if (!cfg.payTo) {
    return {
      status: 503,
      headers: {},
      body: { error: 'payment_not_configured', message: 'This service is not yet accepting payments.' },
    };
  }

  const tool = paidToolForBody(body);
  if (!tool) return null; // lifecycle traffic and free tools pass

  if (!paymentHeader) {
    const { headerValue } = buildChallenge(tool, cfg, resourceUrl);
    return {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': headerValue, 'Cache-Control': 'no-store' },
      body: { error: 'payment_required', tool, priceUsd: PRICES_USD[tool] },
    };
  }

  // TODO(payment-sdk): verify + settle via OKXFacilitatorClient
  // (@okxweb3/x402-core) once Dev Portal API keys exist. Until then a header
  // is never trusted (non-negotiable 5) — refuse rather than pretend.
  return {
    status: 503,
    headers: {},
    body: { error: 'verification_not_wired', message: 'Settlement verification not yet enabled; payment cannot be accepted.' },
  };
}

export type GateResult =
  | { ok: true }
  | { ok: false; httpStatus: 402; headers: Record<string, string>; body: unknown }
  | { ok: false; httpStatus: 503; headers: Record<string, string>; body: unknown };

/**
 * Gate a paid tool call. `paymentHeader` is the caller's X-PAYMENT /
 * PAYMENT-SIGNATURE header if present.
 */
export async function gatePaidCall(
  tool: PaidTool,
  cfg: PaymentConfig,
  paymentHeader: string | undefined,
): Promise<GateResult> {
  if (cfg.mode === 'off') return { ok: true };

  if (!cfg.payTo || !cfg.usdtAddress || !cfg.facilitatorUrl) {
    return {
      ok: false,
      httpStatus: 503,
      headers: {},
      body: {
        error: 'payment_not_configured',
        message: 'This ASP is not yet accepting payments. Try again later.',
      },
    };
  }

  if (!paymentHeader) {
    const amountAtomic = BigInt(Math.round(PRICES_USD[tool] * 1e6)).toString(); // USDT: 6 decimals
    const challenge = {
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: `eip155:${X_LAYER_CHAIN_ID}`,
          asset: cfg.usdtAddress,
          amount: amountAtomic,
          payTo: cfg.payTo,
          description: `Owed royalty tool: ${tool} ($${PRICES_USD[tool]})`,
        },
      ],
    };
    return {
      ok: false,
      httpStatus: 402,
      headers: {
        'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(challenge)).toString('base64'),
        'Cache-Control': 'no-store',
      },
      body: { error: 'payment_required', tool, priceUsd: PRICES_USD[tool] },
    };
  }

  // TODO(post-registration): verify settlement with the facilitator before
  // returning ok. Never trust the header alone.
  return {
    ok: false,
    httpStatus: 503,
    headers: {},
    body: {
      error: 'verification_not_wired',
      message: 'Settlement verification is not configured yet; payment cannot be accepted.',
    },
  };
}
