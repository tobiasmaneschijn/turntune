import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("public");
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 12 || password.length > 128) {
      setError(t("passwordLengthError"))
      return
    }
    setIsLoading(true)
    setError(null)

    try {
      const { error } = await client.auth.updateUser({ password })
      if (error) throw error
      onComplete()
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : t("savePasswordError"))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("newPassword")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleForgotPassword}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="password">{t("newPassword")}</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  aria-describedby="password-requirements"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p id="password-requirements" className="text-xs text-muted-foreground">{t("passwordLengthHint")}</p>
              </div>
              {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? t("saving") : t("savePassword")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
