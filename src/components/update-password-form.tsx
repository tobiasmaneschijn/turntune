import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function UpdatePasswordForm({
  client,
  onComplete,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & {
  client: SupabaseClient
  onComplete: () => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    try {
      const { error } = await client.auth.updateUser({ password })
      if (error) throw error
      onComplete()
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Could not save password. Try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">New password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleForgotPassword}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Saving…' : 'Save password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
