import express, { type Express, type Request } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import { managedUploadAdmission, uploadReservedImage, type UploadLease, type UploadPurpose } from './managed-uploads.js'
import { PublicRequestError, publicRequestFailure } from './public-request-error.js'

export interface ManagedUploadRouteOptions {
  client: SupabaseClient | null
  getUserId: (request: Request) => Promise<string | null>
}
export function mountManagedUploadRoutes(app: Express, options: ManagedUploadRouteOptions) {
  for (const purpose of ['avatar', 'feedback'] as UploadPurpose[]) {
    app.post(`/api/uploads/${purpose}`,
      managedUploadAdmission({ ...options, purpose }),
      express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], limit: '5mb' }),
      async (request, response) => {
        try {
          const lease = response.locals.uploadLease as UploadLease
          const check = async () => { if ((await options.getUserId(request)) !== lease.actor_id) throw new PublicRequestError('This account session has ended.', 403) }
          const storagePath = await uploadReservedImage(options.client!, lease, request.body, request.get('content-type') || '', check)
          await check()
          response.locals.uploadComplete = true
          response.json({ storagePath })
        } catch (error) {
          const failure = publicRequestFailure(error, 'Image uploads are unavailable. Try again later.')
          response.status(failure.status).json({ error: failure.message })
        }
      })
  }
  app.post('/api/uploads/cleanup', express.json({ limit: '2kb' }), async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    try {
      const user = await options.getUserId(request)
      if (!user) { response.status(401).json({ error: 'Sign in to remove an upload.' }); return }
      if (!options.client) { response.status(503).json({ error: 'Image uploads are unavailable.' }); return }
      const paths = request.body?.storagePaths
      if (!Array.isArray(paths) || paths.length > 5 || !paths.length || paths.some(path => typeof path !== 'string' || path.length > 200 || !path.startsWith(`${user}/`))) throw new PublicRequestError('Invalid upload cleanup request.')
      const { data, error } = await options.client.from('soundspin_managed_uploads').select('*').eq('actor_id', user).in('purpose', ['avatar', 'feedback']).in('storage_path', paths).in('state', ['reserved', 'pending'])
      if (error) throw error
      // Claiming references and cleanup must use the same row lock in SQL.
      for (const row of data || []) {
        const { error: cleanupError } = await options.client.rpc('soundspin_cancel_pending_upload', { p_actor: user, p_path: row.storage_path })
        if (cleanupError) throw cleanupError
      }
      response.json({ ok: true })
    } catch (error) {
      const failure = publicRequestFailure(error, 'Could not remove this upload. Try again later.')
      response.status(failure.status).json({ error: failure.message })
    }
  })
}
