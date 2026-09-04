"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { FormError } from "@/components/ui/form-error"
import { connectChannelAction, disconnectChannelAction } from "@/lib/channels/actions"

/**
 * Connect and disconnect.
 *
 * A3 has no OAuth: connecting writes a row. A5 replaces the action body with a
 * real authorization round trip and this component does not change.
 *
 * Disconnecting is destructive and irreversible from here, so it confirms. At
 * C1 it also becomes a billing event, and the confirmation copy will need to say
 * so, because a click that changes an invoice should say that it does.
 */
export function ConnectButton({
  workspaceSlug,
  channelKey,
  channelName,
  connectionId,
  disabled,
}: {
  workspaceSlug: string
  channelKey: string
  channelName: string
  connectionId: string | null
  disabled?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  function connect() {
    setError(null)
    startTransition(async () => {
      const result = await connectChannelAction(workspaceSlug, channelKey)
      setError(result.error)
    })
  }

  function disconnect() {
    setError(null)
    startTransition(async () => {
      const result = await disconnectChannelAction(workspaceSlug, connectionId!)
      setError(result.error)
      if (!result.error) setConfirming(false)
    })
  }

  if (!connectionId) {
    return (
      <div className="grid gap-2">
        <Button onClick={connect} disabled={pending || disabled}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
        <FormError message={error} />
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {confirming ? (
        <div className="grid gap-2">
          <p className="text-[13px] text-[var(--color-ink-2)]">
            Disconnecting {channelName} removes its listings from Fanwise.
          </p>
          <div className="flex gap-2">
            <Button onClick={disconnect} disabled={pending}>
              {pending ? "Disconnecting…" : "Yes, disconnect"}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Disconnect
        </Button>
      )}
      <FormError message={error} />
    </div>
  )
}
