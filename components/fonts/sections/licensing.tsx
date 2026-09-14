"use client"

import { useState } from "react"
import Link from "next/link"
import { z } from "zod"
import { FONT_LICENSE_KINDS, type FontLicense, type FontLicenseKind } from "@/lib/products/metadata"
import { FONT_LICENSE_LABELS } from "@/lib/fonts/labels"
import { FIELD_IDS } from "@/lib/fonts/readiness"
import type { SectionContext } from "../context"
import {
  LINK_BUTTON_CLASS,
  OriginBadge,
  SectionHeading,
  TextArea,
  TextInput,
  Toggle,
} from "../controls"

/**
 * What a buyer may do, and what it costs.
 *
 * Only the licence types a creator turns on exist on the product. Each one
 * shows only the limit that type is sold by, so a desktop licence never asks
 * about pageviews. Price overrides per channel are listed read-only here and
 * edited in that channel's draft, because a price typed on this screen would be
 * ambiguous about which record it changes.
 */

const LIMIT_FIELDS: Record<
  FontLicenseKind,
  { key: "seats" | "monthlyPageviews" | "apps"; label: string; hint: string } | null
> = {
  desktop: { key: "seats", label: "Seats (computers)", hint: "Leave empty for unlimited." },
  web: {
    key: "monthlyPageviews",
    label: "Monthly pageviews",
    hint: "The traffic the webfont license covers.",
  },
  app: { key: "apps", label: "Apps", hint: "How many applications may embed the font." },
  epub: null,
}

function parsePositiveInt(raw: string): number | undefined | "invalid" {
  if (raw.trim() === "") return undefined
  const value = Number(raw.replace(/[,\s]/g, ""))
  return Number.isInteger(value) && value >= 1 ? value : "invalid"
}

export function LicensingSection({ ctx }: { ctx: SectionContext }) {
  const { values, metadata, channels } = ctx
  const licenses = metadata.licenses ?? []
  const [priceDraft, setPriceDraft] = useState(
    values.basePrice === null ? "" : String(values.basePrice),
  )
  const [priceError, setPriceError] = useState<string | null>(null)
  const [currencyDraft, setCurrencyDraft] = useState(values.currency)
  const [currencyError, setCurrencyError] = useState<string | null>(null)
  const [eulaDraft, setEulaDraft] = useState(metadata.eulaUrl ?? "")
  const [eulaError, setEulaError] = useState<string | null>(null)
  const [limitErrors, setLimitErrors] = useState<Record<string, string>>({})

  function setLicenses(next: FontLicense[], immediate = false) {
    // Kept in a stable order so a toggle never reorders what is stored.
    const sorted = [...next].sort(
      (a, b) => FONT_LICENSE_KINDS.indexOf(a.kind) - FONT_LICENSE_KINDS.indexOf(b.kind),
    )
    ctx.setFont("licenses", sorted.length > 0 ? sorted : undefined, { immediate })
  }

  function updateLicense(kind: FontLicenseKind, patch: Partial<FontLicense>, immediate = false) {
    setLicenses(
      licenses.map((license) => {
        if (license.kind !== kind) return license
        const merged: Record<string, unknown> = { ...license, ...patch }
        for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key]
        return merged as FontLicense
      }),
      immediate,
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading
        title="Licensing & pricing"
        description="Choose the licenses you sell and what each allows. Channels start from the base price."
      />

      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <TextInput
          id={FIELD_IDS.basePrice}
          label="Base price"
          inputMode="decimal"
          value={priceDraft}
          error={priceError ?? ctx.fieldError("basePrice")}
          hint="The desktop license price, and where every channel’s price starts. 0 for free."
          onChange={(event) => {
            const raw = event.target.value
            setPriceDraft(raw)
            if (raw.trim() === "") {
              setPriceError(null)
              ctx.setValue("basePrice", null)
              return
            }
            const price = Number(raw)
            if (!Number.isFinite(price) || price < 0 || !/^\d+(\.\d{0,2})?$/.test(raw.trim())) {
              setPriceError("Enter a price like 19 or 19.50.")
              return
            }
            setPriceError(null)
            ctx.setValue("basePrice", price)
          }}
        />
        <TextInput
          id="font-currency"
          label="Currency"
          value={currencyDraft}
          maxLength={3}
          autoCapitalize="characters"
          error={currencyError ?? ctx.fieldError("currency")}
          onChange={(event) => {
            const raw = event.target.value.toUpperCase()
            setCurrencyDraft(raw)
            if (!/^[A-Z]{3}$/.test(raw)) {
              setCurrencyError("Three letters, like USD.")
              return
            }
            setCurrencyError(null)
            ctx.setValue("currency", raw)
          }}
        />
      </div>

      <fieldset
        id={FIELD_IDS.licenseTypes}
        tabIndex={-1}
        className="flex flex-col gap-1 outline-none"
      >
        <legend className="mb-1 text-[14px]">License types</legend>
        <p className="mb-2 text-[12.5px] text-[var(--color-ink-3)]">
          Turn on only the licenses you sell.
        </p>
        <ul className="flex flex-col divide-y divide-[var(--color-rule-2)] border-y border-[var(--color-rule)]">
          {FONT_LICENSE_KINDS.map((kind) => {
            const license = licenses.find((l) => l.kind === kind)
            const limit = LIMIT_FIELDS[kind]
            const panelId = kind === "web" ? FIELD_IDS.webLicense : `font-license-${kind}`
            return (
              <li key={kind} className="flex flex-col gap-3 py-3.5">
                <Toggle
                  id={`font-license-toggle-${kind}`}
                  checked={license !== undefined}
                  label={FONT_LICENSE_LABELS[kind].name}
                  description={FONT_LICENSE_LABELS[kind].description}
                  onChange={(checked) =>
                    setLicenses(
                      checked ? [...licenses, { kind }] : licenses.filter((l) => l.kind !== kind),
                      true,
                    )
                  }
                />
                {license ? (
                  <div
                    id={panelId}
                    tabIndex={-1}
                    className="grid gap-4 pl-[3.25rem] outline-none sm:grid-cols-2"
                  >
                    <TextInput
                      id={`font-license-${kind}-price`}
                      label="Price"
                      inputMode="decimal"
                      defaultValue={license.price ?? ""}
                      placeholder={
                        values.basePrice !== null ? String(values.basePrice) : "Base price"
                      }
                      error={limitErrors[`${kind}-price`]}
                      hint="Leave empty to use the base price."
                      onChange={(event) => {
                        const raw = event.target.value.trim()
                        const price = raw === "" ? undefined : Number(raw)
                        if (price !== undefined && (!Number.isFinite(price) || price < 0)) {
                          setLimitErrors((e) => ({
                            ...e,
                            [`${kind}-price`]: "Enter a price of zero or more.",
                          }))
                          return
                        }
                        setLimitErrors(({ [`${kind}-price`]: _, ...rest }) => rest)
                        updateLicense(kind, { price })
                      }}
                    />
                    {limit ? (
                      <TextInput
                        id={`font-license-${kind}-${limit.key}`}
                        label={limit.label}
                        inputMode="numeric"
                        defaultValue={license[limit.key] ?? ""}
                        error={limitErrors[`${kind}-limit`]}
                        hint={limit.hint}
                        onChange={(event) => {
                          const parsed = parsePositiveInt(event.target.value)
                          if (parsed === "invalid") {
                            setLimitErrors((e) => ({
                              ...e,
                              [`${kind}-limit`]: "Enter a whole number of 1 or more.",
                            }))
                            return
                          }
                          setLimitErrors(({ [`${kind}-limit`]: _, ...rest }) => rest)
                          updateLicense(kind, { [limit.key]: parsed })
                        }}
                      />
                    ) : null}
                    <TextArea
                      id={`font-license-${kind}-terms`}
                      label="Terms for this license"
                      rows={2}
                      maxLength={2000}
                      className="sm:col-span-2"
                      defaultValue={license.terms ?? ""}
                      placeholder={
                        kind === "web"
                          ? "Self-hosted on the licensee’s own domains, up to the pageview limit."
                          : "Anything this license allows or forbids beyond the summary."
                      }
                      onChange={(event) =>
                        updateLicense(kind, { terms: event.target.value.trim() || undefined })
                      }
                    />
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </fieldset>

      <TextArea
        id={FIELD_IDS.licenseSummary}
        label="License summary"
        rows={4}
        maxLength={2000}
        value={values.licenseSummary}
        error={ctx.fieldError("licenseSummary")}
        hint="Plain words every listing carries: who may use the font, and for what."
        onChange={(event) => ctx.setValue("licenseSummary", event.target.value)}
      />

      <div id={FIELD_IDS.eula} tabIndex={-1} className="flex flex-col gap-2 outline-none">
        <TextInput
          id="font-eula-url"
          label="EULA link"
          type="url"
          value={eulaDraft}
          placeholder="https://"
          error={eulaError}
          hint={
            <>
              {ctx.hasLicenseFile ? "A license document is attached in Font files. " : ""}
              Or{" "}
              <button
                type="button"
                className={LINK_BUTTON_CLASS}
                onClick={() => ctx.openSection("files", FIELD_IDS.fileDrop)}
              >
                upload the EULA as a PDF
              </button>
              .
            </>
          }
          onChange={(event) => {
            const raw = event.target.value.trim()
            setEulaDraft(event.target.value)
            if (raw === "") {
              setEulaError(null)
              ctx.setFont("eulaUrl", undefined)
              return
            }
            if (!z.url().safeParse(raw).success || !/^https?:\/\//.test(raw)) {
              setEulaError("Enter a full web address, starting with https://.")
              return
            }
            setEulaError(null)
            ctx.setFont("eulaUrl", raw)
          }}
        />
      </div>

      <section
        id={FIELD_IDS.channelPricing}
        tabIndex={-1}
        aria-labelledby="font-channel-pricing-heading"
        className="flex flex-col gap-2 outline-none"
      >
        <h3 id="font-channel-pricing-heading" className="text-[14px]">
          Marketplace price overrides
        </h3>
        {channels.length === 0 ? (
          <p className="text-[13.5px] text-[var(--color-ink-3)]">
            No channels connected. Each connected channel’s draft starts at the base price.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-rule-2)] border-y border-[var(--color-rule)]">
            {channels.map((channel) => {
              const same = channel.price !== null && channel.price === values.basePrice
              return (
                <li
                  key={channel.connectionId}
                  className="flex flex-wrap items-center justify-between gap-3 py-2.5"
                >
                  <span className="text-[14px]">{channel.channelName}</span>
                  <span className="flex flex-wrap items-center gap-3 text-[14px] tabular-nums">
                    {channel.listingId === null ? (
                      <span className="text-[var(--color-ink-3)]">No draft yet</span>
                    ) : (
                      <>
                        <span>
                          {channel.price === null
                            ? "No price"
                            : `${channel.price} ${channel.currency}`}
                        </span>
                        <OriginBadge origin={same ? "product" : "channel"} />
                        <Link href={channel.editHref} className={LINK_BUTTON_CLASS}>
                          Edit<span className="sr-only"> the {channel.channelName} price</span>
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-[12.5px] text-[var(--color-ink-3)]">
          A price saved in a channel draft belongs to that channel. Changing the base price here
          does not rewrite an existing draft, so review each one after a price change.
        </p>
      </section>
    </div>
  )
}
