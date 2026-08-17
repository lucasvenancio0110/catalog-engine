import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const THEME_KEYS = ['stadium', 'premium-dark', 'clean', 'street', 'minimal'];
export const HOME_SECTION_KEYS = [
  'new-arrivals',
  'clubs',
  'national-teams',
  'leagues',
  'categories',
  'retro',
  'training',
  'featured'
];

const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, 'Expected a six-digit hex color such as #111827.')
  .nullable()
  .default(null);

const logoPathSchema = z
  .string()
  .trim()
  .max(240)
  .refine((value) => !value || value.startsWith('/'), 'Logo must use a same-origin public path.')
  .refine((value) => !/^\/\//.test(value), 'Protocol-relative logo URLs are not allowed.')
  .nullable()
  .default(null);

const whatsappSchema = z
  .string()
  .trim()
  .max(24)
  .transform((value) => value.replace(/\D+/g, ''))
  .refine((value) => !value || (value.length >= 10 && value.length <= 15), 'Invalid WhatsApp number.')
  .nullable()
  .default(null);

const instagramSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, '').toLowerCase())
  .refine((value) => /^[a-z0-9._]{1,30}$/.test(value), 'Invalid Instagram handle.')
  .nullable()
  .default(null);

export const tenantStoreProfileSchema = z.object({
  tenantId: z.string().regex(/^t_[a-f0-9]{20}$/),
  storeName: z.string().trim().min(2).max(80),
  logoPath: logoPathSchema,
  whatsapp: whatsappSchema,
  instagram: instagramSchema,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('BRL'),
  themeKey: z.enum(THEME_KEYS).default('premium-dark'),
  primaryColor: hexColorSchema,
  secondaryColor: hexColorSchema,
  homeSections: z
    .array(z.enum(HOME_SECTION_KEYS))
    .min(1)
    .max(8)
    .refine((values) => new Set(values).size === values.length, 'Home sections must be unique.')
    .default(['new-arrivals', 'clubs', 'leagues', 'retro']),
  setupStatus: z.enum(['draft', 'configuring', 'ready', 'published', 'suspended']).default('draft')
});

export const tenantProvisionRequestSchema = z.object({
  storeName: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  themeKey: z.enum(THEME_KEYS).default('premium-dark'),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('BRL')
});

export function createTenantId() {
  return `t_${randomBytes(10).toString('hex')}`;
}

export function createOpaqueId(prefix) {
  if (!/^[a-z][a-z0-9_]{0,15}$/i.test(prefix)) throw new Error('Invalid opaque ID prefix.');
  return `${prefix}_${randomBytes(10).toString('hex')}`;
}

export function normalizeTenantStoreProfile(input) {
  return tenantStoreProfileSchema.parse(input);
}

export function normalizeTenantProvisionRequest(input) {
  return tenantProvisionRequestSchema.parse(input);
}

export function toPublicStoreConfig(profile) {
  const parsed = normalizeTenantStoreProfile(profile);
  return {
    name: parsed.storeName,
    logo: parsed.logoPath || '',
    whatsapp: parsed.whatsapp || '',
    instagram: parsed.instagram ? `@${parsed.instagram}` : '',
    theme: parsed.themeKey,
    currency: parsed.currency,
    primaryColor: parsed.primaryColor,
    secondaryColor: parsed.secondaryColor,
    homeSections: parsed.homeSections,
    setupStatus: parsed.setupStatus
  };
}
