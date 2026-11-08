import { z } from 'zod';

/**
 * The pen strokes of a drawn signature (fork addition, Kerbwell Sign), sent beside the image when
 * signing a signature field. On an agency agreement the server renders the stored image from these
 * (packages/lib/server-only/kerbwell-gate/drawn-signature.ts). Points are canvas pixels.
 */
export const KERBWELL_DRAW_COLORS = ['black', 'red', 'blue', 'green'] as const;

const MAX_TOTAL_POINTS = 20_000;

const ZPoint = z.tuple([z.number().finite(), z.number().finite()]);

export const ZKerbwellDrawnSignature = z
  .object({
    width: z.number().int().min(50).max(4000),
    height: z.number().int().min(20).max(2000),
    color: z.enum(KERBWELL_DRAW_COLORS),
    lines: z.array(z.array(ZPoint).min(1).max(5000)).min(1).max(200),
  })
  .superRefine((drawn, ctx) => {
    let total = 0;

    for (const line of drawn.lines) {
      total += line.length;

      for (const [x, y] of line) {
        if (x < 0 || y < 0 || x > drawn.width || y > drawn.height) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A stroke point is outside the pad' });
          return;
        }
      }
    }

    if (total > MAX_TOTAL_POINTS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Too many stroke points' });
    }
  });

export type TKerbwellDrawnSignature = z.infer<typeof ZKerbwellDrawnSignature>;
