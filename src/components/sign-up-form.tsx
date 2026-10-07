import { useState } from 'react'
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
  onNavigate,
  className,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & {
  onNavigate: (path: string) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [invitePassword, setInvitePassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== repeatPassword) {
      setError('Passwords do not match')
      return
    }
    setIsLoading(true)

    try {
      await requestJson('/api/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, invitePassword }),
        errorMessage: 'Could not create account. Try again.',
      })
      setSuccess(true)
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Could not create account. Try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      {success ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Account created</CardTitle>
          </CardHeader>
          <CardContent>
            <Button type="button" className="w-full" onClick={() => onNavigate('/login')}>
              Sign in
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Create an account</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignUp}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center">
                    <Label htmlFor="password">Password</Label>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={6}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center">
                    <Label htmlFor="repeat-password">Confirm password</Label>
                  </div>
                  <Input
                    id="repeat-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={6}
                    required
                    value={repeatPassword}
                    onChange={(e) => setRepeatPassword(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="invite-password">Invite password</Label>
                  <Input
                    id="invite-password"
                    type="password"
                    autoComplete="off"
                    required
                    value={invitePassword}
                    onChange={(e) => setInvitePassword(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Ask the person who invited you for this password.
                  </p>
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Creating account…' : 'Create account'}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => onNavigate('/login')}>Sign in</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
