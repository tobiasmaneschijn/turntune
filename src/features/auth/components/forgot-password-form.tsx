import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ForgotPasswordForm({
  client,
  onNavigate,
  showTitle = true,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & {
  client: SupabaseClient
  onNavigate: (path: string) => void
  showTitle?: boolean
}) {
  const { t } = useTranslation("public");
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(Date.now)
  const request = useRef(0)
  const active = useRef(true)
  const resultHeading = useRef<HTMLDivElement>(null)
  const previousSuccess = useRef(false)
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000))
  useEffect(() => { active.current = true; return () => { active.current = false; request.current += 1 } }, [])
  useEffect(() => {
    if (!resendAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [resendAt])
  useEffect(() => {
    if (success) resultHeading.current?.focus()
    else if (previousSuccess.current) document.getElementById('email')?.focus()
    previousSuccess.current = success
  }, [success])

  const sendResetLink = async () => {
    if (isLoading || Date.now() < resendAt) return
    const attempt = ++request.current
    setIsLoading(true)
    setError(null)
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}/update-password` }),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error(t("resetConfirmationError"))), 15_000)
        }),
      ])
      if (!active.current || request.current !== attempt) return
      if (response.error) throw response.error
      setSuccess(true)
      setResendAt(Date.now() + 60_000)
      setNow(Date.now())
    } catch (error: unknown) {
      if (active.current && request.current === attempt) setError(error instanceof Error ? error.message : t("resetLinkError"))
    } finally {
      clearTimeout(deadline)
      if (active.current && request.current === attempt) setIsLoading(false)
    }
  }
  const handleForgotPassword = (event: React.FormEvent) => {
    event.preventDefault()
    void sendResetLink()
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      {success ? (
        <Card>
          <CardHeader>
            <CardTitle ref={resultHeading} role="heading" aria-level={2} tabIndex={-1} className="text-xl">{t("checkEmail")}</CardTitle>
            <CardDescription>{t("resetLinkSent")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {error && <p role="alert" className="dialog-error">{error}</p>}
            <Button onClick={() => onNavigate('/login')}>{t("signIn")}</Button>
            <Button variant="outline" disabled={isLoading} onClick={() => { setSuccess(false); setError(null); setResendAt(0) }}>{t("useAnotherEmail")}</Button>
            <Button variant="ghost" disabled={isLoading || remaining > 0} onClick={() => void sendResetLink()}>{isLoading ? t("sending") : remaining > 0 ? t("resendIn", { count: remaining }) : t("resendResetLink")}</Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          {showTitle && <CardHeader><CardTitle>{t("resetPassword")}</CardTitle></CardHeader>}
          <CardContent>
            <form onSubmit={handleForgotPassword}>
              <div className="flex flex-col gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">{t("email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    disabled={isLoading}
                    placeholder={t("emailPlaceholder")}
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {error && <p role="alert" className="dialog-error">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading || remaining > 0}>
                  {isLoading ? t("sending") : remaining > 0 ? t("resendIn", { count: remaining }) : t("sendResetLink")}
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
