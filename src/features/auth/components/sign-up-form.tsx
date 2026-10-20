import { useTranslation } from "react-i18next";
import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requestJson } from '@/lib/authenticated-http'

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

export function SignUpForm({
  client: _client,
  onNavigate,
  showTitle = true,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & {
  client?: SupabaseClient
  onNavigate: (path: string) => void
  showTitle?: boolean
}) {
  const { t } = useTranslation("public");
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!displayName.trim()) {
      setError(t("displayNameRequired"))
      return
    }
    setIsLoading(true)

    try {
      await requestJson('/api/signup', {
        method: 'POST',
        body: JSON.stringify({ email, invitePassword, displayName: displayName.trim() }),
        errorMessage: t("createAccountError"),
      })
      setSuccess(true)
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : t("createAccountError"))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      {success ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">{t("checkEmail")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm">{t("invitationSent")}</p>
            {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
            <Button type="button" className="w-full" disabled={isLoading} onClick={() => onNavigate('/login')}>
              {t("signIn")}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          {showTitle && <CardHeader><CardTitle>{t("createAccount")}</CardTitle></CardHeader>}
          <CardContent>
            <form onSubmit={handleSignUp}>
              <div className="flex flex-col gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="display-name">{t("displayName")}</Label>
                  <Input id="display-name" autoComplete="nickname" required maxLength={32} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">{t("email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t("emailPlaceholder")}
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="invite-password">{t("invitePassword")}</Label>
                  <Input
                    id="invite-password"
                    type="password"
                    autoComplete="off"
                    required
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("invitePasswordHint")}
                  </p>
                </div>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? t("sendingInvitation") : t("createAccount")}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onNavigate('/login')}>{t("signIn")}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
