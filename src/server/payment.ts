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

export type PaymentConfig = {
  mode: 'off' | 'x402';
  payTo?: string; // agentic wallet address (set after ASP registration)
  usdtAddress?: string; // USDT on X Layer
  facilitatorUrl?: string; // settlement verification endpoint
};

export function paymentConfigFromEnv(env = process.env): PaymentConfig {
  return {
    mode: env.PAYMENT_MODE === 'x402' ? 'x402' : 'off',
    payTo: env.PAYMENT_PAY_TO,
    usdtAddress: env.PAYMENT_USDT_ADDRESS,
    facilitatorUrl: env.PAYMENT_FACILITATOR_URL,
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
