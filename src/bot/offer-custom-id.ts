import { z } from 'zod';

export type OfferButtonAction = 'accept' | 'decline';

const offerCustomIdSchema = z
  .string()
  .max(100)
  .regex(
    /^offer:(accept|decline):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

export function createOfferCustomId(action: OfferButtonAction, offerId: string): string {
  const value = `offer:${action}:${offerId}`;
  return offerCustomIdSchema.parse(value);
}

export function parseOfferCustomId(
  customId: string,
): { action: OfferButtonAction; offerId: string } | null {
  if (!offerCustomIdSchema.safeParse(customId).success) return null;
  const [, action, offerId] = customId.split(':');
  if ((action !== 'accept' && action !== 'decline') || offerId === undefined) return null;
  return { action, offerId };
}
