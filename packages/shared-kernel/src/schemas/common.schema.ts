import { z } from 'zod'

// Common Meta
export const MetaSchema = z.object({
  requestId: z.string(),
  timestamp: z.string().datetime(),
  version: z.string()
})

// Standard Error Response
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string().optional(),
  error: z.object({
    code: z.string(),
    details: z.any().optional()
  }),
  meta: MetaSchema.optional()
})

// Standard Success Response Wrapper
export const createSuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) => {
  return z.object({
    success: z.literal(true),
    message: z.string().optional(),
    data: dataSchema,
    meta: MetaSchema.optional()
  })
}

// Pagination
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10)
})

// JWT Payload
export const JwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['USER', 'ADMIN']).default('USER'),
  type: z.enum(['ACCESS', 'REFRESH'])
})

export type JwtPayload = z.infer<typeof JwtPayloadSchema>
