import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ChatModeration } from '@/features/chat/hooks/use-chat-moderation'

export function ChatModerationDialog({ moderation }: { moderation: ChatModeration }) {
  const { t } = useTranslation('chat')
  const { target, reason, setReason, pending, error, close, submit } = moderation

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target?.kind === 'remove' ? t('removeMessage') : t('reportMessage')}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void submit() }}>
          <div className="grid gap-2">
            <Label htmlFor="chat-moderation-reason">{t(target?.kind === 'remove' ? 'reasonOptional' : 'reason')}</Label>
            <Input id="chat-moderation-reason" maxLength={500} value={reason} disabled={pending} required={target?.kind === 'report'} onChange={(event) => setReason(event.target.value)} />
          </div>
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={close}>{t('cancel')}</Button>
            <Button type="submit" variant={target?.kind === 'remove' ? 'destructive' : 'default'} disabled={pending || target?.kind === 'report' && !reason.trim()}>{pending ? t('saving') : target?.kind === 'remove' ? t('remove') : t('report')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
