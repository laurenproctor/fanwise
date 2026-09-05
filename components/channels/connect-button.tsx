"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { FormError } from "@/components/ui/form-error"
import {
  beginAuthorizationAction,
  connectChannelAction,
  disconnectChannelAction,
} from "@/lib/channels/actions"

/**
 * Connect and disconnect.
 *
 * Two shapes, decided by the adapter rather than by this component. A channel
 * with an authorization asks for the account first and then hands the creator
 * to the provider; a channel without one writes a row. The mocks are the second
 * kind and are the only ones left.
 *
 * Disconnecting is destructive and irreversible from here, so it confirms. At
 * C1 it also becomes a billing event, and the confirmation copy will need to say
 * so, because a click that changes an invoice should say that it does.
 */

export interface OAuthPrompt {
  accountHintLabel: string
  accountHintPlaceholder: string
}

export function ConnectButton({
  workspaceSlug,
  channelKey,
  channelName,
  connectionId,
  accountName,
  disabled,
  oauth,
}: {
  workspaceSlug: string
  channelKey: string
  channelName: string
  connectionId: string | null
  accountName: string | null
  disabled?: boolean
  /** Present when this channel is connected by authorizing it. */
  oauth: OAuthPrompt | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [authorizing, setAuthorizing] = useState(false)
  const [accountHint, setAccountHint] = useState("")
  const [pending, startTransition] = useTransition()

  function connect() {
    setError(null)
    startTransition(async () => {
      const result = await connectChannelAction(workspaceSlug, channelKey)
      setError(result.error)
    })
  }

  function authorize() {
    setError(null)
    startTransition(async () => {
      const result = await beginAuthorizationAction(workspaceSlug, channelKey, accountHint)
      if (result.error !== null) {
        setError(result.error)
        return
      }
      /*
       * A full navigation, not a router push. The destination is the
       * provider's own domain, and Next's client router would try to treat it
       * as an internal route.
       */
      window.location.href = result.authorizeUrl
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
    if (oauth && authorizing) {
      return (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            authorize()
          }}
        >
          <Field
            label={oauth.accountHintLabel}
            name="accountHint"
            value={accountHint}
            onChange={(event) => setAccountHint(event.target.value)}
            placeholder={oauth.accountHintPlaceholder}
            autoFocus
            required
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Taking you there…" : `Continue to ${channelName}`}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAuthorizing(false)}
              disabled={pending}
            >
              Cancel
            </Button>
          </div>
          <FormError message={error} />
        </form>
      )
    }

    return (
      <div className="grid gap-2">
        <Button
          onClick={() => (oauth ? setAuthorizing(true) : connect())}
          disabled={pending || disabled}
        >
          {pending ? "Connecting…" : "Connect"}
        </Button>
        <FormError message={error} />
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {accountName ? <p className="text-[13px] text-[var(--color-ink-2)]">{accountName}</p> : null}
      {confirming ? (
        <div className="grid gap-2">
          <p className="text-[13px] text-[var(--color-ink-2)]">
            Disconnecting {channelName} removes its listings from Fanwise. Anything already
            published stays on {channelName}.
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
