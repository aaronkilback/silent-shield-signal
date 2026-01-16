/**
 * Database Schema Validators
 * Pre-insert validation to catch constraint issues before they hit the database
 */

import { z } from 'zod';

// ============================================
// ENUM VALIDATORS (matching database constraints)
// ============================================

export const severityLevelSchema = z.enum(['P1', 'P2', 'P3', 'P4']);
export const alertStatusSchema = z.enum(['pending', 'sent', 'failed', 'acknowledged']);
export const entityTypeSchema = z.enum(['person', 'organization', 'location', 'vehicle', 'event', 'asset']);
export const appRoleSchema = z.enum(['admin', 'analyst', 'viewer', 'super_admin']);
export const sourceTypeSchema = z.enum([
  'news', 'social_media', 'government', 'court', 'regulatory', 
  'threat_intel', 'osint', 'internal', 'rss', 'api', 'manual',
  'weather', 'seismic', 'fire', 'custom'
]);

// ============================================
// TABLE SCHEMAS
// ============================================

export const incidentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500, 'Title too long'),
  description: z.string().optional().nullable(),
  severity_level: severityLevelSchema,
  status: z.string().default('open'),
  client_id: z.string().uuid().optional().nullable(),
  location: z.string().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

export const signalSchema = z.object({
  title: z.string().min(1, 'Title is required').max(1000, 'Title too long'),
  content: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  source_url: z.string().url().optional().nullable().or(z.literal('')),
  threat_level: z.enum(['low', 'medium', 'high', 'critical']).optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
});

export const entitySchema = z.object({
  name: z.string().min(1, 'Name is required').max(500, 'Name too long'),
  type: entityTypeSchema,
  description: z.string().optional().nullable(),
  aliases: z.array(z.string()).optional().nullable(),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']).optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
});

export const sourceSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  type: sourceTypeSchema,
  url: z.string().url('Invalid URL').optional().nullable().or(z.literal('')),
  is_active: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const alertSchema = z.object({
  channel: z.string().min(1, 'Channel is required'),
  recipient: z.string().min(1, 'Recipient is required'),
  incident_id: z.string().uuid().optional().nullable(),
  status: alertStatusSchema.default('pending'),
});

export const clientSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  industry: z.string().optional().nullable(),
  contact_email: z.string().email('Invalid email').optional().nullable().or(z.literal('')),
  status: z.string().default('active'),
  locations: z.array(z.string()).optional().nullable(),
  monitoring_keywords: z.array(z.string()).optional().nullable(),
});

// ============================================
// VALIDATION UTILITIES
// ============================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: { field: string; message: string }[];
}

/**
 * Validate data against a schema before database insert
 */
export function validateForInsert<T>(
  schema: z.ZodType<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);
  
  if (result.success) {
    return { success: true, data: result.data };
  }
  
  const errors = result.error.issues.map(issue => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  
  return { success: false, errors };
}

/**
 * Map common AI-generated values to database-valid values
 */
export const valueMappers = {
  severityLevel: (value: string): 'P1' | 'P2' | 'P3' | 'P4' => {
    const normalized = (value || '').toLowerCase();
    if (normalized === 'critical' || normalized === 'p1') return 'P1';
    if (normalized === 'high' || normalized === 'p2') return 'P2';
    if (normalized === 'medium' || normalized === 'p3') return 'P3';
    return 'P4';
  },

  threatLevel: (value: string): 'low' | 'medium' | 'high' | 'critical' => {
    const normalized = (value || '').toLowerCase();
    if (['critical', 'severe', 'p1'].includes(normalized)) return 'critical';
    if (['high', 'elevated', 'p2'].includes(normalized)) return 'high';
    if (['medium', 'moderate', 'p3'].includes(normalized)) return 'medium';
    return 'low';
  },

  entityType: (value: string): z.infer<typeof entityTypeSchema> => {
    const normalized = (value || '').toLowerCase();
    const typeMap: Record<string, z.infer<typeof entityTypeSchema>> = {
      'person': 'person',
      'individual': 'person',
      'human': 'person',
      'organization': 'organization',
      'company': 'organization',
      'org': 'organization',
      'corporation': 'organization',
      'location': 'location',
      'place': 'location',
      'address': 'location',
      'vehicle': 'vehicle',
      'car': 'vehicle',
      'truck': 'vehicle',
      'event': 'event',
      'incident': 'event',
      'asset': 'asset',
      'property': 'asset',
    };
    return typeMap[normalized] || 'organization';
  },
};

/**
 * Sanitize and validate data before insert, applying mappers
 */
export function prepareForInsert<T>(
  schema: z.ZodType<T>,
  data: Record<string, unknown>,
  mappers?: Partial<Record<keyof T, (value: unknown) => unknown>>
): ValidationResult<T> {
  // Apply mappers to transform values
  const transformedData = { ...data };
  
  if (mappers) {
    for (const [key, mapper] of Object.entries(mappers)) {
      if (key in transformedData && mapper) {
        transformedData[key] = (mapper as (v: unknown) => unknown)(transformedData[key]);
      }
    }
  }
  
  return validateForInsert(schema, transformedData);
}

// ============================================
// PRE-BUILT VALIDATORS FOR COMMON OPERATIONS
// ============================================

export const validators = {
  incident: (data: unknown) => validateForInsert(incidentSchema, data),
  signal: (data: unknown) => validateForInsert(signalSchema, data),
  entity: (data: unknown) => validateForInsert(entitySchema, data),
  source: (data: unknown) => validateForInsert(sourceSchema, data),
  alert: (data: unknown) => validateForInsert(alertSchema, data),
  client: (data: unknown) => validateForInsert(clientSchema, data),
};
